/**
 * 関連の強さを配置と動きに反映するための計算(SPEC 6.9)。Graph3D・App から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる。
 *
 *   - 関連スコアを 0〜1 にならす(normalizeScore)
 *   - 線ごとのバネの自然長(computeEdgeSpringLength)
 *   - 前後の中心に共通する関連ワード(sharedTitles)
 *   - データパケットを流す経路(packetRoutesFor)
 *   - 中心同士の距離の段階(trailTier・trailTierLength。rev4)
 *   - 到着時の共通ワード強調の対象(arrivalHighlightSet)と、始めるかの判定(startsArrival)。SPEC 6.10
 */
import { TRAIL_TIER_FEW_MAX, TRAIL_TIER_MID_MAX } from '../constants.js'

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
 *           childSpringMin より短くはしない。
 *           trailTiered が on(rev4)なら、代わりに共通ワードの件数の段階で決める(trailTierLength)。
 *           段階の長さには childSpringMin の下限を掛けない
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
    if (config.trailTiered) return trailTierLength(trailTier(edge.sharedCount || 0), config)
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
 * 線のバネの硬さ。ふつうは null(config.springK を使う)。
 * 中心同士の距離を段階で決めるとき(distanceByScore と trailTiered が on。rev4)だけ、
 * 中心同士の線を trailSpringK にする。線1本では、両側の子すべてに掛かる原点への引き戻しに負けて、
 * 狙いの長さを変えても実際の距離がほとんど動かないため(タスク07 の実測)
 */
export function computeEdgeSpringK(edge, config) {
  if (config.distanceByScore && config.trailTiered && edge.type === 'trail') return config.trailSpringK
  return null
}

/**
 * 中心同士の共通ワードの件数を、距離の段階に分ける(タスク07。2026-09-26 利用者と決定)。
 *   0 … none / 1〜TRAIL_TIER_FEW_MAX … few / 〜TRAIL_TIER_MID_MAX … mid / それより多い … many
 * 細かく比例させず大きな段階で分けるのは、説明しなくても「共通ワードで距離が変わっている」と
 * 気づいてもらうため(段階の違いがはっきり見えることを優先する)
 * @returns {'none'|'few'|'mid'|'many'}
 */
export function trailTier(sharedCount) {
  const n = sharedCount || 0
  if (n <= 0) return 'none'
  if (n <= TRAIL_TIER_FEW_MAX) return 'few'
  if (n <= TRAIL_TIER_MID_MAX) return 'mid'
  return 'many'
}

/** 段階ごとの中心同士の線の自然長(config の trailLenNone〜trailLenMany) */
export function trailTierLength(tier, config) {
  switch (tier) {
    case 'none':
      return config.trailLenNone
    case 'few':
      return config.trailLenFew
    case 'mid':
      return config.trailLenMid
    default:
      return config.trailLenMany
  }
}

/**
 * 到着時の共通ワード強調で明るく残すもの(SPEC 6.10。タスク07)。
 *
 *   ノード … 前の中心・今の中心・共通ワードの上位 max 件(今の中心の展開結果の順 = 関連スコアの順)
 *   線     … 前の中心 ↔ 共通ワード、共通ワード ↔ 今の中心、前の中心 ↔ 今の中心
 *   labelOrder … ラベルが場所を取る順。今の中心 → 前の中心 → 共通ワード(関連スコアの順)
 *
 * 軌跡が2件未満・trailEnabled=false(前の中心が画面に出ない)・共通ワードが 0 件なら null(何もしない)
 *
 * @param {string[]} trail
 * @param {Map<string, {title:string}[]>} expansions
 * @param {number} max ラベルを保証する共通ワードの上限(arrivalSharedMax)
 * @param {{trailEnabled?:boolean}} [config]
 * @returns {{prev:string, current:string, shared:string[], nodes:Set<string>, links:[string,string][], labelOrder:string[]} | null}
 */
export function arrivalHighlightSet(trail, expansions, max, config = {}) {
  if (config.trailEnabled === false || trail.length < 2) return null
  const prev = trail[trail.length - 2]
  const current = trail[trail.length - 1]
  const shared = sharedTitles(expansions.get(prev), expansions.get(current), [prev, current]).slice(
    0,
    Math.max(0, max)
  )
  if (shared.length === 0) return null
  const links = [[prev, current]]
  for (const title of shared) {
    links.push([prev, title])
    links.push([title, current])
  }
  return {
    prev,
    current,
    shared,
    nodes: new Set([prev, current, ...shared]),
    links,
    labelOrder: [current, prev, ...shared],
  }
}

/**
 * 到着時の強調を始めるか。軌跡の末尾に新しい記事を1件足して進んだときだけ true
 * (ノードのクリック・サイドバーの隣接記事のクリック)。
 * 戻る(軌跡を短く切る)・検索やリセット(作り直す)・追加表示(軌跡が変わらない)・
 * リダイレクトで経路上の記事が末尾に並び替わった場合は false
 */
export function startsArrival(prevTrail, nextTrail) {
  if (nextTrail.length !== prevTrail.length + 1 || prevTrail.length === 0) return false
  for (let i = 0; i < prevTrail.length; i++) {
    if (prevTrail[i] !== nextTrail[i]) return false
  }
  return !prevTrail.includes(nextTrail[nextTrail.length - 1])
}
