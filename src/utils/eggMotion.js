/**
 * 輪を閉じたときの演出(タスク10。SPEC 6.11)の時間割と光の明るさ。Graph3D から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる(点滅の回数などの安全の決まりをテストで検査する)
 *
 *   - 演出の時間割(eggPlan): 3〜5件は光らせるだけ、6件以上はカメラワーク(10b)
 *   - 線ごとの光の明るさ(loopEdgeGlow)
 *   - 輪を並べ替える正多角形(polygonVertices)・それを見下ろすカメラの距離(polygonFitDistance)・力学の状態の記録と復元(10c)
 */
import {
  EGG_CINEMATIC_MIN,
  EGG_IN_MS,
  EGG_LAP_MS,
  EGG_OUT_MS,
  EGG_REDUCED_HOLD_MS,
  EGG_CINE_IN_MS,
  EGG_CINE_ORBIT_MS,
  EGG_CINE_OUT_MS,
  EGG_CINE_LAPS,
  EGG_CINE_BASE,
  EGG_CINE_TAIL,
} from '../constants.js'

const clamp01 = (x) => Math.min(Math.max(x, 0), 1)
const smoothstep = (x) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/**
 * 輪の長さと「動きを減らす設定」から、演出の時間割を決める。
 *   cinematic … カメラワークを行うか(EGG_CINEMATIC_MIN 件以上で、動きを減らす設定でないとき)
 *   inMs / lapMs / outMs … 各段階の長さ(ms)。lapMs は光が走る時間(cinematic なら重心の周りを1周する時間)
 *   laps … lapMs のあいだに光が輪を回る回数
 *   reduced … 光を走らせず、色を付けて保つだけにする
 * @returns {{cinematic:boolean, reduced:boolean, inMs:number, lapMs:number, outMs:number, laps:number}}
 */
export function eggPlan(length, reducedMotion) {
  if (reducedMotion) {
    return { cinematic: false, reduced: true, inMs: EGG_IN_MS, lapMs: EGG_REDUCED_HOLD_MS, outMs: EGG_OUT_MS, laps: 1 }
  }
  if (length >= EGG_CINEMATIC_MIN) {
    return {
      cinematic: true,
      reduced: false,
      inMs: EGG_CINE_IN_MS,
      lapMs: EGG_CINE_ORBIT_MS,
      outMs: EGG_CINE_OUT_MS,
      laps: EGG_CINE_LAPS,
    }
  }
  return { cinematic: false, reduced: false, inMs: EGG_IN_MS, lapMs: EGG_LAP_MS, outMs: EGG_OUT_MS, laps: 1 }
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
 *   深さ = D − R cos(psi) cos(elev)、横 = R sin(psi)、縦 = −R cos(psi) sin(elev)
 * ラベルは右か左のどちらかに出るので、横は「中心からの距離 + ラベルの幅」が画面の半分に入ることを求める(左右どちらに出ても収まる)
 * @param {number} fovDeg 縦の画角(度)
 */
export function polygonFitDistance(radius, elevDeg, fovDeg, width, height, labelW, labelH, { pad, maxPx, nodeGap = 16 }) {
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
      if (Math.abs(sy) + labelH / 2 > height / 2 - pad) return false
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
