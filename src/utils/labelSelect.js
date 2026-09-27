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
 *   focus(注目状態。無ければ null。下の focusForHover / focusForArrival で作る),
 *   hoveredId・neighbors(focus を渡さないときのホバーの書き方。focusForHover と同じ意味),
 *   fadeOn(labelDepthFade), visibleLabels, keepBias(前回表示の優遇。表示は LABEL_KEEP_BIAS)
 *
 * 注目状態(ホバー・到着時の共通ワード強調。SPEC 6.10)のあいだは、注目の集合に入るラベルだけを出す。
 *   ids      … ラベルを出してよいノード。ほかは reason = focus.reason で出さない
 *   priority … 場所を取る順(小さいほど先)。同じ値ならカメラに近い順
 *   exempt   … 深さフェードを受けない(どの角度でも読める)ノード。faint にもならない
 *
 * @returns {{reason:string, selected:boolean, faint:boolean, center:{x:number,y:number}|null}[]}
 *   items と同じ並び。reason は window.__viz.labels() と同じ
 *   (shown / faint / overlap / offscreen / rank / depth / hover / arrival)。
 *   center はラベルの Sprite.center に入れる値(投影まで進んだものだけ。重なりで捨てたものにも入る)
 */
export function selectLabels(items, opts) {
  const { camera, width, height, fadeOn, visibleLabels, keepBias } = opts
  const focus = opts.focus || (opts.hoveredId ? focusForHover(opts.hoveredId, opts.neighbors) : null)
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
    if (fadeOn && !item.isCurrent && !(focus && focus.exempt.has(item.id))) {
      if (!keepsLabelCandidate(item.fadeTarget, item.wasSelected, LABEL_FADE_SHOW, LABEL_FADE_KEEP)) {
        res.reason = 'depth'
        continue
      }
    }

    let priority
    if (focus) {
      // 注目状態のあいだは、注目の集合の外のラベルは出さない(ホバーは 6.1、到着時の強調は 6.10)
      if (!focus.ids.has(item.id)) {
        res.reason = focus.reason
        continue
      }
      priority = focus.priority(item.id)
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
      !(focus && focus.exempt.has(item.id)) &&
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

    const hits = (q) =>
      rects.some((o) => !(q.x2 < o.x1 || q.x1 > o.x2 || q.y2 < o.y1 || q.y1 > o.y2))
    let overlaps = hits(rect)
    // 到着時の強調で名前を保証するラベル(SPEC 6.10)は、ぶつかったら 右 → 左 → 上 → 下 の順に空いている場所を探す。
    // 共通ワードは前後の中心のあいだに来るので、右か左の決まった位置だと中心のラベルと重なりやすいため。
    // ふだんのラベル(ホバー・通常)は置き場所を変えない(回転のたびに左右上下へ跳ねると読みにくい)
    if (overlaps && focus && focus.altPlacement && focus.ids.has(item.id) && !item.isCurrent) {
      const placements = [
        { center: { x: -r / labelW, y: 0.5 }, rect: { x1: sx + r, x2: sx + r + labelW, y1: sy - labelH / 2, y2: sy + labelH / 2 } },
        { center: { x: 1 + r / labelW, y: 0.5 }, rect: { x1: sx - r - labelW, x2: sx - r, y1: sy - labelH / 2, y2: sy + labelH / 2 } },
        { center: { x: 0.5, y: -r / labelH }, rect: { x1: sx - labelW / 2, x2: sx + labelW / 2, y1: sy - r - labelH, y2: sy - r } },
        { center: { x: 0.5, y: 1 + r / labelH }, rect: { x1: sx - labelW / 2, x2: sx + labelW / 2, y1: sy + r, y2: sy + r + labelH } },
      ]
      for (const p of placements) {
        const q = p.rect
        if (q.x1 < 0 || q.x2 > width || q.y1 < 0 || q.y2 > height || hits(q)) continue
        rect = q
        res.center = p.center
        overlaps = false
        break
      }
    }
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

/**
 * ホバーの注目状態(SPEC 6.1)。ホバー中のノードと隣接だけにラベルを出し、ホバー中のノードが先に場所を取る。
 * 深さフェードを受けないのはホバー中のノードだけ(隣接は受ける)
 */
export function focusForHover(hoveredId, neighbors) {
  const ids = new Set(neighbors || [])
  ids.add(hoveredId)
  return {
    reason: 'hover',
    ids,
    priority: (id) => (id === hoveredId ? 0 : 1),
    exempt: new Set([hoveredId]),
  }
}

/**
 * 到着時の共通ワード強調の注目状態(SPEC 6.10)。前後の中心と、名前を保証する共通ワード(labelOrder)だけに
 * ラベルを出し、labelOrder の順(今の中心 → 共通ワードの関連スコア順 → 前の中心)に場所を取る。
 * これらは深さフェードを受けず、ぶつかったら別の位置を探す(altPlacement)。
 * 保証しない共通ワードは点と線だけ明るく、名前は出さない(件数はステータス行)
 * @param {{labelOrder:string[]}} set arrivalHighlightSet の戻り値
 */
export function focusForArrival(set) {
  const ids = new Set(set.labelOrder)
  const rank = new Map(set.labelOrder.map((id, i) => [id, i]))
  return {
    reason: 'arrival',
    ids,
    priority: (id) => rank.get(id) ?? set.labelOrder.length,
    exempt: ids,
    altPlacement: true,
  }
}
