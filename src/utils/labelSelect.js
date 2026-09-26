/**
 * ラベルの間引き(SPEC 6.3)の「どれを出すか」を決める計算。Graph3D.jsx から切り出した。
 *
 * 表示(Graph3D の updateLabelVisibility)と画面上の見え方の測定(src/debug/measure.js。SPEC 12.5)が
 * 同じ関数を呼ぶ。スプライトへの反映(visible・center の設定)は呼ぶ側が行い、ここでは判断だけを返す。
 *
 * 前回の選択の優遇(LABEL_KEEP_BIAS)は引数で渡す。表示は毎回渡し、
 * 測定の「まっさらな状態で選び直したら」は wasSelected を false・keepBias を 1 にして呼ぶ。
 */
import {
  LABEL_CANDIDATES,
  LABEL_GAP_PX,
  LABEL_FADE_SHOW,
  LABEL_FADE_KEEP,
  LABEL_OVERLAP_FAINT,
  LABEL_FAINT_MAX,
  LABEL_MAX_CHARS,
  LABEL_PX,
  LABEL_CURRENT_PX,
} from '../constants.js'
import { keepsLabelCandidate } from './depthFade.js'
import { projectToScreen, isOnScreen } from './screenProjection.js'

// ラベルのテクスチャを描く倍率(12px の文字をそのまま描くとぼやけるので大きく描いて縮める)
export const LABEL_TEXTURE_SCALE = 3

/** 長い記事名は LABEL_MAX_CHARS で切って「…」を付ける */
export function labelDisplayText(text) {
  return text.length > LABEL_MAX_CHARS ? text.slice(0, LABEL_MAX_CHARS) + '…' : text
}

/** テクスチャに描くときのフォント(起点だけ太字・大きめ) */
export function labelFont(bold) {
  const fontPx = (bold ? LABEL_CURRENT_PX : LABEL_PX) * LABEL_TEXTURE_SCALE
  return `${bold ? 700 : 500} ${fontPx}px "JetBrains Mono", ui-monospace, "Hiragino Sans", "Yu Gothic", monospace`
}

/**
 * テクスチャの大きさ(描画用の px)。幅は Canvas の measureText で測る。
 * c2d は 2D コンテキスト(font はここで設定する)。
 * Web フォントが読めていないと代替書体の幅になるので、比べる測定ではフォントの読込を待つこと
 */
export function labelTextureSize(display, bold, c2d) {
  const fontPx = (bold ? LABEL_CURRENT_PX : LABEL_PX) * LABEL_TEXTURE_SCALE
  c2d.font = labelFont(bold)
  const padding = 4 * LABEL_TEXTURE_SCALE
  const width = Math.ceil(c2d.measureText(display).width) + padding * 2
  const height = Math.ceil(fontPx * 1.4)
  return { width, height }
}

/** テクスチャは文字の 1.4 倍の高さで作っているので、文字が px になる高さに換算する */
export function labelHeightPx(bold) {
  return (bold ? LABEL_CURRENT_PX : LABEL_PX) * 1.4
}

/**
 * どのラベルを出すかを決める。
 *
 * items(表示の ctx.nodes と同じ順に並べること。同じ優先度・同じ距離のときの順番が変わるため):
 *   id, isCurrent, tier(0/1/2), boosted(追加表示の優先ラベル中か),
 *   fadeTarget(深さフェードの目標値), wasSelected(前回選ばれていたか),
 *   pos({x,y,z}。ラベルを付ける位置), radiusPx(球の半径 px。ホバーの拡大込み),
 *   labelPx(ラベルの高さ px), labelAspect(幅 / 高さ)
 * opts:
 *   camera(行列が最新のもの), width, height(描画領域の px),
 *   hoveredId(無ければ null), neighbors(ホバー中ノードの隣接 Set),
 *   fadeOn(labelDepthFade), visibleLabels, keepBias(前回表示の優遇。表示は LABEL_KEEP_BIAS)
 *
 * @returns {{reason:string, selected:boolean, faint:boolean, center:{x:number,y:number}|null}[]}
 *   items と同じ並び。reason は window.__viz.labels() と同じ
 *   (shown / faint / overlap / offscreen / rank / depth / hover)。
 *   center はラベルの Sprite.center に入れる値(投影まで進んだものだけ。重なりで捨てたものにも入る)
 */
export function selectLabels(items, opts) {
  const { camera, width, height, hoveredId, neighbors, fadeOn, visibleLabels, keepBias } = opts
  const results = items.map(() => ({ reason: 'rank', selected: false, faint: false, center: null }))

  // --- 1. 候補を集めて優先度をつける ---
  const candidates = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const res = results[i]

    // 深さで見えなくなっているラベルは候補から外す(VISIBLE_LABELS の枠と場所を使わせない)。
    // 追加表示の優先ラベル(boosted)も例外にしない。
    // 出すときと引っ込めるときで基準を変え、閾値付近でチラつかないようにする
    // (目標値は毎フレーム更新なので、ホバーが変わった直後のこの呼び出しでは古い。
    // そのため現在地・ホバー中はここでも明示的に除外しない)
    if (fadeOn && !item.isCurrent && item.id !== hoveredId) {
      if (!keepsLabelCandidate(item.fadeTarget, item.wasSelected, LABEL_FADE_SHOW, LABEL_FADE_KEEP)) {
        res.reason = 'depth'
        continue
      }
    }

    let priority
    if (hoveredId) {
      // ホバー中は隣接以外のラベルは出さない(6.1と揃える)
      if (item.id === hoveredId) priority = 0
      else if (neighbors && neighbors.has(item.id)) priority = 1
      else {
        res.reason = 'hover'
        continue
      }
    } else {
      priority = item.tier
      // 現在地(0)の次、ほかの一次ノード(1)より前
      if (item.tier === 1 && item.boosted) priority = 0.5
    }

    const dx = item.pos.x - camera.position.x
    const dy = item.pos.y - camera.position.y
    const dz = item.pos.z - camera.position.z
    let camDistSq = dx * dx + dy * dy + dz * dz
    // 前回表示していたラベルは少し近いものとして扱う(回転中の入れ替わりを減らす)。
    // 重なり判定も先に処理されるので、同じ場所を争ったときに表示中のものが勝つ
    if (item.wasSelected) camDistSq *= keepBias * keepBias
    candidates.push({ index: i, priority, camDistSq })
  }

  if (candidates.length === 0) return results

  // 優先度が高い順、同じ優先度ならカメラに近い順
  candidates.sort((a, b) => a.priority - b.priority || a.camDistSq - b.camDistSq)
  const considered = candidates.slice(0, LABEL_CANDIDATES)

  // --- 2. 画面に投影して、重なるものを捨てる ---
  if (!width || !height) return results

  const rects = []
  let shown = 0
  let faintShown = 0
  const s = {}

  for (const { index } of considered) {
    const item = items[index]
    const res = results[index]
    // 深さフェードで十分に薄い奥のラベル(SPEC 6.3)。重なり判定をせず、場所も取らず、
    // VISIBLE_LABELS とは別枠(LABEL_FAINT_MAX)で出す。現在地・ホバー中は対象外
    const faint =
      fadeOn &&
      !item.isCurrent &&
      item.id !== hoveredId &&
      item.fadeTarget <= LABEL_OVERLAP_FAINT
    if (faint ? faintShown >= LABEL_FAINT_MAX : shown >= visibleLabels) {
      if (!faint && faintShown >= LABEL_FAINT_MAX) break
      continue
    }

    // カメラの後ろ / 画面外は捨てる
    res.reason = 'offscreen'
    projectToScreen(item.pos, camera, width, height, s)
    if (!isOnScreen(s, width, height)) continue
    const sx = s.x
    const sy = s.y

    const labelH = item.labelPx
    const labelW = labelH * (item.labelAspect || 4)
    const r = item.radiusPx + LABEL_GAP_PX

    let rect
    if (item.isCurrent) {
      // 起点: 真下・中央揃え
      res.center = { x: 0.5, y: 1 + r / labelH }
      rect = { x1: sx - labelW / 2, x2: sx + labelW / 2, y1: sy + r, y2: sy + r + labelH }
    } else if (sx + r + labelW <= width) {
      // 右に置く
      res.center = { x: -r / labelW, y: 0.5 }
      rect = { x1: sx + r, x2: sx + r + labelW, y1: sy - labelH / 2, y2: sy + labelH / 2 }
    } else {
      // 右にはみ出すので左に置く
      res.center = { x: 1 + r / labelW, y: 0.5 }
      rect = { x1: sx - r - labelW, x2: sx - r, y1: sy - labelH / 2, y2: sy + labelH / 2 }
    }

    if (faint) {
      res.reason = 'faint'
      res.faint = true
      res.selected = true
      faintShown += 1
      continue
    }

    const overlaps = rects.some(
      (o) => !(rect.x2 < o.x1 || rect.x1 > o.x2 || rect.y2 < o.y1 || rect.y1 > o.y2)
    )
    if (overlaps) {
      res.reason = 'overlap'
      continue
    }

    res.reason = 'shown'
    res.selected = true
    rects.push(rect)
    shown += 1
  }
  return results
}
