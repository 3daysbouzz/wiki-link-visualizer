/**
 * src/api/wikipedia.js のエラー処理と抽選の決定論のテスト。
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
} from '../src/api/wikipedia.js'
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
