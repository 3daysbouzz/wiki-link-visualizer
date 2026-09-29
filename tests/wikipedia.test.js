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
  fetchArticleMeta,
} from '../src/api/wikipedia.js'
import { fetchSummary } from '../src/api/summary.js'
import { isCancelled } from '../src/api/requestQueue.js'
import { loadSidebarData } from '../src/api/sidebarData.js'
import { MAX_CONCURRENT_REQUESTS } from '../src/constants.js'
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
      () => fetchWithTimeout('https://example.invalid/', { timeoutMs: 30 }),
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

  test('返すリンクに mutual と relScore(展開時の重みで 0〜1 にならしたスコア)が付く(SPEC 6.9)', async () => {
    mockArticle('中心記事S')
    const r = await fetchLinkedArticles('中心記事S', { limit: 3, weights: REV2 })
    const byTitle = Object.fromEntries(r.links.map((l) => [l.title, l]))
    const total = REV2.wMorelike + REV2.wMutual + REV2.wLead
    // B: 相互リンク + 冒頭リンク(morelike 圏外)
    assert.equal(byTitle.B.mutual, 1)
    assert.ok(Math.abs(byTitle.B.relScore - (REV2.wMutual + REV2.wLead) / total) < 1e-9)
    // A: morelike 1位(m=1)だけ
    assert.equal(byTitle.A.mutual, 0)
    assert.ok(Math.abs(byTitle.A.relScore - REV2.wMorelike / total) < 1e-9)
    // C: 手がかりなし
    assert.equal(byTitle.C.relScore, 0)

    // 追加表示の分も同じ形で返る
    const more = getMoreLinks('中心記事S', ['B', 'A'], 5, REV2)
    assert.deepEqual(more.map((l) => l.title), ['C'])
    assert.equal(more[0].mutual, 0)
    assert.equal(more[0].relScore, 0)
  })
})

// --- 打ち切りで漏れた冒頭リンクの補完(SPEC 3.3) ------------------------------------

/**
 * リンク先が多く、generator=links が MAX_CONTINUE 回で打ち切られる記事の展開を偽装する。
 *   - 候補(generator=links で取れた分): A(morelike 1位)、X(冒頭・相互)
 *   - 冒頭リンク(parse): X、「漢字旧名」(漢字記事へのリダイレクト)、漢字2、赤リンク、1936年
 *   - 補完の問い合わせ: 漢字記事(相互・morelike 2位)、漢字2(相互なし)、赤リンクは missing
 * extra: 'ok' | 'fail'。requests に補完の問い合わせの titles を記録する
 */
function mockTruncated(center, { truncated = true, extra = 'ok', requests = [] } = {}) {
  let round = 0
  mockFetch((params) => {
    if (params.get('action') === 'parse') {
      return fakeResponse(200, {
        parse: {
          title: center,
          links: ['X', '漢字旧名', '漢字2', '赤リンク', '1936年', center].map((title) => ({
            ns: 0,
            title,
            exists: title !== '赤リンク',
          })),
        },
      })
    }
    if (params.get('generator') === 'links') {
      round += 1
      return fakeResponse(200, {
        ...(truncated ? { continue: { gplcontinue: `c${round}`, continue: 'gplcontinue||' } } : {}),
        query: {
          pages: [
            { title: `A${round}`, length: 500 },
            { title: 'X', length: 100, links: [{ ns: 0, title: center }] },
          ],
        },
      })
    }
    if (params.get('list') === 'search') {
      return fakeResponse(200, { query: { search: [{ title: 'A1' }, { title: '漢字記事' }] } })
    }
    if (params.get('pltitles') === center) {
      // 補完の問い合わせ(generator なしで titles と pltitles を持つ)
      requests.push(params.get('titles').split('|'))
      if (extra === 'fail') return fakeResponse(503, 'Service Unavailable')
      return fakeResponse(200, {
        query: {
          redirects: [{ from: '漢字旧名', to: '漢字記事' }],
          pages: [
            { ns: 0, title: '漢字記事', length: 50, links: [{ ns: 0, title: center }] },
            { ns: 0, title: '漢字2', length: 60 },
            { ns: 0, title: '赤リンク', missing: true },
            { ns: 0, title: '1936年', length: 10 },
          ],
        },
      })
    }
    if (params.get('titles')) {
      return fakeResponse(200, { query: { pages: [{ title: center }] } })
    }
    throw new Error('想定外のリクエスト')
  })
}

describe('fetchLinkedArticles: 打ち切りで漏れた冒頭リンクの補完', () => {
  test('候補に無い冒頭リンクが解決後の名前で入り、相互リンク・morelike 順位も反映される', async () => {
    const requests = []
    mockTruncated('中心記事T1', { requests })
    const r = await fetchLinkedArticles('中心記事T1', { limit: 10, weights: REV2 })
    const titles = r.links.map((l) => l.title)
    // 漢字記事 = morelike 2位 + 相互 + 冒頭 で1位。A1(morelike 1位のみ)・X(相互+冒頭)より上
    assert.equal(titles[0], '漢字記事')
    assert.ok(titles.includes('漢字2')) // 相互なし・冒頭のみでも候補には入る
    assert.ok(!titles.includes('漢字旧名')) // リダイレクト前の名前では入らない
    assert.ok(!titles.includes('赤リンク')) // 存在しない記事は入らない
    assert.ok(!titles.includes('1936年')) // 日付記事は補った候補でも除外する
    assert.ok(!titles.includes('中心記事T1'))
    // 問い合わせは1回。既に候補にある X と中心記事自身は問い合わせない
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].slice().sort(), ['1936年', '漢字2', '漢字旧名', '赤リンク'].sort())
    // 補った候補は追加表示の候補にも入る(linkCache に素材として保存されている)
    assert.equal(countMoreLinks('中心記事T1', titles, REV2), 0)
    assert.equal(r.links.length, 6) // A1〜A3・X・漢字記事・漢字2
  })

  test('打ち切りが無い展開では、補完の問い合わせをしない', async () => {
    const requests = []
    mockTruncated('中心記事T2', { truncated: false, requests })
    const r = await fetchLinkedArticles('中心記事T2', { limit: 10, weights: REV2 })
    assert.equal(requests.length, 0)
    assert.ok(!r.links.some((l) => l.title === '漢字記事'))
  })

  test('補完の問い合わせに失敗しても展開は成功し、補完なしの結果になる', async () => {
    mockTruncated('中心記事T3', { extra: 'fail' })
    const r = await fetchLinkedArticles('中心記事T3', { limit: 10, weights: REV2 })
    const titles = r.links.map((l) => l.title)
    assert.equal(titles[0], 'X')
    assert.ok(!titles.includes('漢字記事'))
    assert.ok(!titles.includes('漢字2'))
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

    assert.ok(maxActive <= MAX_CONCURRENT_REQUESTS, `同時実行 ${maxActive}`)
    // 先読みが先に頼まれていても、空いた枠は表示分に先に回る
    const lastHigh = Math.max(...high.map((t) => startOrder.indexOf(t)))
    const lowStartedAfterHigh = low.filter((t) => startOrder.indexOf(t) > lastHigh).length
    assert.ok(lowStartedAfterHigh >= low.length - MAX_CONCURRENT_REQUESTS)
    assert.equal(startOrder.length, 20) // 同じ記事を二重に取りにいっていない
  })
})

// --- 全通信共通の同時実行数(docs/tasks/task-concurrency-limit.md) -----------------------

/**
 * 応答を手で返す偽の fetch。送られた順に { url, release } を reqs に積み、同時実行数を数える。
 * release(body) で 200 を返す(省略時は URL に合う最小の応答)
 */
// テストが途中で失敗しても、手で返す応答を残したままにしない(全通信共通の行列の枠が
// 埋まったままになり、後のテストが永遠に待つため)
const openStates = []
afterEach(async () => {
  if (openStates.length === 0) return
  // 残りを流す間に待機中の分が送られても、本物の通信にならないようにする
  globalThis.fetch = async () => {
    throw new TypeError('テストの後片付け')
  }
  for (const state of openStates.splice(0)) {
    for (const req of state.reqs) req.release()
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  globalThis.fetch = realFetch
})

function manualFetch() {
  const state = { active: 0, maxActive: 0, reqs: [] }
  openStates.push(state)
  globalThis.fetch = (url) => {
    state.active += 1
    state.maxActive = Math.max(state.maxActive, state.active)
    return new Promise((resolve) => {
      const req = {
        url,
        released: false,
        release: (body = defaultBody(url)) => {
          if (req.released) return
          req.released = true
          state.active -= 1
          resolve(fakeResponse(200, body))
        },
      }
      state.reqs.push(req)
    })
  }
  return state
}

function defaultBody(url) {
  if (url.includes('/pageviews/')) return { items: [{ views: 1 }] }
  if (url.includes('/page/summary/')) return { title: 'x', extract: '' }
  return { query: { pages: [{ title: 'x' }], searchinfo: { totalhits: 1 } } }
}

/** 待っている応答を1件ずつ返しながら、全部終わるまで回す */
async function drain(state) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 0))
    const next = state.reqs.find((r) => !r.released)
    if (next) {
      next.release()
    } else {
      // 取りこぼしが無いよう、少し待って新しい送信が無いか確かめる
      await new Promise((r) => setTimeout(r, 5))
      if (!state.reqs.some((r) => !r.released)) return
    }
  }
}

describe('全通信の同時実行数', () => {
  test('展開・サイドバー・閲覧数・先読み・検索候補を同時に頼んでも、上限を超えない', async () => {
    const state = manualFetch()
    const done = Promise.all([
      fetchArticleMeta('同時A'),
      fetchSummary('同時A'),
      fetchPageviews(Array.from({ length: 12 }, (_, i) => `同時表示${i}`)),
      fetchPageviews(Array.from({ length: 8 }, (_, i) => `同時先読み${i}`), undefined, { priority: 'low' }),
      fetchSuggestions('同時'),
      fetchArticleMeta('同時B'),
    ])
    await drain(state)
    await done
    assert.equal(state.reqs.length, 2 + 1 + 12 + 8 + 1 + 2)
    assert.ok(state.maxActive <= MAX_CONCURRENT_REQUESTS, `同時実行 ${state.maxActive}`)
    assert.equal(state.maxActive, MAX_CONCURRENT_REQUESTS) // 枠は使い切っている(直列になっていない)
  })

  test('展開(high)は、先に待っていたサイドバー(mid)・先読み(low)より先に送られる', async () => {
    const state = manualFetch()
    // 先に枠を埋める
    const blockers = fetchPageviews(['枠1', '枠2', '枠3'])
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(state.reqs.length, 3)

    const low = fetchPageviews(['順先読み'], undefined, { priority: 'low' })
    const mid = fetchSummary('順サイドバー')
    const high = fetchSuggestions('順検索') // 検索候補は high

    state.reqs[0].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.match(state.reqs[3].url, /opensearch/)
    state.reqs[1].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.match(state.reqs[4].url, /page\/summary/)
    state.reqs[2].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.match(decodeURIComponent(state.reqs[5].url), /順先読み/)

    await drain(state)
    await Promise.all([blockers, low, mid, high])
  })

  test('先読みで待っていた記事が表示分になったら、優先度が上がり1回だけ取る', async () => {
    const state = manualFetch()
    const blockers = fetchPageviews(['昇格枠1', '昇格枠2', '昇格枠3'])
    await new Promise((r) => setTimeout(r, 0))
    const low = fetchPageviews(['昇格する記事'], undefined, { priority: 'low' })
    const mid = fetchSummary('昇格サイドバー')
    const promoted = fetchPageviews(['昇格する記事']) // 表示分(mid)。サイドバーより後に頼んだので、その後ろに並ぶ

    state.reqs[0].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.match(state.reqs[3].url, /page\/summary/)
    state.reqs[1].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.match(decodeURIComponent(state.reqs[4].url), /昇格する記事/)

    await drain(state)
    await Promise.all([blockers, low, mid, promoted])
    const count = state.reqs.filter((r) => decodeURIComponent(r.url).includes('昇格する記事')).length
    assert.equal(count, 1)
  })

  test('タイムアウトは行列で待っている間は進まない(送信を始めてから数える)', async () => {
    const state = manualFetch()
    const blockers = fetchPageviews(['待ち枠1', '待ち枠2', '待ち枠3'])
    await new Promise((r) => setTimeout(r, 0))
    // 30ms で打ち切る設定だが、枠が空くまで 80ms 待たされる
    const waiting = fetchWithTimeout('https://example.invalid/wait', { timeoutMs: 30 })
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(state.reqs.length, 3) // まだ送っていない
    state.reqs[0].release()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(state.reqs.length, 4)
    state.reqs[3].release({ ok: 1 })
    const res = await waiting // 打ち切られずに届く
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: 1 })
    await drain(state)
    await blockers
  })

  test('待機中のサイドバー取得は取り消せる。取り消しは失敗として保存されない', async () => {
    const state = manualFetch()
    const blockers = fetchPageviews(['取消枠1', '取消枠2', '取消枠3'])
    await new Promise((r) => setTimeout(r, 0))

    const controller = new AbortController()
    const summary = fetchSummary('取り消す記事', { signal: controller.signal })
    const meta = fetchArticleMeta('取り消す記事', { signal: controller.signal })
    controller.abort()
    await assert.rejects(summary, (e) => isCancelled(e))
    await assert.rejects(meta, (e) => isCancelled(e))

    await drain(state)
    await blockers
    assert.equal(state.reqs.length, 3) // 取り消した分は送っていない

    // 保存していないので、次に頼めば取りにいく
    const again = manualFetch()
    const metaAgain = fetchArticleMeta('取り消す記事')
    await drain(again)
    assert.equal(again.reqs.length, 2)
    assert.equal((await metaAgain).backlinks, 1)
  })

  test('送信済みのものは取り消しても中断しない', async () => {
    const state = manualFetch()
    const controller = new AbortController()
    const summary = fetchSummary('送信済み', { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(state.reqs.length, 1)
    controller.abort()
    state.reqs[0].release({ title: '送信済み', extract: '本文' })
    assert.equal((await summary).extract, '本文')
  })

  test('検索候補は取り消されたら null(古い入力の結果として捨てられる)', async () => {
    const state = manualFetch()
    const blockers = fetchPageviews(['候補枠1', '候補枠2', '候補枠3'])
    await new Promise((r) => setTimeout(r, 0))
    const controller = new AbortController()
    const list = fetchSuggestions('古い入力', 8, { signal: controller.signal })
    controller.abort()
    assert.equal(await list, null)
    await drain(state)
    await blockers
    assert.equal(state.reqs.length, 3)
  })
})

// --- サイドバー: ホバーで取り消した記事を、あとで選んだら出る(失敗として保存しない) ------------------

describe('loadSidebarData: 取り消しと保存', () => {
  test('ホバーで通り過ぎて取り消した記事も、あとで選べばプレビューとメタ情報が出る', async () => {
    const caches = { preview: new Map(), meta: new Map() }
    const state = manualFetch()
    // 表示中の閲覧数で枠が埋まっている間に、ノードAにホバーした
    const blockers = fetchPageviews(['SB枠1', 'SB枠2', 'SB枠3'])
    await new Promise((r) => setTimeout(r, 0))
    const hover = new AbortController()
    const pending = loadSidebarData('ホバーした記事', caches, { signal: hover.signal })
    // 別のノードへ移った(App の useEffect の後片付けが abort する)
    hover.abort()
    assert.equal(await pending, null)
    assert.equal(caches.preview.has('ホバーした記事'), false)
    assert.equal(caches.meta.has('ホバーした記事'), false)
    await drain(state)
    await blockers
    assert.equal(state.reqs.length, 3) // 取り消した3件(R2・A6・A7)は送っていない

    // あとで同じノードを選ぶ
    const again = manualFetch()
    const shown = loadSidebarData('ホバーした記事', caches)
    await new Promise((r) => setTimeout(r, 0))
    for (const req of again.reqs) {
      if (req.url.includes('/page/summary/')) req.release({ title: 'ホバーした記事', extract: '冒頭の文章' })
    }
    await drain(again)
    const data = await shown
    assert.equal(again.reqs.length, 3) // 取り直している
    assert.equal(data.summary.extract, '冒頭の文章')
    assert.equal(data.meta.backlinks, 1)
    assert.equal(caches.preview.get('ホバーした記事').extract, '冒頭の文章')
  })

  test('本当に失敗したものは保存する(以前どおり、取り直さない)', async () => {
    const caches = { preview: new Map(), meta: new Map() }
    mockFetch(() => fakeResponse(500, 'error'))
    const data = await loadSidebarData('失敗する記事', caches)
    assert.equal(data.summary, null)
    assert.deepEqual(data.meta, { category: null, backlinks: null, updated: null })
    assert.equal(caches.preview.get('失敗する記事'), null)
    assert.ok(caches.meta.has('失敗する記事'))
  })
})

// --- 表示中の閲覧数はサイドバーの後 / 戻り値の headers ------------------------------------

describe('閲覧数(views)とサイドバー(mid)の順番', () => {
  test('表示中の閲覧数が待っていても、後から頼んだサイドバーが先に送られる', async () => {
    const state = manualFetch()
    const blockers = fetchPageviews(['順番枠1', '順番枠2', '順番枠3'])
    await new Promise((r) => setTimeout(r, 0))
    const views = fetchPageviews(Array.from({ length: 10 }, (_, i) => `順番閲覧数${i}`)) // 既定 = views
    const sidebar = loadSidebarData('順番サイドバー', { preview: new Map(), meta: new Map() })
    for (let i = 0; i < 3; i++) {
      state.reqs[i].release()
      await new Promise((r) => setTimeout(r, 0))
    }
    // 空いた3枠はサイドバーの3件(R2・A6・A7)に回る
    const next3 = state.reqs.slice(3, 6).map((r) => r.url)
    assert.equal(next3.filter((u) => u.includes('/pageviews/')).length, 0, next3.join('\n'))
    await drain(state)
    await Promise.all([blockers, views, sidebar])
  })
})

describe('fetchWithTimeout: 戻り値', () => {
  test('headers を返す(429 の Retry-After を読むため)', async () => {
    globalThis.fetch = async () => ({
      ...fakeResponse(429, 'Too Many Requests'),
      headers: new Headers({ 'Retry-After': '20' }),
    })
    const res = await fetchWithTimeout('https://example.invalid/429')
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '20')
    assert.equal(await res.text(), 'Too Many Requests')
  })
})
