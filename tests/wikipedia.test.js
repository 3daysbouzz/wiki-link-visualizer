/**
 * src/api/wikipedia.js のエラー処理・関連スコア・抽選の決定論のテスト。
 *
 * 依存を増やさない方針(CLAUDE.md)に合わせて、Node.js 組み込みの
 * テストランナー(node:test)だけで書いている。実行: npm test
 *
 * fetch を差し替えて Wikipedia の応答を偽装する(実際の通信はしない)。
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchLinkedArticles,
  fetchSuggestions,
  fetchWithTimeout,
  describeHttpError,
  pickLinks,
  rankCandidates,
  morelikeValue,
  getMoreLinks,
  countMoreLinks,
  moreBudget,
  fetchPageviews,
} from '../src/api/wikipedia.js'
import { VIEWS_CONCURRENCY } from '../src/constants.js'
import { seededRandom } from '../src/utils/prng.js'

// --- fetch の偽装 ------------------------------------------------------------

const realFetch = globalThis.fetch

/** 偽の Response。status と body(JSON か文字列)を指定する */
function fakeResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  }
}

/** URL のクエリを見て応答を選ぶ fetch を作る */
function mockFetch(handler) {
  globalThis.fetch = async (url, options) => {
    const params = new URL(url).searchParams
    return handler(params, url, options)
  }
}

beforeEach(() => {
  // 通信ログを黙らせる(テスト出力を読みやすくするため)
  console.info = () => {}
  console.warn = () => {}
})

afterEach(() => {
  globalThis.fetch = realFetch
})

// --- 存在しない記事 --------------------------------------------------------

describe('fetchLinkedArticles: 存在しない記事', () => {
  test('missing のページは「記事が見つかりませんでした」で失敗する', async () => {
    mockFetch((params) => {
      // 中心記事の解決(titles= だけ、generator なし)
      if (params.get('titles') && !params.get('generator')) {
        return fakeResponse(200, {
          query: { pages: [{ title: 'ありえない記事名', missing: true }] },
        })
      }
      throw new Error('ここには来ないはず')
    })

    await assert.rejects(
      () => fetchLinkedArticles('ありえない記事名', 40),
      (e) => {
        assert.match(e.message, /記事が見つかりませんでした/)
        assert.match(e.message, /ありえない記事名/)
        return true
      }
    )
  })

  test('空文字は通信せずに失敗する', async () => {
    mockFetch(() => {
      throw new Error('通信してはいけない')
    })
    await assert.rejects(() => fetchLinkedArticles('   ', 40), /記事名を入力してください/)
  })
})

// --- HTTP エラー(429 / 5xx) ---------------------------------------------------

describe('fetchLinkedArticles: Wikipedia API の異常応答', () => {
  test('429 はレート制限だと分かる文言になる', async () => {
    mockFetch(() => fakeResponse(429, 'Too Many Requests'))
    await assert.rejects(() => fetchLinkedArticles('テスト記事429', 40), /429/)
    await assert.rejects(() => fetchLinkedArticles('テスト記事429', 40), /しばらく待って/)
  })

  test('502 は障害だと分かる文言になる', async () => {
    mockFetch(() => fakeResponse(502, '<html>Bad Gateway</html>'))
    await assert.rejects(() => fetchLinkedArticles('テスト記事502', 40), /障害/)
  })

  test('HTTP 200 でも JSON でない応答なら SyntaxError を素通しにしない', async () => {
    mockFetch(() => fakeResponse(200, '<html>maintenance</html>'))
    await assert.rejects(
      () => fetchLinkedArticles('テスト記事HTML', 40),
      /応答を読み取れませんでした/
    )
  })

  test('ネットワーク失敗は接続失敗の文言になる', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await assert.rejects(() => fetchLinkedArticles('テスト記事NET', 40), /接続に失敗/)
  })

  test('API が error オブジェクトを返したら info を文言にする', async () => {
    mockFetch(() => fakeResponse(200, { error: { code: 'badvalue', info: '不正な値です' } }))
    await assert.rejects(() => fetchLinkedArticles('テスト記事ERR', 40), /不正な値です/)
  })
})

describe('describeHttpError', () => {
  test('状況別の文言', () => {
    assert.match(describeHttpError(429), /429/)
    assert.match(describeHttpError(500), /障害/)
    assert.match(describeHttpError(503), /503/)
    assert.match(describeHttpError(404), /HTTP 404/)
  })
})

// --- タイムアウト ------------------------------------------------------------

describe('fetchWithTimeout', () => {
  test('指定時間で AbortError になる(固まらない)', async () => {
    // signal の abort を待つだけで永遠に返らない fetch
    globalThis.fetch = (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    await assert.rejects(
      () => fetchWithTimeout('https://example.invalid/', 30),
      (e) => e.name === 'AbortError'
    )
  })
})

// --- 検索候補 ----------------------------------------------------------------

describe('fetchSuggestions', () => {
  test('0件なら空配列(「該当なし」として扱える)', async () => {
    mockFetch(() => fakeResponse(200, ['zzz', [], [], []]))
    assert.deepEqual(await fetchSuggestions('zzz'), [])
  })

  test('候補があれば配列で返す', async () => {
    mockFetch(() => fakeResponse(200, ['初音', ['初音ミク', '初音島'], [], []]))
    assert.deepEqual(await fetchSuggestions('初音'), ['初音ミク', '初音島'])
  })

  test('HTTP エラーなら null(「取得できなかった」と区別できる)', async () => {
    mockFetch(() => fakeResponse(429, ''))
    assert.equal(await fetchSuggestions('初音'), null)
  })

  test('通信失敗でも投げずに null', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    assert.equal(await fetchSuggestions('初音'), null)
  })

  test('空文字は通信せず空配列', async () => {
    mockFetch(() => {
      throw new Error('通信してはいけない')
    })
    assert.deepEqual(await fetchSuggestions('  '), [])
  })
})

// --- 抽選の決定論(SPEC 12.1) ----------------------------------------------------

describe('pickLinks', () => {
  const pool = Array.from({ length: 150 }, (_, i) => ({ title: `記事${i}` }))

  test('同じ seed・同じ記事名なら同じ顔ぶれになる', () => {
    const a = pickLinks(pool, 40, seededRandom(1, '初音ミク'))
    const b = pickLinks(pool, 40, seededRandom(1, '初音ミク'))
    assert.deepEqual(a, b)
    assert.equal(a.length, 40)
  })

  test('seed を変えると顔ぶれが変わる', () => {
    const a = pickLinks(pool, 40, seededRandom(1, '初音ミク')).map((l) => l.title)
    const b = pickLinks(pool, 40, seededRandom(2, '初音ミク')).map((l) => l.title)
    assert.notDeepEqual(a, b)
  })

  test('上位 GUARANTEED_TOP 件は必ず含まれ、重複しない', () => {
    const picked = pickLinks(pool, 40, seededRandom(7, 'x')).map((l) => l.title)
    for (let i = 0; i < 10; i++) assert.ok(picked.includes(`記事${i}`))
    assert.equal(new Set(picked).size, picked.length)
  })

  test('プールが上限以下ならそのまま返す', () => {
    const small = pool.slice(0, 5)
    assert.deepEqual(pickLinks(small, 40, seededRandom(1, 'x')), small)
  })
})

// --- 関連スコア(SPEC 3.3) ------------------------------------------------------

// 指示書の重み(1.2 > 1.0 などの境界をこの値で確かめる)。rev2 の実際の wLead は 0.6
const REV2 = { wMorelike: 1.0, wMutual: 0.8, wLead: 0.4 }
const NO_BONUS = { wMorelike: 1.0, wMutual: 0, wLead: 0 }

/** 素材を作る。rank を省略すると morelike 圏外 */
const mat = (title, { rank = null, length = 1000, mutual = 0, lead = 0 } = {}) => ({
  title,
  rank,
  length,
  mutual,
  lead,
})

describe('rankCandidates', () => {
  test('morelike の値は 20位で 0.5、圏外は 0', () => {
    assert.equal(morelikeValue(0), 1)
    assert.equal(morelikeValue(20), 0.5)
    assert.equal(morelikeValue(null), 0)
    assert.equal(morelikeValue(undefined), 0)
  })

  test('wMutual=0・wLead=0 なら従来の並び(morelike 順 → 圏外は長さ順)と一致する', () => {
    const materials = [
      mat('圏外・短い', { length: 100, mutual: 1, lead: 1 }),
      mat('morelike3位', { rank: 3, length: 10 }),
      mat('圏外・長い', { length: 9000 }),
      mat('morelike0位', { rank: 0, length: 5 }),
      mat('圏外・中', { length: 3000, mutual: 1 }),
      mat('morelike1位', { rank: 1, length: 99999, lead: 1 }),
    ]
    // 従来の並べ替え(旧 fetchLinkedArticles の実装)をそのまま再現したもの
    const related = materials.filter((c) => c.rank !== null).sort((a, b) => a.rank - b.rank)
    const others = materials.filter((c) => c.rank === null).sort((a, b) => b.length - a.length)
    const expected = related.concat(others).map((c) => c.title)

    assert.deepEqual(
      rankCandidates(materials, NO_BONUS).map((c) => c.title),
      expected
    )
  })

  test('morelike 圏外でも相互リンク+冒頭リンクなら morelike 1位より上(1.2 > 1.0)', () => {
    const ranked = rankCandidates(
      [mat('1位', { rank: 0 }), mat('声優', { mutual: 1, lead: 1 })],
      REV2
    )
    assert.deepEqual(
      ranked.map((c) => c.title),
      ['声優', '1位']
    )
    assert.ok(Math.abs(ranked[0].score - 1.2) < 1e-9)
  })

  test('相互リンクだけの候補は morelike 5位前後と同程度の位置に来る', () => {
    const materials = Array.from({ length: 12 }, (_, r) => mat(`${r}位`, { rank: r }))
    materials.push(mat('相互のみ', { mutual: 1 }))
    const titles = rankCandidates(materials, REV2).map((c) => c.title)
    const pos = titles.indexOf('相互のみ')
    // 5位(0始まり)は m = 0.8 で同点。長さも同じなのでタイトル順で前後が決まる
    assert.ok(pos >= 4 && pos <= 6, `相互のみ が ${pos} 番目`)
  })

  test('同点は長さの降順、それも同じならタイトル順', () => {
    const ranked = rankCandidates(
      [mat('B', { length: 10 }), mat('C', { length: 50 }), mat('A', { length: 10 })],
      REV2
    )
    assert.deepEqual(
      ranked.map((c) => c.title),
      ['C', 'A', 'B']
    )
  })

  test('同じ入力なら同じ順位になる(入力の順序にもよらない)', () => {
    const materials = Array.from({ length: 50 }, (_, i) =>
      mat(`記事${i}`, {
        rank: i % 3 === 0 ? i : null,
        length: (i * 37) % 11,
        mutual: i % 4 === 0 ? 1 : 0,
        lead: i % 5 === 0 ? 1 : 0,
      })
    )
    const a = rankCandidates(materials, REV2).map((c) => c.title)
    const b = rankCandidates(materials.slice().reverse(), REV2).map((c) => c.title)
    assert.deepEqual(a, b)
  })
})

// --- 相互リンク・冒頭リンクを含めた取得 ---------------------------------------

/**
 * 1つの記事の展開を偽装する fetch。
 *   - 候補 A: morelike 1位
 *   - 候補 B: morelike 圏外・相互リンクあり・冒頭では「B旧名」(リダイレクト)で書かれている
 * rev2 の重みなら B = 0.8 + 0.4 = 1.2 で A(1.0)より上に来る。
 * 冒頭リンクの照合に失敗すると B = 0.8 で A より下になる
 */
function mockArticle(center, { parse = 'ok' } = {}) {
  mockFetch((params) => {
    if (params.get('action') === 'parse') {
      if (parse === 'fail') return fakeResponse(503, 'Service Unavailable')
      return fakeResponse(200, {
        parse: {
          title: center,
          links: [
            { ns: 0, title: 'B旧名', exists: true },
            { ns: 14, title: 'Category:無関係', exists: true },
          ],
        },
      })
    }
    if (params.get('generator') === 'links') {
      assert.equal(params.get('pltitles'), center) // 相互リンクの判定を相乗りさせている
      return fakeResponse(200, {
        batchcomplete: true,
        query: {
          redirects: [{ from: 'B旧名', to: 'B' }],
          pages: [
            { title: 'A', length: 500 },
            { title: 'B', length: 100, links: [{ ns: 0, title: center }] },
            { title: 'C', length: 900 },
          ],
        },
      })
    }
    if (params.get('list') === 'search') {
      return fakeResponse(200, { query: { search: [{ title: 'A' }] } })
    }
    if (params.get('titles')) {
      return fakeResponse(200, { query: { pages: [{ title: center }] } })
    }
    throw new Error('想定外のリクエスト')
  })
}

describe('fetchLinkedArticles: 関連スコア', () => {
  test('冒頭リンクがリダイレクト経由でも照合され、相互リンクと合わせて1位になる', async () => {
    mockArticle('中心記事R')
    const r = await fetchLinkedArticles('中心記事R', { limit: 3, weights: REV2 })
    assert.deepEqual(
      r.links.map((l) => l.title),
      ['B', 'A', 'C']
    )
  })

  test('加点なし(current)では従来どおり morelike → 長さ順', async () => {
    mockArticle('中心記事C')
    const r = await fetchLinkedArticles('中心記事C', { limit: 3, weights: NO_BONUS })
    assert.deepEqual(
      r.links.map((l) => l.title),
      ['A', 'C', 'B']
    )
  })

  test('冒頭リンク(parse)の取得に失敗しても成功を返し、冒頭の加点は 0 になる', async () => {
    mockArticle('中心記事F', { parse: 'fail' })
    const r = await fetchLinkedArticles('中心記事F', { limit: 3, weights: REV2 })
    // B は相互リンクの 0.8 だけになり、A(1.0)より下
    assert.deepEqual(
      r.links.map((l) => l.title),
      ['A', 'B', 'C']
    )
  })

  test('相互リンクの情報(links)が応答に無くても成功し、相互の加点は 0 になる', async () => {
    mockFetch((params) => {
      if (params.get('action') === 'parse') return fakeResponse(200, { parse: { links: [] } })
      if (params.get('generator') === 'links') {
        return fakeResponse(200, {
          query: { pages: [{ title: 'A', length: 1 }, { title: 'B', length: 2 }] },
        })
      }
      if (params.get('list') === 'search') {
        return fakeResponse(200, { query: { search: [] } })
      }
      return fakeResponse(200, { query: { pages: [{ title: '中心記事M' }] } })
    })
    const r = await fetchLinkedArticles('中心記事M', { limit: 2, weights: REV2 })
    assert.deepEqual(
      r.links.map((l) => l.title),
      ['B', 'A']
    )
  })

  test('キャッシュ済みの記事でも、重みを変えると並びが変わる(素材を保存している)', async () => {
    mockArticle('中心記事K')
    const first = await fetchLinkedArticles('中心記事K', { limit: 1, weights: NO_BONUS })
    assert.deepEqual(first.links.map((l) => l.title), ['A'])

    mockFetch(() => {
      throw new Error('キャッシュがあるので通信しないはず')
    })
    const again = await fetchLinkedArticles('中心記事K', { limit: 1, weights: REV2 })
    assert.deepEqual(again.links.map((l) => l.title), ['B'])
  })
})

// --- 追加表示(SPEC 6.8) --------------------------------------------------------

/**
 * 候補が n 件ある記事の展開を偽装する。記事i の morelike 順位は i(= スコア順も i)。
 * 長さはすべて同じにして、順位だけで並ぶようにする
 */
function mockManyLinks(center, n) {
  mockFetch((params) => {
    if (params.get('action') === 'parse') return fakeResponse(200, { parse: { links: [] } })
    if (params.get('generator') === 'links') {
      return fakeResponse(200, {
        query: {
          // わざと逆順で返す(API の並びに依存しないことも確かめる)
          pages: Array.from({ length: n }, (_, i) => ({ title: `${center}-${n - 1 - i}`, length: 1 })),
        },
      })
    }
    if (params.get('list') === 'search') {
      return fakeResponse(200, {
        query: { search: Array.from({ length: n }, (_, i) => ({ title: `${center}-${i}` })) },
      })
    }
    return fakeResponse(200, { query: { pages: [{ title: center }] } })
  })
}

describe('getMoreLinks', () => {
  test('表示済みを除き、スコア順に count 件返す(抽選しない)', async () => {
    mockManyLinks('追加A', 30)
    await fetchLinkedArticles('追加A', { limit: 5, weights: REV2 })
    // 0〜4 は表示済み、7 もほかの枝で表示済みという想定
    const shown = ['追加A-0', '追加A-1', '追加A-2', '追加A-3', '追加A-4', '追加A-7']
    assert.deepEqual(
      getMoreLinks('追加A', shown, 4, REV2).map((l) => l.title),
      ['追加A-5', '追加A-6', '追加A-8', '追加A-9']
    )
  })

  test('残りが count 件未満ならあるだけ返し、0 件なら空配列', async () => {
    mockManyLinks('追加B', 6)
    await fetchLinkedArticles('追加B', { limit: 3, weights: REV2 })
    const shown = ['追加B-0', '追加B-1', '追加B-2']
    assert.deepEqual(
      getMoreLinks('追加B', shown, 8, REV2).map((l) => l.title),
      ['追加B-3', '追加B-4', '追加B-5']
    )
    assert.equal(countMoreLinks('追加B', shown, REV2), 3)
    const all = [...shown, '追加B-3', '追加B-4', '追加B-5']
    assert.deepEqual(getMoreLinks('追加B', all, 8, REV2), [])
    assert.equal(countMoreLinks('追加B', all, REV2), 0)
  })

  test('中心記事自身は返さない。未取得の記事・count=0 は空配列', async () => {
    mockManyLinks('追加C', 3)
    await fetchLinkedArticles('追加C', { limit: 1, weights: REV2 })
    const titles = getMoreLinks('追加C', [], 10, REV2).map((l) => l.title)
    assert.ok(!titles.includes('追加C'))
    assert.deepEqual(getMoreLinks('まだ展開していない記事', [], 8, REV2), [])
    assert.deepEqual(getMoreLinks('追加C', [], 0, REV2), [])
  })

  test('同じ入力なら同じ結果(決定論)', async () => {
    mockManyLinks('追加D', 50)
    await fetchLinkedArticles('追加D', { limit: 10, weights: REV2 })
    const shown = new Set(Array.from({ length: 10 }, (_, i) => `追加D-${i * 2}`))
    const a = getMoreLinks('追加D', shown, 8, REV2)
    const b = getMoreLinks('追加D', new Set(shown), 8, REV2)
    assert.deepEqual(a, b)
  })

  test('上限 moreMax を超えない(8件ずつ足して40件で止まる)', async () => {
    mockManyLinks('追加E', 150)
    const first = await fetchLinkedArticles('追加E', { limit: 40, weights: REV2 })
    const shown = new Set(first.links.map((l) => l.title))
    let added = 0
    const sizes = []
    for (let i = 0; i < 10; i++) {
      const links = getMoreLinks('追加E', shown, moreBudget(added, 8, 40), REV2)
      for (const l of links) shown.add(l.title)
      added += links.length
      sizes.push(links.length)
    }
    assert.deepEqual(sizes, [8, 8, 8, 8, 8, 0, 0, 0, 0, 0])
    assert.equal(added, 40)
  })

  test('moreBudget は上限の手前で端数を返し、超えたら 0', () => {
    assert.equal(moreBudget(0, 8, 40), 8)
    assert.equal(moreBudget(36, 8, 40), 4)
    assert.equal(moreBudget(40, 8, 40), 0)
    assert.equal(moreBudget(45, 8, 40), 0)
    assert.equal(moreBudget(0, 8, 0), 0)
  })
})

// --- 閲覧数の取得行列(表示分を優先し、同時実行数を超えない) ------------------------

describe('fetchPageviews: 優先度と同時実行数', () => {
  test('表示分(high)と先読み(low)を同時に頼んでも、同時実行数は上限以下で、high が先に始まる', async () => {
    let active = 0
    let maxActive = 0
    const startOrder = []
    const releases = []
    globalThis.fetch = (url) => {
      const title = decodeURIComponent(url.split('/per-article/ja.wikipedia/all-access/user/')[1].split('/')[0])
      startOrder.push(title)
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise((resolve) => {
        releases.push(() => {
          active -= 1
          resolve(fakeResponse(200, { items: [{ views: 1 }] }))
        })
      })
    }
    const low = Array.from({ length: 10 }, (_, i) => `先読み${i}`)
    const high = Array.from({ length: 10 }, (_, i) => `表示${i}`)
    const lowDone = fetchPageviews(low, () => {}, { priority: 'low' })
    const highDone = fetchPageviews(high, () => {})

    // 応答を1件ずつ返しながら、全部終わるまで回す
    while (releases.length > 0 || active > 0) {
      await new Promise((r) => setTimeout(r, 0))
      const next = releases.shift()
      if (next) next()
    }
    await Promise.all([lowDone, highDone])

    assert.ok(maxActive <= VIEWS_CONCURRENCY, `同時実行 ${maxActive}`)
    // 先読みが先に頼まれていても、空いた枠は表示分に先に回る
    const lastHigh = Math.max(...high.map((t) => startOrder.indexOf(t)))
    const lowStartedAfterHigh = low.filter((t) => startOrder.indexOf(t) > lastHigh).length
    assert.ok(lowStartedAfterHigh >= low.length - VIEWS_CONCURRENCY)
    assert.equal(startOrder.length, 20) // 同じ記事を二重に取りにいっていない
  })
})
