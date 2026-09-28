/**
 * 輪を閉じたときの演出(タスク10。SPEC 6.11)の時間割と光の明るさ。Graph3D から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる(点滅の回数などの安全の決まりをテストで検査する)
 *
 *   - 演出の時間割(eggPlan): 3〜5件は光らせるだけ、6件以上はカメラワーク(10b)
 *   - 線ごとの光の明るさ(loopEdgeGlow)
 *   - 輪全体がどの向きからでも収まるカメラ距離(orbitFitDistance)
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

/**
 * 半径 radius の球(輪を囲む球)が、どの向きから見ても画面に収まるカメラ距離。
 * 画角の短い方(縦 fov と、横の画角のうち小さい方)の半分に球が入る距離に、余裕 margin を掛ける
 * @param {number} fovDeg 縦の画角(度)
 * @param {number} aspect 幅 ÷ 高さ
 */
export function orbitFitDistance(radius, fovDeg, aspect, margin) {
  const halfV = (fovDeg * Math.PI) / 360
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  const half = Math.min(halfV, halfH)
  return (radius / Math.sin(half)) * margin
}
