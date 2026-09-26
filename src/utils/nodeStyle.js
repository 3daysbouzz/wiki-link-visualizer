/**
 * ノードの階層(起点/一次/二次)と、画面上の大きさ(px)の決め方(SPEC 4章・6.4)。
 * Graph3D.jsx から切り出した。表示と画面上の見え方の測定(SPEC 12.5)が同じ関数を呼ぶ
 * (球の大きさはラベルの置き場所と当たり判定に効くため)。
 */
import {
  VIEWS_SCALE_MIN,
  VIEWS_SCALE_MAX,
  NODE_PX_CURRENT,
  NODE_PX_PRIMARY_MIN,
  NODE_PX_PRIMARY_MAX,
  NODE_PX_VISITED,
  NODE_PX_SECONDARY,
} from '../constants.js'

/**
 * 閲覧数を一次ノードの半径(px)に変換する。
 * 閲覧数は記事間で1万倍以上違うので、必ず対数で割り当てること。
 */
export function primaryPxFromViews(views) {
  const v = Math.max(views || 0, 1)
  const lo = Math.log10(VIEWS_SCALE_MIN)
  const hi = Math.log10(VIEWS_SCALE_MAX)
  const t = Math.min(Math.max((Math.log10(v) - lo) / (hi - lo), 0), 1)
  return NODE_PX_PRIMARY_MIN + t * (NODE_PX_PRIMARY_MAX - NODE_PX_PRIMARY_MIN)
}

/**
 * 階層と球の半径(px)を決める。
 *   tier 0 = 現在地、1 = 現在地に隣接(一次)、2 = それ以外(二次)
 *   visited = 訪問済み(軌跡上の、現在地以外)。一次なら閲覧数に関係なく NODE_PX_VISITED
 */
export function nodeTierStyle({ isCurrent, isPrimary, expanded, views }) {
  const tier = isCurrent ? 0 : isPrimary ? 1 : 2
  const visited = expanded && !isCurrent
  let basePx
  if (isCurrent) basePx = NODE_PX_CURRENT
  else if (isPrimary) basePx = visited ? NODE_PX_VISITED : primaryPxFromViews(views)
  else basePx = NODE_PX_SECONDARY
  return { tier, visited, basePx }
}
