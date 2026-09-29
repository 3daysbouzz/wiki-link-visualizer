/**
 * 輪を閉じたときの演出(タスク10・11。SPEC 6.11)の時間割と光の明るさ。Graph3D から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる(点滅の回数・波紋の数などの安全の決まりをテストで検査する)
 *
 *   - 演出の時間割(eggTimeline): 段階・締めの瞬間・波紋などの出来事の予定。3〜5件は光らせるだけ、6件以上はカメラワーク
 *   - ある瞬間の見た目の量(eggFrame): 色の付き具合・輪の外の薄さ・並べ替えの進み具合・光の頭の位置・締めの光など
 *   - 線ごとの光の明るさ(loopEdgeGlow)
 *   - 輪を並べ替える正多角形(polygonVertices)・それを見下ろすカメラの距離(polygonFitDistance)・力学の状態の記録と復元(10c)
 */
import {
  EGG_CINEMATIC_MIN,
  EGG_SURPRISE_MS,
  EGG_LAP_MS,
  EGG_FINALE_MS,
  EGG_AFTERGLOW_MS,
  EGG_REDUCED_HOLD_MS,
  EGG_LAP_LIT,
  EGG_FLASH_MS,
  EGG_RIPPLE_MS,
  EGG_RIPPLE_MAX_PER_S,
  EGG_RIPPLE_MAX_LIVE,
  EGG_CINE_SURPRISE_MS,
  EGG_CINE_ARRANGE_MS,
  EGG_CINE_CHARGE_MS,
  EGG_CINE_ORBIT_MS,
  EGG_CINE_FINALE_MS,
  EGG_CINE_AFTERGLOW_MS,
  EGG_CINE_HOLD_MS,
  EGG_CINE_LAPS,
  EGG_CINE_BASE,
  EGG_CINE_TAIL,
  EGG_TYPE_CHAR_MS,
} from '../constants.js'

const clamp01 = (x) => Math.min(Math.max(x, 0), 1)
const smoothstep = (x) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
/** 勢いよく出てゆっくり止まる(始まりの動き。波紋・色) */
export const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)
/** ゆっくり動き出してゆっくり止まる(カメラと並べ替え) */
export const easeInOut = (x) => {
  const t = clamp01(x)
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
/** 区間 [a, b] の中での進み具合(0〜1) */
const progress = (t, a, b) => (b > a ? clamp01((t - a) / (b - a)) : t >= b ? 1 : 0)

/**
 * 小さな波紋の候補(時刻の順)から、上限(1秒あたり EGG_RIPPLE_MAX_PER_S・同時に EGG_RIPPLE_MAX_LIVE)を超えないものだけを残す。
 * 超えた分は出さない(記事が灯るのはそのまま)
 */
function limitRipples(candidates) {
  const out = []
  for (const r of [...candidates].sort((a, b) => a.t - b.t)) {
    const inSecond = out.filter((x) => x.t > r.t - 1000).length
    const live = out.filter((x) => x.t > r.t - EGG_RIPPLE_MS).length
    if (inSecond < EGG_RIPPLE_MAX_PER_S && live < EGG_RIPPLE_MAX_LIVE) out.push(r)
  }
  return out
}

/**
 * 演出の時間割(ms。始まりが 0)。
 *   phases   … 段階の列(名前・始まり・終わり)。隙間なく並び、最後の終わりが total
 *   finale   … 締めの瞬間(光が一周して戻り先に戻った瞬間)
 *   light    … 光が走る区間と周回数({start, end, laps})。動きを減らす設定では null(全部の線を色と一緒に明るくする)
 *   arrange  … 並べ替え(6件以上)。in = 多角形へ、out = 元の位置へ。カメラも同じ区間で動く
 *   orbit    … カメラが一周する区間(6件以上)
 *   dimIn / colorOut … 輪の外を薄くする区間 / 色・明るさ・薄さを戻す区間(余韻)
 *   nodeLit  … 輪の記事(経路の順)が灯る時刻(6件以上は溜めで順に。3〜5件は始まりで全部)
 *   ripples  … 小さな波紋 [{t, node}](上限を超える分は除いた後)
 *   bigRipple・flash・scan … 締めの大きな波紋・輪が揃って光る・走査線の時刻(それぞれ一度だけ。無ければ null)
 *   typing   … 左上の文字の打ち込み {start, charMs}(6件以上。動きを減らす設定では null)
 *   banner   … 左上の文字を出し始める時刻(6件以上。動きを減らす設定では 0 に一度に出す)。3〜5件は null
 *   gridWave … 背景の円が内側から光る時刻(3〜5件の締め)。無ければ null
 */
export function eggTimeline(length, reducedMotion) {
  const L = Math.max(length, 2)
  const cinematic = length >= EGG_CINEMATIC_MIN && !reducedMotion
  const nodeLitAll = (t) => Array.from({ length: L }, () => t)
  const base = { length, cinematic, reduced: !!reducedMotion }

  if (reducedMotion) {
    const hold = EGG_SURPRISE_MS
    const out = hold + EGG_REDUCED_HOLD_MS
    const total = out + EGG_AFTERGLOW_MS
    return {
      ...base,
      total,
      phases: [
        { name: 'surprise', start: 0, end: hold },
        { name: 'hold', start: hold, end: out },
        { name: 'afterglow', start: out, end: total },
      ],
      finale: out,
      light: null,
      arrange: null,
      orbit: null,
      dimIn: [0, hold],
      colorOut: [out, total],
      nodeLit: nodeLitAll(0),
      ripples: [],
      bigRipple: null,
      flash: null,
      scan: null,
      typing: null,
      banner: length >= EGG_CINEMATIC_MIN ? 0 : null,
      gridWave: null,
    }
  }

  if (!cinematic) {
    const lapStart = EGG_SURPRISE_MS
    const finale = lapStart + EGG_LAP_MS
    const glow = finale + EGG_FINALE_MS
    const total = glow + EGG_AFTERGLOW_MS
    // 光が記事 k(1〜L-1)に届いた瞬間に小さな波紋。戻り先(0)に戻った瞬間は締めの大きな波紋
    const candidates = []
    for (let k = 1; k < L; k++) candidates.push({ t: lapStart + (k * EGG_LAP_MS) / L, node: k })
    return {
      ...base,
      total,
      phases: [
        { name: 'surprise', start: 0, end: lapStart },
        { name: 'rhythm', start: lapStart, end: finale },
        { name: 'finale', start: finale, end: glow },
        { name: 'afterglow', start: glow, end: total },
      ],
      finale,
      light: { start: lapStart, end: finale, laps: 1 },
      arrange: null,
      orbit: null,
      dimIn: [0, lapStart],
      colorOut: [glow, total],
      nodeLit: nodeLitAll(0),
      ripples: limitRipples(candidates),
      bigRipple: { t: finale, node: 0 },
      flash: finale,
      scan: null,
      typing: null,
      banner: null,
      gridWave: finale,
    }
  }

  const arrangeStart = EGG_CINE_SURPRISE_MS
  const chargeStart = arrangeStart + EGG_CINE_ARRANGE_MS
  const orbitStart = chargeStart + EGG_CINE_CHARGE_MS
  const finale = orbitStart + EGG_CINE_ORBIT_MS
  const glow = finale + EGG_CINE_FINALE_MS
  const total = glow + EGG_CINE_AFTERGLOW_MS
  const returnStart = glow + EGG_CINE_HOLD_MS
  // 溜め: 戻り先から順に灯る。灯った瞬間に小さな波紋
  const nodeLit = Array.from({ length: L }, (_, k) => chargeStart + (k * EGG_CINE_CHARGE_MS) / L)
  const candidates = nodeLit.map((t, k) => ({ t, node: k }))
  // 1周目だけ、光が記事に届くたびに小さな波紋(戻り先に戻った瞬間 = 1周目の終わりも含む)
  const lapMs = EGG_CINE_ORBIT_MS / EGG_CINE_LAPS
  for (let k = 1; k <= L; k++) candidates.push({ t: orbitStart + (k * lapMs) / L, node: k % L })
  return {
    ...base,
    total,
    phases: [
      { name: 'surprise', start: 0, end: arrangeStart },
      { name: 'arrange', start: arrangeStart, end: chargeStart },
      { name: 'charge', start: chargeStart, end: orbitStart },
      { name: 'orbit', start: orbitStart, end: finale },
      { name: 'finale', start: finale, end: glow },
      { name: 'afterglow', start: glow, end: total },
    ],
    finale,
    light: { start: orbitStart, end: finale, laps: EGG_CINE_LAPS },
    arrange: { in: [arrangeStart, chargeStart], out: [returnStart, total] },
    orbit: [orbitStart, finale],
    dimIn: [0, chargeStart],
    colorOut: [returnStart, total],
    nodeLit,
    ripples: limitRipples(candidates),
    bigRipple: { t: finale, node: null },
    flash: finale,
    scan: finale,
    typing: { start: finale, charMs: EGG_TYPE_CHAR_MS },
    banner: finale,
    gridWave: null,
  }
}

/**
 * 時刻 t(ms)の見た目の量。Graph3D はこれを描くだけにする(時間の決まりをここに集め、テストで確かめる)。
 *   mix   … 色の付き具合(0 = 白、1 = 輪の色)。始まりで一瞬で 1(驚き)、余韻で 0 へ
 *   dim   … 輪の外の薄さ(0 = 通常、1 = いちばん薄い)。始まりから勢いよく薄くなり、余韻で戻る
 *   place … 並べ替えの進み具合(0 = 元の位置、1 = 多角形)。6件以上だけ
 *   orbit … カメラの一周の進み具合(0〜1。ゆっくり動き出してゆっくり止まる)。6件以上だけ
 *   head  … 光の頭の位置(線の本数単位。0 〜 edges × laps)
 *   laps  … 光の周回数(loopEdgeGlow に渡す)
 *   flash … 締めで揃って光る明るさ(0〜1。締めの瞬間に 1 で、EGG_FLASH_MS で 0 へ)
 *   lit   … 輪の記事ごとの灯り具合(0 = 灯る前 … 1 = 灯った)
 */
export function eggFrame(tl, t) {
  const edges = Math.max(tl.length, 2)
  const mix = 1 - smoothstep(progress(t, tl.colorOut[0], tl.colorOut[1]))
  const dimRise = easeOut(progress(t, tl.dimIn[0], tl.dimIn[1]))
  const dim = Math.min(dimRise, mix)
  let place = 0
  if (tl.arrange) {
    place =
      t < tl.arrange.out[0]
        ? easeInOut(progress(t, tl.arrange.in[0], tl.arrange.in[1]))
        : 1 - easeInOut(progress(t, tl.arrange.out[0], tl.arrange.out[1]))
  }
  const orbit = tl.orbit ? easeInOut(progress(t, tl.orbit[0], tl.orbit[1])) : 0
  const laps = tl.light ? tl.light.laps : 1
  const head = tl.light ? progress(t, tl.light.start, tl.light.end) * edges * laps : edges
  const flash = tl.flash === null || t < tl.flash ? 0 : 1 - smoothstep((t - tl.flash) / EGG_FLASH_MS)
  const lit = tl.nodeLit.map((at) => (t >= at ? 1 : 0))
  return { mix, dim, place, orbit, head, laps, flash, lit }
}

/**
 * 線 j の明るさ(0〜1。頂点の色の明るさに掛ける前)。光(loopEdgeGlow)と締めの光(flash)の大きい方に、色の付き具合を掛ける。
 * 3〜5件は光が通った線を EGG_LAP_LIT に保ち、締めで揃って 1 まで光る
 */
export function eggEdgeBrightness(frame, j, edges) {
  const glow = loopEdgeGlow(frame.head, j, edges, frame.laps) * (frame.laps > 1 ? 1 : EGG_LAP_LIT)
  return Math.max(glow, frame.flash) * frame.mix
}

/**
 * 線 j の光の明るさ(0〜1)。head は光の頭の位置(線の本数単位。0 から edges × laps まで進む)。
 *
 *   1周だけ(laps = 1。3〜5件)… 光が来た線は 1本分かけて明るくなり、そのまま明るく残る(どの線も1回しか明るくならない)
 *   何周も(10b)… 1周目は同じく順に明るくし、通ったあとは尾を引いて EGG_CINE_BASE へ戻る。
 *                  2周目からは光の頭が来るたびに山が来る(1周に1回)。0 まで落とさず、明暗の差を小さくする
 * まだ光が来ていない線は 0(= 今の線の明るさのまま、色だけが付く)
 */
export function loopEdgeGlow(head, j, edges, laps) {
  if (head < j) return 0
  if (laps <= 1) return smoothstep(head - j)
  // 頭からどれだけ後ろにあるか(0 〜 edges)。1周目に光が来るまでは上で 0 を返している
  const d = (head - j) % edges
  const rise = smoothstep(d) // 頭が通り過ぎる 1本分で山に上がる
  const tail = d < 1 ? 1 : Math.exp(-(d - 1) / EGG_CINE_TAIL)
  // 1周目の、まだ一度も山が来ていない区間(d が 1 未満)は 0 から上がる。2周目からは底 EGG_CINE_BASE から上がる
  const floor = head - j < 1 ? 0 : EGG_CINE_BASE
  return d < 1 ? floor + (1 - floor) * rise : EGG_CINE_BASE + (1 - EGG_CINE_BASE) * tail
}

// ==========================================================================
// カメラワークの前に輪を並べ替える(10c)
// ==========================================================================

/**
 * 縦軸(y)の周りの回転。three の makeRotationY / applyAxisAngle((0,1,0), angle) と同じ向き。
 * 多角形の頂点の並び(光が走る向き)と、カメラが回る向きの両方にこれを使い、向きを揃える
 * @returns {{x:number, y:number, z:number}}
 */
export function rotateY(v, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z }
}

/**
 * 正多角形の頂点(経路の順)。center を中心とする水平な面(y = center.y)の上に置く。
 * 頂点 j+1 は頂点 j を +2π/n だけ rotateY した位置(カメラも同じ +の向きに回る)。
 * 最後の頂点(今の中心)が front の向き(カメラのいる側)に来るように回しておく(今いる記事を手前に見せる)
 * @param {number} n 頂点の数(輪の長さ)
 * @param {{x:number,y:number,z:number}} center
 * @param {{x:number,z:number}} front 水平な面の上での、中心からカメラへの向き(長さは問わない)
 * @param {number} radius
 */
export function polygonVertices(n, center, front, radius) {
  const len = Math.hypot(front.x, front.z) || 1
  const f = { x: (front.x / len) * radius, y: 0, z: (front.z / len) * radius }
  const out = []
  for (let j = 0; j < n; j++) {
    const v = rotateY(f, (2 * Math.PI * (j - (n - 1))) / n)
    out.push({ x: center.x + v.x, y: center.y, z: center.z + v.z })
  }
  return out
}

/**
 * 力学の状態(全ノードの位置と速度・alpha)を記録する。数値はそのまま持つ(丸めない)。
 * 戻すと、並べ替えをしなかった場合と同じ状態から力学を続けられる
 * @param {Map<string, {x,y,z,vx,vy,vz}>} nodes
 */
export function snapshotLayout(nodes, alpha) {
  const pos = new Map()
  for (const [id, n] of nodes) pos.set(id, [n.x, n.y, n.z, n.vx, n.vy, n.vz])
  return { pos, alpha }
}

/**
 * 記録した状態へ戻す(補間しない)。記録の後に増えたノードはそのまま(演出中は顔ぶれが変わらないので、ふつうは無い)。
 * @returns {number} 記録した alpha
 */
export function restoreLayout(nodes, snap) {
  for (const [id, n] of nodes) {
    const p = snap.pos.get(id)
    if (!p) continue
    n.x = p[0]
    n.y = p[1]
    n.z = p[2]
    n.vx = p[3]
    n.vy = p[4]
    n.vz = p[5]
  }
  return snap.alpha
}

/**
 * 多角形を見下ろすカメラの距離。重心を注視し、見下ろす角度 elevDeg で縦軸の周りに一周しても、
 * 半径 radius の多角形の頂点と、頂点の横に出るラベル(幅 labelW・高さ labelH px)が、
 * 画面 width×height の端から pad 内側に収まる最小の距離(遠近を含めて投影して確かめる)。
 * ただし重心の深さで見た半径が maxPx を超えない距離より近づかない。
 *
 * 一周するので、頂点は重心の周りのあらゆる向き(psi)に来る。psi を細かく刻んで確かめる。
 * カメラから見た点(カメラは面の上 elev の向き、距離 D):
 *   深さ = D − R cos(psi) cos(elev)、横 = R sin(psi)、縦 = −R cos(psi) sin(elev)(上向きが正。手前 psi = 0 の頂点ほど下に見える)
 * ラベルは右か左のどちらかに出るので、横は「中心からの距離 + ラベルの幅」が画面の半分に入ることを求める(左右どちらに出ても収まる)。
 * 今の中心のラベルは球の真下に出るので、縦の下側は「球の下端 + 間 + ラベルの高さ」(belowPx)まで入ることを求める
 * (どの頂点が手前に来ても入るよう、すべての頂点で確かめる)。上下の余白 padTop・padBottom は、画面に重ねた UI の分だけ広げられる
 * @param {number} fovDeg 縦の画角(度)
 */
export function polygonFitDistance(
  radius,
  elevDeg,
  fovDeg,
  width,
  height,
  labelW,
  labelH,
  { pad, padTop = pad, padBottom = pad, maxPx, nodeGap = 16, belowPx = labelH / 2 }
) {
  const el = (elevDeg * Math.PI) / 180
  const focal = height / 2 / Math.tan((fovDeg * Math.PI) / 360) // 深さ 1 での 1 ワールド単位の px
  const fits = (D) => {
    for (let k = 0; k < 72; k++) {
      const psi = (k / 72) * Math.PI * 2
      const depth = D - radius * Math.cos(psi) * Math.cos(el)
      if (depth <= 0) return false
      const sx = (radius * Math.sin(psi) * focal) / depth
      const sy = (radius * Math.cos(psi) * Math.sin(el) * focal) / depth
      if (Math.abs(sx) + nodeGap + labelW > width / 2 - pad) return false
      // sy は画面の下向きが正(手前の頂点ほど下に見える)
      if (-sy + labelH / 2 > height / 2 - padTop) return false
      if (sy + belowPx > height / 2 - padBottom) return false
    }
    return true
  }
  // 大きな画面で広がりすぎない距離(重心の深さで半径が maxPx)
  const minByMax = (radius * focal) / maxPx
  let lo = radius * 1.01
  let hi = Math.max(minByMax, radius * 2)
  for (let i = 0; i < 60 && !fits(hi); i++) hi *= 2
  if (!fits(hi)) return Math.max(hi, minByMax) // 画面が小さすぎてラベルが入らないときは、いちばん引いた距離
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) hi = mid
    else lo = mid
  }
  return Math.max(hi, minByMax)
}
