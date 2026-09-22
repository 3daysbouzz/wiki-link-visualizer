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
 * (morelike に出てこなかったリンク先を並べるときの目安にする)。
 *
 * 1回で最大500件。それ以上リンクがある記事は continue が返るので
 * MAX_CONTINUE 回まで続けて取る。
 */
async function fetchLinks(resolvedTitle, onProgress) {
  const merged = new Map() // title => { title, length }
  let continueParams = {}
  let round = 0

  while (round < MAX_CONTINUE) {
    round += 1

    const data = await apiGet({
      action: 'query',
      titles: resolvedTitle,
      generator: 'links',
      gplnamespace: '0', // 標準記事名前空間のみ
      gpllimit: 'max', // 1回あたり最大500件
      prop: 'info',
      redirects: '1',
      ...continueParams,
    })

    const pages = (data.query && data.query.pages) || []
    for (const page of pages) {
      if (!page.title || page.missing) continue
      if (!merged.has(page.title)) {
        merged.set(page.title, { title: page.title, length: page.length || 0 })
      }
    }

    if (onProgress) onProgress(merged.size)

    if (!data.continue) break
    continueParams = data.continue
  }

  const reachedLimit = round >= MAX_CONTINUE
  return { candidates: Array.from(merged.values()), rounds: round, reachedLimit }
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

/**
 * 複数記事の閲覧数を取り、1件取れるごとに onEach(title, views) を呼ぶ。
 *
 * 1記事=1リクエストなので、同時実行数を VIEWS_CONCURRENCY に抑える
 * (一度に投げすぎると 429 Too Many Requests で拒否される)。
 * 取得済みの記事は即座にキャッシュから返す。
 * 失敗した記事は無視する(閲覧数は見た目の補助なので、取れなくても散歩は続けられる)。
 *
 * @returns {Promise<void>} 全件の処理が終わったら解決する
 */
export async function fetchPageviews(titles, onEach) {
  const range = pageviewRange()
  const queue = []

  for (const title of titles) {
    const cached = viewsCache.get(title)
    if (cached !== undefined) {
      onEach(title, cached)
    } else {
      queue.push(title)
    }
  }
  if (queue.length === 0) return

  const startedAt = performance.now()
  let failed = 0

  const worker = async () => {
    while (queue.length > 0) {
      const title = queue.shift()
      try {
        const views = await fetchOnePageviews(title, range)
        viewsCache.set(title, views)
        onEach(title, views)
      } catch (e) {
        failed += 1
      }
    }
  }

  const workers = []
  for (let i = 0; i < VIEWS_CONCURRENCY; i++) workers.push(worker())
  await Promise.all(workers)

  console.info(
    '[pageviews] %d件を%dmsで取得%s',
    titles.length,
    Math.round(performance.now() - startedAt),
    failed > 0 ? ` (失敗${failed}件)` : ''
  )
}

// ---------------------------------------------------------------------------
// 5. リンクの抽選 (SPEC 3.5)
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
// 6. 公開API
// ---------------------------------------------------------------------------

// 取得済みの候補プールをタイトルごとに覚えておく。
// 一度歩いた記事に戻ってきたときの再取得(数秒かかる)をなくすため。
// ページを開いている間だけ有効なメモリキャッシュ。
const linkCache = new Map()

/**
 * 指定記事の関連記事を、内容の近い順に取得する。
 * 閲覧数は含まない(表示するノード分だけ fetchPageviews で別途取ること)。
 *
 * @param {string} title 記事名
 * @param {number} limit 返すリンク数の上限
 * @param {(count:number)=>void} [onProgress] 取得済み候補数の通知
 * @param {boolean} [assumeCanonical]
 *   タイトルが正規化済みだと分かっている場合に true。
 *   グラフ上のノードから展開するときは、そのタイトルはAPIが返したものなので
 *   正規化済み。この場合「中心記事の解決」を待たずにリンク取得を始めら
 *   れるので、直列だった2つのリクエストを並列にできる(往復1回分の短縮)。
 * @param {(resolvedTitle:string) => () => number} [randomFor]
 *   抽選に使う乱数を「解決後の記事名」から作る関数。
 *   入力の表記ゆれに関係なく同じ記事なら同じ抽選になるよう、解決後の名前で作る。
 *   省略時は Math.random
 * @returns {Promise<{ title:string, links:{title:string}[] }>}
 */
export async function fetchLinkedArticles(
  title,
  limit,
  onProgress,
  assumeCanonical = false,
  randomFor = () => Math.random
) {
  const trimmed = title.trim()
  if (!trimmed) {
    throw new Error('記事名を入力してください')
  }

  const cached = linkCache.get(trimmed)
  if (cached) {
    // キャッシュがあっても抽選はやり直す(乱数が種付きなら同じ結果になる)
    console.info('[wikipedia] %s: キャッシュから取得(再抽選)', trimmed)
    return {
      title: cached.title,
      links: pickLinks(cached.pool, limit, randomFor(cached.title)),
    }
  }

  const startedAt = performance.now()

  let center
  let linkResult
  let ranks

  if (assumeCanonical) {
    // タイトルが確定しているので、3つのリクエストを同時に投げる
    ;[center, linkResult, ranks] = await Promise.all([
      fetchCenterArticle(trimmed),
      fetchLinks(trimmed, onProgress),
      fetchRelatedRanks(trimmed),
    ])
  } else {
    // ユーザー入力はリダイレクトや表記ゆれの可能性があるので、
    // まず正規化してから(存在しない記事もここで弾ける)残りを同時に取りにいく
    center = await fetchCenterArticle(trimmed)
    ;[linkResult, ranks] = await Promise.all([
      fetchLinks(center.title, onProgress),
      fetchRelatedRanks(center.title),
    ])
  }

  const { candidates, rounds, reachedLimit } = linkResult

  // --- 除外フィルタ ---
  let excludedByTitle = 0
  const filtered = candidates.filter((c) => {
    if (c.title === center.title) return false
    if (isExcludedTitle(c.title)) {
      excludedByTitle += 1
      return false
    }
    return true
  })

  // --- 並べ替え ---
  // morelike に出てきたリンク先をその順位で先頭に置き、
  // 出てこなかったものは記事の長さ(書き込まれている量)が多い順で後ろに続ける。
  // 後ろの方は抽選の重みが小さいので、たまに顔を出す程度になる
  const related = []
  const others = []
  for (const c of filtered) {
    const rank = ranks.get(c.title)
    if (rank !== undefined) related.push({ ...c, rank })
    else others.push(c)
  }
  related.sort((a, b) => a.rank - b.rank)
  others.sort((a, b) => b.length - a.length)

  const pool = related
    .concat(others)
    .slice(0, POOL_SIZE)
    .map((c) => ({ title: c.title }))

  const entry = { title: center.title, pool }
  linkCache.set(trimmed, entry)
  if (center.title !== trimmed) linkCache.set(center.title, entry)

  const picked = pickLinks(pool, limit, randomFor(center.title))
  const elapsed = Math.round(performance.now() - startedAt)

  console.info(
    '[wikipedia] %s: %dms / リンク先%d件(%d回取得%s) / 除外: 日付等%d件 / ' +
      'morelike一致%d件 → プール%d件から%d件抽選',
    center.title,
    elapsed,
    candidates.length,
    rounds,
    reachedLimit ? ', 上限打ち切り' : '',
    excludedByTitle,
    related.length,
    pool.length,
    picked.length
  )

  if (related.length < GUARANTEED_TOP) {
    console.warn(
      '[wikipedia] morelike と一致するリンク先が%d件しかありません。' +
        '短い記事や特殊な記事では関連度の情報が薄く、記事の長さ順で埋めています。',
      related.length
    )
  }

  return { title: center.title, links: picked }
}

// ---------------------------------------------------------------------------
// 7. サイドバー用のメタ情報(カテゴリ・被リンク数・更新日)
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
// 8. 検索候補(オートコンプリート)
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
