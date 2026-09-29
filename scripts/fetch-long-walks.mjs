/**
 * 長い経路(中心8件)の展開結果を Wikipedia から一度だけ取り、tests/fixtures/long-walk-routes.json に保存する(タスク11)。
 * 輪の起きやすさを数える(docs/tasks/11-report-loops.md)ための材料。表示と同じ fetchLinkedArticles で、
 * rev5 と同じ重み(rev2)・種 1・40件(neighborLimit 24 も 40 も、先頭から切り詰めて同じ抽選になる)で取る。
 *
 *   node scripts/fetch-long-walks.mjs
 *
 * Wikipedia に負担をかけないよう、1記事ごとに間隔をあける。同じ記事は一度しか取らない。
 * 保存した後は取り直さない(Wikipedia は日々変わるので、取り直すと数字が変わる)
 *
 * Node から問い合わせるときだけ、Wikimedia の決まり(User-Agent で問い合わせ元を名乗る)に従って User-Agent を付ける。
 * 付けないと Node の既定の名前になり、HTTP 429 で断られた。アプリ(ブラウザ)の fetch には付けない
 * (ブラウザでは独自ヘッダが事前確認(preflight)を起こし、REST API が CORS ヘッダを返さず失敗するため。CLAUDE.md)。
 * 429 が返ったり接続に失敗したりしたら、間をあけて取り直す。
 * 環境変数 WALK_CACHE にファイルの場所を渡すと、取った展開結果をそこに書き足し、途中で止まっても続きから取れる
 */
import fs from 'node:fs'
import { fetchLinkedArticles } from '../src/api/wikipedia.js'
import { seededRandom } from '../src/utils/prng.js'
import { PRESETS } from '../src/config/presets.ts'
import { nextWalkStep } from '../src/debug/walks.js'

const STARTS = ['初音ミク', '流体力学', '綾波レイ', 'コーヒー', '富士山']
const MODES = ['top', 'draw']
const CENTERS = 8
const LIMIT = 40
const PAUSE_MS = 3000
const RETRY_WAIT_MS = [20000, 60000, 120000]
const USER_AGENT = 'wiki-link-visualizer-dev/0.1 (fixture fetch for tests; https://github.com/3daysbouzz/wiki-link-visualizer)'

// このスクリプトの中だけ fetch に User-Agent を付ける(上の説明)
const nodeFetch = globalThis.fetch
globalThis.fetch = (url, init = {}) =>
  nodeFetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': USER_AGENT } })
const OUT = new URL('../tests/fixtures/long-walk-routes.json', import.meta.url)

const c = PRESETS.rev5
const weights = { wMorelike: c.wMorelike, wMutual: c.wMutual, wLead: c.wLead }
const CACHE_FILE = process.env.WALK_CACHE || null
const cache = new Map(
  CACHE_FILE && fs.existsSync(CACHE_FILE) ? Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))) : []
)
const saveCache = () => {
  if (CACHE_FILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function expand(title, assumeCanonical) {
  if (cache.has(title)) return cache.get(title)
  await sleep(PAUSE_MS)
  let r
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetchLinkedArticles(title, {
        limit: LIMIT,
        assumeCanonical,
        randomFor: (resolved) => seededRandom(c.seed, resolved),
        weights,
      })
      break
    } catch (e) {
      if (!/429|接続に失敗/.test(e.message) || attempt >= RETRY_WAIT_MS.length) throw e
      console.log(`  ${e.message}: ${RETRY_WAIT_MS[attempt] / 1000}秒待って取り直す`)
      await sleep(RETRY_WAIT_MS[attempt])
    }
  }
  const value = { title: r.title, links: r.links }
  cache.set(title, value)
  cache.set(r.title, value)
  saveCache()
  console.log(`  ${title}${r.title !== title ? ` → ${r.title}` : ''}: ${r.links.length}件`)
  return value
}

const out = {}
for (const start of STARTS) {
  for (const mode of MODES) {
    console.log(`long-${mode}-${start}`)
    const first = await expand(start, false)
    const trail = [first.title]
    const expansions = { [first.title]: first.links }
    while (trail.length < CENTERS) {
      const next = nextWalkStep(expansions[trail[trail.length - 1]], new Set(trail), mode, c.neighborLimit)
      if (!next) break
      const r = await expand(next, true)
      // リダイレクトで別の名前に解決されたら、そこで止める(保存した展開結果から経路を作り直すとき、子の名前で引けなくなるため。
      // 経路上の記事に解決された場合は、アプリでも並び替わるだけで経路が伸びない)
      if (r.title !== next) {
        console.log(`  止める: ${next} は ${r.title} に解決された`)
        break
      }
      trail.push(r.title)
      expansions[r.title] = r.links
    }
    out[`long-${mode}-${start}`] = { mode, trail, expansions }
  }
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log('saved', OUT.pathname)
