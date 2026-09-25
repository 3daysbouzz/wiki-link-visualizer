/**
 * 関連の強さを配置と動きに反映するための計算(SPEC 6.9)。Graph3D・App から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる。
 *
 *   - 関連スコアを 0〜1 にならす(normalizeScore)
 *   - 線ごとのバネの自然長(computeEdgeSpringLength)
 *   - 前後の中心に共通する関連ワード(sharedTitles)
 *   - データパケットを流す経路(packetRoutesFor)
 *   - 相互リンクの線の脈動(mutualPulseFactor)
 */

const clamp01 = (x) => Math.min(Math.max(x, 0), 1)
const lerp = (a, b, t) => a + (b - a) * t

/**
 * 合計スコアを 0〜1 にならす。
 *
 *   relScore = clamp(score / (wMorelike + wMutual + wLead), 0, 1)
 *
 * m ∈ [0,1]、mutual・lead ∈ {0,1} なので、score の最大は重みの合計になる。
 * 生の値のまま距離に使うと、重みを調整するたびに距離感まで変わってしまうので割っておく。
 * 重みはその記事を展開したときのものを渡すこと(SPEC 3.3「重みの変更は次に展開する記事から効く」)。
 * 重みが全部 0 なら、関連の強さの手がかりが無いので 0 とする(0 で割らない)
 */
export function normalizeScore(score, weights) {
  const total = (weights.wMorelike || 0) + (weights.wMutual || 0) + (weights.wLead || 0)
  if (!(total > 0) || !Number.isFinite(score)) return 0
  return clamp01(score / total)
}

/**
 * 線のバネの自然長(ワールド座標)。
 *
 * distanceByScore が off なら、どの線も従来どおり config.springLength。
 * on なら線の種類で分ける:
 *   child … 関連が強い(relScore が高い)ほど短い。childSpringMax → childSpringMin を線形に
 *   trail … 中心同士。基準の trailSpringBase から、相互リンクと共通ワードの数だけ縮める。
 *           childSpringMin より短くはしない
 *
 * trail の式は child の値(下限の childSpringMin を除く)を参照しない。
 * 中心同士の距離は将来、子と独立した基準に変える可能性があるので、
 * そのときはこの分岐だけを書き換えれば済むようにしている
 *
 * @param {{type?:'child'|'trail', relScore?:number, mutual?:0|1, sharedCount?:number}} edge
 */
export function computeEdgeSpringLength(edge, config) {
  if (!config.distanceByScore) return config.springLength

  if (edge.type === 'child') {
    return lerp(config.childSpringMax, config.childSpringMin, clamp01(edge.relScore || 0))
  }

  if (edge.type === 'trail') {
    const shared = Math.min(edge.sharedCount || 0, config.trailSharedCap)
    const length =
      config.trailSpringBase -
      config.trailMutualBonus * (edge.mutual ? 1 : 0) -
      config.trailSharedBonus * shared
    return Math.max(config.childSpringMin, length)
  }

  // 種類の分からない線(ここには来ない想定)は従来どおり
  return config.springLength
}

/**
 * 2つの中心の展開結果に共通する記事名。並びは b(今の中心)の順(=関連の強い順)。
 * 中心自身(exclude)は数えない。同じ記事が重複していても1回だけ数える
 *
 * @param {{title:string}[]|undefined} a 1つ前の中心の expansions
 * @param {{title:string}[]|undefined} b 今の中心の expansions
 * @param {Iterable<string>} [exclude]
 * @returns {string[]}
 */
export function sharedTitles(a, b, exclude = []) {
  if (!a || !b) return []
  const inA = new Set(a.map((l) => l.title))
  const skip = new Set(exclude)
  const out = []
  const seen = new Set()
  for (const { title } of b) {
    if (!inA.has(title) || skip.has(title) || seen.has(title)) continue
    seen.add(title)
    out.push(title)
  }
  return out
}

/**
 * データパケットを流す経路(記事名の列)の一覧。1つの経路に1つのパケットを流す。
 *
 *   共通ワードがあるとき(sharedPackets on)… [1つ前の中心, 共通ワード, 今の中心]
 *     前後の記事がどの関連ワードでつながっているかを見せる
 *   それ以外 … [今の中心, 子](従来どおり。関連の強い順に先頭から)
 *
 * trailEnabled=false のときは1つ前の中心が画面に出ていないので、共通ワードは使わない
 *
 * @param {string[]} trail 訪問した記事の列
 * @param {Map<string, {title:string}[]>} expansions
 * @param {{trailEnabled:boolean, sharedPackets:boolean}} config
 * @param {number} count 経路の最大数(パケットの数)
 * @returns {string[][]}
 */
export function packetRoutesFor(trail, expansions, config, count) {
  const current = trail[trail.length - 1]
  if (!current) return []
  const children = expansions.get(current) || []

  if (config.sharedPackets && config.trailEnabled && trail.length >= 2) {
    const prev = trail[trail.length - 2]
    const shared = sharedTitles(expansions.get(prev), children, [prev, current])
    if (shared.length > 0) {
      return shared.slice(0, count).map((title) => [prev, title, current])
    }
  }

  return children.slice(0, count).map((l) => [current, l.title])
}

/**
 * 相互リンクの線の明るさに掛ける値。1 と (1 - amplitude) の間を正弦波で往復する。
 *
 *   factor = 1 - amplitude × (1 + sin(t × speed)) / 2
 *
 * 0 まで落とさないのは、脈動の谷で線が消えて「つながりが途切れた」ように見えないようにするため
 *
 * @param {number} t 秒
 */
export function mutualPulseFactor(t, amplitude, speed) {
  return 1 - clamp01(amplitude) * (1 + Math.sin(t * speed)) / 2
}
