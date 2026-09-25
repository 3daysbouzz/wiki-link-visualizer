/**
 * MediaWiki API (ja.wikipedia.org) クライアント。
 * SPEC.md 3章に対応。
 *
 * 方針:
 *   関連記事 = 「その記事からリンクされている記事のうち、内容が近い順の上位N件」
 *
 *   「内容が近い」の判定には検索エンジンの morelike:記事名 を使う。
 *   morelike は記事本文の類似度で関連記事を返すので、
 *   「初音ミク」なら「クリプトン・フューチャー・メディア」「鏡音リン・レン」のような
 *   本当に近い記事が上に来て、「アメリカ合衆国」のような汎用記事は自然に落ちる。
 *
 *   以前は閲覧数順にしていたが、MediaWiki API の prop=pageviews は
 *   1リクエストで新たに5件分しか閲覧数を返さない(サーバー側の制限)ため、
 *   数百件のリンク先の閲覧数を集めるのは現実的でなく、
 *   「たまたま閲覧数がキャッシュされていた記事」が上位に並ぶ状態だった。
 *   閲覧数は表示するノード分だけ REST API から別途取る(fetchPageviews)。
 *
 *   さらに前は prop=links&pllimit=40 で「記事名のコード順に先頭40件」を取っていた。
 *   これは関連度と無関係で日付記事だらけになる。
 *
 *   rev2 からは morelike の順位に「相互リンク」「冒頭リンク」の加点を足した
 *   合計スコアで並べる(SPEC 3.3)。morelike は本文の語彙で似ているかを見るので、
 *   キャラクター記事に対する担当声優(出演作の一覧が中心の記事)のように
 *   語彙は違うが関係の強い記事を取りこぼす。それを拾うための加点。
 *
 * CORS:
 *   origin=* を付けると Access-Control-Allow-Origin が動的に返るので、
 *   専用バックエンドなしでブラウザから直接呼べる。
 *   https://www.mediawiki.org/wiki/API:Cross-site_requests
 */

import {
  MAX_CONTINUE,
  PAGEVIEW_DAYS,
  POOL_SIZE,
  GUARANTEED_TOP,
  SAMPLE_BIAS,
  RELATED_LIMIT,
  VIEWS_CONCURRENCY,
  FETCH_TIMEOUT_MS,
  MORELIKE_HALF_RANK,
  W_MORELIKE,
  W_MUTUAL,
  W_LEAD,
  SCORE_DEBUG_ROWS,
} from '../constants.js'

const API_ENDPOINT = 'https://ja.wikipedia.org/w/api.php'
const PAGEVIEWS_ENDPOINT =
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/user'

// 注意: 独自ヘッダ(Api-User-Agent 等)は付けないこと。
// 独自ヘッダを付けるとブラウザが事前確認(preflight)のリクエストを挟み、
// REST API 側がそれに CORS ヘッダを返さないため、取得そのものが失敗する。
// ヘッダなしの素の GET なら事前確認は起きない。

// ---------------------------------------------------------------------------
// 除外フィルタ (SPEC 3.4)
// ---------------------------------------------------------------------------

// 除外1: 日付・年の記事。どの記事からもリンクされていてノイズになる
const DATE_PATTERNS = [
  /^\d{1,4}年$/, // 2007年
  /^\d{1,2}月\d{1,2}日$/, // 8月31日
  /^\d{1,2}月$/, // 12月
  /^\d{1,4}年代$/, // 1990年代
]

/** 除外対象のタイトルなら true */
function isExcludedTitle(title) {
  // 除外1: 日付・年
  if (DATE_PATTERNS.some((re) => re.test(title))) return true

  // 除外2: 一覧・曖昧さ回避
  if (title.includes('一覧')) return true
  if (title.endsWith('(曖昧さ回避)')) return true

  return false
}

// ---------------------------------------------------------------------------
// 共通のリクエスト処理
// ---------------------------------------------------------------------------

/**
 * 時間制限付きの fetch。timeoutMs を過ぎたら AbortController で打ち切る。
 * fetch 自体には時間制限がないので、サーバーが応答を返さないまま黙ると
 * 「FETCHING」のまま永久に待ち続けてしまう。それを避けるためのもの。
 * 打ち切り・接続失敗はどちらも Error を投げる(呼び出し側で文言を決める)
 */
export async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** AbortController による打ち切りかどうか(ネットワーク失敗と文言を分けるため) */
function isAbortError(e) {
  return !!e && (e.name === 'AbortError' || e.name === 'TimeoutError')
}

/**
 * HTTP のエラー応答を、利用者が読んで次の行動が分かる文言にする。
 * 「HTTP 429」だけでは何をすればいいか分からないので、状況別に言い分ける
 */
export function describeHttpError(status) {
  if (status === 429) {
    return 'Wikipedia へのアクセスが集中しています(HTTP 429)。しばらく待ってから再試行してください'
  }
  if (status >= 500) {
    return `Wikipedia 側で障害が起きている可能性があります(HTTP ${status})。時間をおいて再試行してください`
  }
  if (status === 403) {
    return 'Wikipedia にアクセスを拒否されました(HTTP 403)'
  }
  return `Wikipedia APIエラー: HTTP ${status}`
}

async function apiGet(params) {
  const url = `${API_ENDPOINT}?${new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...params,
  }).toString()}`

  let res
  try {
    res = await fetchWithTimeout(url)
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(
        `Wikipedia API の応答が ${Math.round(FETCH_TIMEOUT_MS / 1000)} 秒以内に返りませんでした。時間をおいて再試行してください`
      )
    }
    throw new Error(
      'Wikipedia APIへの接続に失敗しました(ネットワーク/CORSの問題の可能性があります)'
    )
  }

  if (!res.ok) {
    throw new Error(describeHttpError(res.status))
  }

  // 障害時は HTTP 200 でも HTML のエラーページが返ることがある。
  // JSON として読めなければ「形式が不正」として扱う(SyntaxError をそのまま画面に出さない)
  let data
  try {
    data = await res.json()
  } catch (e) {
    throw new Error('Wikipedia APIの応答を読み取れませんでした(JSON ではない応答)')
  }

  if (data && data.error) {
    throw new Error(`Wikipedia APIエラー: ${data.error.info || data.error.code}`)
  }

  return data
}

// ---------------------------------------------------------------------------
// 1. 中心記事の解決
// ---------------------------------------------------------------------------

/**
 * 記事名を正規化・リダイレクト解決する。
 * 存在しない記事はここで弾く(以降の重いリクエストを投げる前に失敗させる)。
 */
async function fetchCenterArticle(title) {
  const data = await apiGet({
    action: 'query',
    titles: title,
    redirects: '1',
  })

  const pages = data.query && data.query.pages
  if (!pages || pages.length === 0) {
    throw new Error('APIレスポンスの形式が不正です')
  }

  const page = pages[0]
  if (page.missing || page.invalid) {
    throw new Error(
      `記事が見つかりませんでした: 「${title}」(表記を確認するか、検索欄の候補から選んでください)`
    )
  }

  return { title: page.title }
}

// ---------------------------------------------------------------------------
// 2. リンク先の取得(継続取得あり)
// ---------------------------------------------------------------------------

/**
 * generator=links でリンク先ページを列挙する。prop=info で記事の長さも取る
 * (スコアが同点のときの並べ替えに使う)。
 *
 * 相互リンクの判定も同じリクエストに相乗りさせる:
 *   prop=links&pltitles=<中心記事> を付けると、各リンク先ページについて
 *   「そのページから中心記事へのリンク」があるときだけ links が返る。
 *   list=backlinks(中心記事への被リンク)と突き合わせる方式も試したが、
 *   初音ミク・綾波レイ・孫悟空 (ドラゴンボール) で結果が完全に一致したうえ、
 *   こちらは追加のリクエストが要らない(待ち時間が増えない)のでこちらを採った。SPEC 3.3
 *
 * 1回で最大500件。それ以上リンクがある記事は continue が返るので
 * MAX_CONTINUE 回まで続けて取る。
 * prop=links 側の続き(plcontinue)は同じ500件の続きなので、回数に数えない
 * (pltitles が1件なら1ページあたり高々1リンクで、実際には起きない)。
 *
 * query.redirects(from→to)も集めておく。冒頭リンク(parse)の名前は
 * リダイレクト解決前なので、候補と突き合わせる前にこれで解決する。
 */
async function fetchLinks(resolvedTitle, onProgress) {
  const merged = new Map() // title => { title, length }
  const mutual = new Set() // 中心記事へリンクし返している候補
  const redirects = new Map() // リダイレクト元 => 先
  let continueParams = {}
  let round = 0
  let requests = 0
  let more = false // 取りきれずに残りがある(上限で打ち切った)

  // requests は plcontinue が万一続いたときの歯止め
  while (round < MAX_CONTINUE && requests < MAX_CONTINUE * 4) {
    requests += 1
    const data = await apiGet({
      action: 'query',
      titles: resolvedTitle,
      generator: 'links',
      gplnamespace: '0', // 標準記事名前空間のみ
      gpllimit: 'max', // 1回あたり最大500件
      prop: 'info|links',
      pltitles: resolvedTitle,
      pllimit: 'max',
      redirects: '1',
      ...continueParams,
    })

    const query = data.query || {}
    for (const page of query.pages || []) {
      if (!page.title || page.missing) continue
      if (!merged.has(page.title)) {
        merged.set(page.title, { title: page.title, length: page.length || 0 })
      }
      if (Array.isArray(page.links) && page.links.length > 0) mutual.add(page.title)
    }
    for (const r of query.redirects || []) {
      if (r.from && r.to) redirects.set(r.from, r.to)
    }

    if (onProgress) onProgress(merged.size)

    more = !!data.continue
    if (!data.continue) {
      round += 1
      break
    }
    // generator の続き(次の500件)のときだけ1回と数える
    if (data.continue.gplcontinue !== continueParams.gplcontinue) round += 1
    continueParams = data.continue
  }

  return {
    candidates: Array.from(merged.values()),
    mutual,
    redirects,
    rounds: round,
    reachedLimit: more,
  }
}

/**
 * 中心記事の冒頭節(section=0。リード文とインフォボックス)にあるリンク先を取る。
 * 「冒頭に出てくる」= 記事の要点に関わる相手、という手がかりにする
 * (キャラクター記事ならインフォボックスに担当声優が載る)。
 *
 * 返すのはリダイレクト解決前の名前(本文に書かれたままのリンク先)。
 *
 * @returns {Promise<Set<string>>}
 */
async function fetchLeadLinks(resolvedTitle) {
  const data = await apiGet({
    action: 'parse',
    page: resolvedTitle,
    prop: 'links',
    section: '0',
    redirects: '1',
  })
  const links = (data.parse && data.parse.links) || []
  const titles = new Set()
  for (const l of links) {
    if (l && l.ns === 0 && l.title) titles.add(l.title)
  }
  return titles
}

// ---------------------------------------------------------------------------
// 3. 関連記事の取得 (morelike 検索)
// ---------------------------------------------------------------------------

/**
 * 検索エンジン(CirrusSearch)の morelike: で「内容が近い記事」を関連度順に取る。
 * 返ってくるのはリンクの有無と無関係な記事群なので、
 * 呼び出し側でリンク先と突き合わせて使う。
 *
 * @returns {Promise<Map<string, number>>} 記事名 => 順位(0始まり)
 */
async function fetchRelatedRanks(resolvedTitle) {
  const data = await apiGet({
    action: 'query',
    list: 'search',
    srsearch: `morelike:${resolvedTitle}`,
    srnamespace: '0',
    srlimit: String(RELATED_LIMIT),
    srprop: '', // タイトルだけあればよい(スニペット等は不要)
  })

  const results = (data.query && data.query.search) || []
  const ranks = new Map()
  results.forEach((r, i) => {
    if (r.title && !ranks.has(r.title)) ranks.set(r.title, i)
  })
  return ranks
}

// ---------------------------------------------------------------------------
// 4. 閲覧数の取得 (Wikimedia REST API)
// ---------------------------------------------------------------------------

// 記事名 => 閲覧数。ページを開いている間だけ有効なメモリキャッシュ
const viewsCache = new Map()

/** YYYYMMDD 形式 */
function formatDate(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * 集計期間を決める。閲覧数の集計は1日遅れで確定するので、
 * 「昨日」を終点にして PAGEVIEW_DAYS 日分さかのぼる。
 */
function pageviewRange() {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (PAGEVIEW_DAYS - 1))
  return { start: formatDate(start), end: formatDate(end) }
}

/** 1記事分の閲覧数を取る。データが無い記事(404)は 0 とする */
async function fetchOnePageviews(title, range) {
  // REST API のパスでは空白をアンダースコアにし、「/」等はエスケープする
  const encoded = encodeURIComponent(title.replace(/ /g, '_'))
  const url = `${PAGEVIEWS_ENDPOINT}/${encoded}/daily/${range.start}/${range.end}`

  const res = await fetchWithTimeout(url)
  if (res.status === 404) return 0
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const data = await res.json()
  let total = 0
  for (const item of data.items || []) {
    if (typeof item.views === 'number') total += item.views
  }
  return total
}

// 閲覧数の取得待ちの行列。表示中のノード(high)を先に、追加表示の先読み(low)を後に取る。
// 呼び出しごとに作業者を立てると、表示分と先読みが重なったときに同時実行数が
// VIEWS_CONCURRENCY を超えてしまうので、行列と作業者はアプリ全体で1つにする
const viewsQueues = { high: [], low: [] }
// 記事名 => 取得中の job(同じ記事を二重に取りにいかないため)
const viewsPending = new Map()
let viewsActive = 0

/** 空いている作業枠の分だけ、high → low の順に行列から取り出して取りにいく */
function pumpViews() {
  while (viewsActive < VIEWS_CONCURRENCY) {
    const job = viewsQueues.high.shift() || viewsQueues.low.shift()
    if (!job) return
    viewsActive += 1
    job.started = true
    fetchOnePageviews(job.title, job.range)
      .then((views) => {
        viewsCache.set(job.title, views)
        job.resolve(views)
      })
      .catch(() => job.resolve(null))
      .finally(() => {
        viewsPending.delete(job.title)
        viewsActive -= 1
        pumpViews()
      })
  }
}

/** 1記事分の取得を行列に入れる。取得中・待機中なら同じ job を使い回す */
function enqueueViews(title, range, priority) {
  let job = viewsPending.get(title)
  if (job) {
    // 先読みで待っていた記事が表示されることになったら、先頭側の行列へ移す
    if (priority === 'high' && !job.started && job.priority === 'low') {
      viewsQueues.low.splice(viewsQueues.low.indexOf(job), 1)
      viewsQueues.high.push(job)
      job.priority = 'high'
    }
    return job.promise
  }
  job = { title, range, priority, started: false }
  job.promise = new Promise((resolve) => {
    job.resolve = resolve
  })
  viewsPending.set(title, job)
  viewsQueues[priority].push(job)
  return job.promise
}

/**
 * 複数記事の閲覧数を取り、1件取れるごとに onEach(title, views) を呼ぶ。
 *
 * 1記事=1リクエストなので、同時実行数を VIEWS_CONCURRENCY に抑える
 * (一度に投げすぎると 429 Too Many Requests で拒否される)。
 * 取得済みの記事は即座にキャッシュから返す。
 * 失敗した記事は無視する(閲覧数は見た目の補助なので、取れなくても散歩は続けられる)。
 *
 * priority='low' は追加表示の先読み用。表示中の取得(high)が残っている間は始めない。
 *
 * @param {string[]} titles
 * @param {(title:string, views:number)=>void} [onEach]
 * @param {{ priority?: 'high'|'low' }} [options]
 * @returns {Promise<void>} 全件の処理が終わったら解決する
 */
export async function fetchPageviews(titles, onEach = () => {}, { priority = 'high' } = {}) {
  const range = pageviewRange()
  const waits = []

  for (const title of titles) {
    const cached = viewsCache.get(title)
    if (cached !== undefined) {
      onEach(title, cached)
    } else {
      waits.push(
        enqueueViews(title, range, priority).then((views) => ({ title, views }))
      )
    }
  }
  if (waits.length === 0) return

  const startedAt = performance.now()
  pumpViews()
  const results = await Promise.all(waits)
  let failed = 0
  for (const { title, views } of results) {
    if (views === null) failed += 1
    else onEach(title, views)
  }

  console.info(
    '[pageviews] %d件を%dmsで取得%s%s',
    waits.length,
    Math.round(performance.now() - startedAt),
    priority === 'low' ? ' (先読み)' : '',
    failed > 0 ? ` (失敗${failed}件)` : ''
  )
}

// ---------------------------------------------------------------------------
// 5. 関連スコア (SPEC 3.3)
// ---------------------------------------------------------------------------

/** 重みの既定値(current プリセットと同じ = 加点なし) */
const DEFAULT_WEIGHTS = { wMorelike: W_MORELIKE, wMutual: W_MUTUAL, wLead: W_LEAD }

/**
 * morelike の順位(0始まり)を 0〜1 の値にする。圏外(undefined/null)は 0。
 * 順位そのものではなく緩やかに減る値にしているのは、
 * 他の要素(0/1)と足し合わせられる尺度に揃えるため
 */
export function morelikeValue(rank) {
  if (rank === undefined || rank === null) return 0
  return 1 / (1 + rank / MORELIKE_HALF_RANK)
}

/**
 * 候補の素材から合計スコアを計算し、スコアの高い順に並べる(純粋関数)。
 *
 *   score = wMorelike × m + wMutual × mutual + wLead × lead
 *
 * 同点は記事の長さの降順、それも同じならタイトル順(コードポイント順)。
 * localeCompare は環境で結果が変わりうるので使わない(順序を決定論的にするため)。
 *
 * @param {{title:string, length:number, rank?:number|null, mutual:0|1, lead:0|1}[]} materials
 * @param {{wMorelike:number, wMutual:number, wLead:number}} weights
 * @returns {{title:string, length:number, m:number, mutual:0|1, lead:0|1, score:number}[]}
 */
export function rankCandidates(materials, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights }
  const scored = materials.map((c) => {
    const m = morelikeValue(c.rank)
    const mutual = c.mutual ? 1 : 0
    const lead = c.lead ? 1 : 0
    return {
      title: c.title,
      length: c.length || 0,
      m,
      mutual,
      lead,
      score: w.wMorelike * m + w.wMutual * mutual + w.wLead * lead,
    }
  })
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.length - a.length ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
  )
  return scored
}

/**
 * 素材から候補プール(上位 POOL_SIZE 件)を作る。
 * 並べ替えは linkCache から取り出すたびに行う
 * (重みを変えたとき、キャッシュ済みの記事にも反映されるように)
 */
function buildPool(materials, weights) {
  return rankCandidates(materials, weights).slice(0, POOL_SIZE)
}

// ---------------------------------------------------------------------------
// 6. リンクの抽選 (SPEC 3.5)
// ---------------------------------------------------------------------------

/**
 * 関連度順に並んだ候補プールから、実際に表示するリンクを選ぶ。
 *
 * 単純に上位から取ると、同じ記事を展開しても毎回同じ顔ぶれになり、
 * 下位のつながりには永遠にたどり着けない。散歩としてつまらないので、
 * 上位の一部は確定で出しつつ、残りは順位に応じた重みで抽選する。
 *
 * 乱数は呼び出し側から渡す(random: () => [0,1))。
 * 種付きの乱数を渡せば (seed, 記事名) が同じ限り同じ顔ぶれになり、
 * 設定を変えて比較するときに条件を揃えられる。違う道が見たければ seed を変える。
 */
export function pickLinks(pool, limit, random = Math.random) {
  if (pool.length <= limit) return pool.slice()

  // 上位は確定で出す(当たり前の関連記事が消えてしまわないように)
  const guaranteed = pool.slice(0, Math.min(GUARANTEED_TOP, limit))
  const rest = pool.slice(guaranteed.length)
  const need = limit - guaranteed.length
  if (need <= 0 || rest.length === 0) return guaranteed

  // 重み付き抽選(非復元)。重みは順位が下がるほど小さいがゼロにはしない
  const weights = rest.map((_, i) => 1 / (i + SAMPLE_BIAS))
  const picked = []
  let totalWeight = weights.reduce((a, b) => a + b, 0)

  for (let n = 0; n < need && rest.length > 0; n++) {
    let r = random() * totalWeight
    let index = weights.length - 1
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]
      if (r <= 0) {
        index = i
        break
      }
    }
    picked.push(rest[index])
    totalWeight -= weights[index]
    rest.splice(index, 1)
    weights.splice(index, 1)
  }

  return guaranteed.concat(picked)
}

// ---------------------------------------------------------------------------
// 7. 公開API
// ---------------------------------------------------------------------------

// 取得済みの候補の「素材」をタイトルごとに覚えておく。
// 一度歩いた記事に戻ってきたときの再取得(数秒かかる)をなくすため。
// ページを開いている間だけ有効なメモリキャッシュ。
//
// 並べ替え後のプールではなく、スコア計算前の素材(morelike 順位・mutual・lead・length)を
// 持つ。並べ替えと抽選は取り出すときに行う。そうしないと重みを変えても
// キャッシュ済みの記事に反映されない
const linkCache = new Map()

/** ?debug=1 のとき、プール上位のスコアの内訳を表で出す(重みの調整に使う) */
function logScoreTable(title, pool) {
  console.info('[wikipedia] %s: スコアの内訳(上位%d件)', title, SCORE_DEBUG_ROWS)
  console.table(
    pool.slice(0, SCORE_DEBUG_ROWS).map((c) => ({
      title: c.title,
      m: Number(c.m.toFixed(3)),
      mutual: c.mutual,
      lead: c.lead,
      score: Number(c.score.toFixed(3)),
    }))
  )
}

/** 確定枠(上位 GUARANTEED_TOP)のうち morelike 圏外の件数。加点がどれだけ効いたかの目安 */
function countOutsideMorelike(pool) {
  return pool.slice(0, GUARANTEED_TOP).filter((c) => c.m === 0).length
}

/**
 * 補助情報の取得。失敗しても展開全体は止めず、空として続ける
 * (閲覧数と同じ「補助情報は取れなくても止めない」扱い)
 */
function optional(promise, label, empty) {
  return promise.catch((e) => {
    console.warn('[wikipedia] %sを取得できませんでした(加点なしで続行): %s', label, e.message)
    return empty
  })
}

/**
 * 指定記事の関連記事を、関連スコアの高い順のプールから抽選して取得する。
 * 閲覧数は含まない(表示するノード分だけ fetchPageviews で別途取ること)。
 *
 * @param {string} title 記事名
 * @param {object} [options]
 * @param {number} [options.limit] 返すリンク数の上限
 * @param {(count:number)=>void} [options.onProgress] 取得済み候補数の通知
 * @param {boolean} [options.assumeCanonical]
 *   タイトルが正規化済みだと分かっている場合に true。
 *   グラフ上のノードから展開するときは、そのタイトルはAPIが返したものなので
 *   正規化済み。この場合「中心記事の解決」を待たずにリンク取得を始めら
 *   れるので、直列だった2つのリクエストを並列にできる(往復1回分の短縮)。
 * @param {(resolvedTitle:string) => () => number} [options.randomFor]
 *   抽選に使う乱数を「解決後の記事名」から作る関数。
 *   入力の表記ゆれに関係なく同じ記事なら同じ抽選になるよう、解決後の名前で作る。
 *   省略時は Math.random
 * @param {{wMorelike:number, wMutual:number, wLead:number}} [options.weights]
 *   関連スコアの重み(SPEC 3.3)。省略時は加点なし(current と同じ)
 * @param {boolean} [options.debug] true ならスコアの内訳を console.table に出す
 * @returns {Promise<{ title:string, links:{title:string}[] }>}
 */
export async function fetchLinkedArticles(title, options = {}) {
  const {
    limit = 40,
    onProgress,
    assumeCanonical = false,
    randomFor = () => Math.random,
    weights = DEFAULT_WEIGHTS,
    debug = false,
  } = options

  const trimmed = title.trim()
  if (!trimmed) {
    throw new Error('記事名を入力してください')
  }

  const cached = linkCache.get(trimmed)
  if (cached) {
    // キャッシュがあっても並べ替えと抽選はやり直す
    // (重みが同じ・乱数が種付きなら同じ結果になる)
    const pool = buildPool(cached.materials, weights)
    console.info('[wikipedia] %s: キャッシュから取得(再抽選)', cached.title)
    if (debug) logScoreTable(cached.title, pool)
    return {
      title: cached.title,
      links: pickLinks(pool, limit, randomFor(cached.title)).map((c) => ({ title: c.title })),
    }
  }

  const startedAt = performance.now()

  let center
  let linkResult
  let ranks
  let leadRaw

  // 冒頭リンクは補助情報。失敗しても 0 として続ける
  const lead = (t) => optional(fetchLeadLinks(t), '冒頭リンク', null)

  if (assumeCanonical) {
    // タイトルが確定しているので、4つのリクエストを同時に投げる
    ;[center, linkResult, ranks, leadRaw] = await Promise.all([
      fetchCenterArticle(trimmed),
      fetchLinks(trimmed, onProgress),
      fetchRelatedRanks(trimmed),
      lead(trimmed),
    ])
  } else {
    // ユーザー入力はリダイレクトや表記ゆれの可能性があるので、
    // まず正規化してから(存在しない記事もここで弾ける)残りを同時に取りにいく
    center = await fetchCenterArticle(trimmed)
    ;[linkResult, ranks, leadRaw] = await Promise.all([
      fetchLinks(center.title, onProgress),
      fetchRelatedRanks(center.title),
      lead(center.title),
    ])
  }

  const { candidates, mutual, redirects, rounds, reachedLimit } = linkResult

  // 冒頭リンクの名前をリダイレクト解決してから候補と照合する
  // (parse はリダイレクト解決前の名前を返し、候補は解決後の名前なので)
  const leadSet = new Set()
  if (leadRaw) {
    for (const t of leadRaw) leadSet.add(redirects.get(t) || t)
  }

  // --- 除外フィルタと素材づくり ---
  let excludedByTitle = 0
  let related = 0
  let mutualCount = 0
  let leadCount = 0
  const materials = []
  for (const c of candidates) {
    if (c.title === center.title) continue
    if (isExcludedTitle(c.title)) {
      excludedByTitle += 1
      continue
    }
    const rank = ranks.get(c.title)
    const m = {
      title: c.title,
      length: c.length,
      rank: rank === undefined ? null : rank,
      mutual: mutual.has(c.title) ? 1 : 0,
      lead: leadSet.has(c.title) ? 1 : 0,
    }
    if (m.rank !== null) related += 1
    mutualCount += m.mutual
    leadCount += m.lead
    materials.push(m)
  }

  const entry = { title: center.title, materials }
  linkCache.set(trimmed, entry)
  if (center.title !== trimmed) linkCache.set(center.title, entry)

  // --- 並べ替え(合計スコア順)と抽選 ---
  const pool = buildPool(materials, weights)
  const picked = pickLinks(pool, limit, randomFor(center.title))
  const elapsed = Math.round(performance.now() - startedAt)

  console.info(
    '[wikipedia] %s: %dms / リンク先%d件(%d回取得%s) / 除外: 日付等%d件 / ' +
      'morelike一致%d件 / 相互リンク%d件 / 冒頭リンク%d件%s / ' +
      '確定枠のうちmorelike圏外%d件 → プール%d件から%d件抽選',
    center.title,
    elapsed,
    candidates.length,
    rounds,
    reachedLimit ? ', 上限打ち切り' : '',
    excludedByTitle,
    related,
    mutualCount,
    leadCount,
    leadRaw ? '' : '(取得失敗)',
    countOutsideMorelike(pool),
    pool.length,
    picked.length
  )
  if (debug) logScoreTable(center.title, pool)

  if (related < GUARANTEED_TOP) {
    console.warn(
      '[wikipedia] morelike と一致するリンク先が%d件しかありません。' +
        '短い記事や特殊な記事では関連度の情報が薄く、相互リンク・冒頭リンク・記事の長さで埋めています。',
      related
    )
  }

  return { title: center.title, links: picked.map((c) => ({ title: c.title })) }
}

// ---------------------------------------------------------------------------
// 7b. 関連リンクの追加表示 (SPEC 5章・6.8)
// ---------------------------------------------------------------------------

/**
 * 候補プールのうち、まだ表示していないものをスコア順に並べて返す。
 * 抽選はしない(「もう少し見たい」ときは関連の強い順に出す方が期待に合う)。
 * 追加で Wikipedia には問い合わせない(候補は展開時に linkCache に入っている)。
 */
function unshownPool(title, shownTitles, weights) {
  const cached = linkCache.get(title)
  if (!cached) return []
  const shown = shownTitles instanceof Set ? shownTitles : new Set(shownTitles)
  return buildPool(cached.materials, weights).filter(
    (c) => c.title !== cached.title && !shown.has(c.title)
  )
}

/**
 * 追加で出すリンクを返す(スコアの高い順に count 件)。
 * 残りが count 件未満ならあるだけ返し、無ければ空配列。
 *
 * @param {string} title 展開済みの記事名(解決後)
 * @param {Iterable<string>} shownTitles 表示済みの記事名(これらは除く)
 * @param {number} count 返す件数の上限(moreBudget で上限 moreMax を考慮した値を渡す)
 * @param {{wMorelike:number, wMutual:number, wLead:number}} [weights]
 *   その記事を展開したときの重み。今の重みではなく展開時の重みを使うのは、
 *   「重みの変更は次に展開する記事から効く」(SPEC 3.3)と揃えるため
 * @returns {{title:string}[]}
 */
export function getMoreLinks(title, shownTitles, count, weights = DEFAULT_WEIGHTS) {
  if (!(count > 0)) return []
  return unshownPool(title, shownTitles, weights)
    .slice(0, count)
    .map((c) => ({ title: c.title }))
}

/** まだ表示していない候補の件数(上限 moreMax は考慮しない) */
export function countMoreLinks(title, shownTitles, weights = DEFAULT_WEIGHTS) {
  return unshownPool(title, shownTitles, weights).length
}

/**
 * 今回の追加で出してよい件数。1記事あたりの追加の上限 moreMax を超えないようにする。
 * @param {number} added その記事にこれまで追加した件数
 */
export function moreBudget(added, moreBatch, moreMax) {
  return Math.max(0, Math.min(moreBatch, moreMax - added))
}

// ---------------------------------------------------------------------------
// 8. サイドバー用のメタ情報(カテゴリ・被リンク数・更新日)
// ---------------------------------------------------------------------------

// 記事名 => メタ情報。同じノードに何度もカーソルが乗るので都度取らない
const metaCache = new Map()

/** API の touched(ISO 8601)を YYYY-MM-DD にする */
function formatTouched(touched) {
  if (!touched || typeof touched !== 'string') return null
  return touched.slice(0, 10)
}

/**
 * サイドバーに出すメタ情報を取る。2リクエスト。
 *   1. prop=categories|info … 主カテゴリ(先頭の非隠しカテゴリ)と更新日(touched)
 *   2. list=search&srsearch=linksto:"記事名" … 被リンク数(searchinfo.totalhits)
 *      (prop=linkshere は件数だけ取る手段がなく全件走査になるため、検索の件数を使う)
 *
 * 補助情報なので失敗してもエラーを投げない。取れなかった項目は null にして、
 * 表示側は「—」を出す。
 *
 * @returns {Promise<{ category:string|null, backlinks:number|null, updated:string|null }>}
 */
export async function fetchArticleMeta(title) {
  const cached = metaCache.get(title)
  if (cached) return cached

  const meta = { category: null, backlinks: null, updated: null }

  const infoPromise = apiGet({
    action: 'query',
    titles: title,
    prop: 'categories|info',
    clshow: '!hidden',
    cllimit: '5',
    redirects: '1',
  })
    .then((data) => {
      const page = data.query && data.query.pages && data.query.pages[0]
      if (!page || page.missing) return
      const cat = page.categories && page.categories[0]
      if (cat && cat.title) meta.category = cat.title.replace(/^Category:/, '')
      meta.updated = formatTouched(page.touched)
    })
    .catch(() => {})

  const backlinksPromise = apiGet({
    action: 'query',
    list: 'search',
    srsearch: `linksto:"${title}"`,
    srnamespace: '0',
    srlimit: '1',
    srprop: '',
    srinfo: 'totalhits',
  })
    .then((data) => {
      const info = data.query && data.query.searchinfo
      if (info && typeof info.totalhits === 'number') meta.backlinks = info.totalhits
    })
    .catch(() => {})

  await Promise.all([infoPromise, backlinksPromise])
  metaCache.set(title, meta)
  return meta
}

// ---------------------------------------------------------------------------
// 9. 検索候補(オートコンプリート)
// ---------------------------------------------------------------------------

/**
 * 入力途中の文字列に対する記事名の候補を返す(action=opensearch)。
 * 存在する記事しか候補に出ないので、候補から選べば「記事が見つからない」は起きない。
 *
 * 「該当なし(空配列)」と「取得できなかった(null)」は区別して返す。
 * 検索欄は前者なら「候補が見つかりません」と出し、後者なら何も出さない
 * (通信失敗のたびに「見つかりません」と出すと、記事が無いと誤解させるため)。
 * どちらの場合も操作は続けられる。
 *
 * @returns {Promise<string[] | null>}
 */
export async function fetchSuggestions(query, limit = 8) {
  const q = query.trim()
  if (!q) return []
  const url = `${API_ENDPOINT}?${new URLSearchParams({
    action: 'opensearch',
    search: q,
    limit: String(limit),
    namespace: '0',
    format: 'json',
    origin: '*',
  }).toString()}`
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return null
    const data = await res.json()
    // opensearch の返り値は [入力, 候補配列, 説明配列, URL配列]
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : null
  } catch (e) {
    return null
  }
}
