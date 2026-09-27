/**
 * 最初のカメラ距離の決め方(SPEC 4章「最初のカメラ距離」。タスク08)。
 *
 * カメラ距離を決めるのは、今と同じく「検索したとき」と「URL から復元したとき」だけ
 * (進む・戻るでは距離を変えない。手でズームした距離も保つ。2026-09-27 利用者と合意)。
 * 表示(Graph3D の zoomToFit)と画面上の見え方の測定(src/debug/measure.js)が同じ関数を呼ぶ。
 *
 * 決め方(VizConfig の cameraFit):
 *   all … 全体が入る距離(従来。current・rev2・rev3)。外接箱の中心を見る
 *   a   … 今の中心とその子(表示中のもの)がすべて入る距離
 *   b   … a に加えて前の中心も入る距離。ただし a の CAMERA_FIT_PREV_CAP 倍まで
 *   c   … a を基本に、前の中心が a の範囲の CAMERA_FIT_PREV_EDGE 倍以内にあるときだけ含める
 *   d   … 今の中心と、関連スコアの上位の子(確定枠 GUARANTEED_TOP 件)がすべて入る距離。残りの子は画面の外に出てもよい
 * a〜d は今の中心を見る(このあとカメラは今の中心を追うので、最初から中心に合わせる)。
 * 距離は、見る点から含める点までのいちばん遠い距離を半径として、全体が入る距離と同じ式で求める
 * (縦の画角で決まるので、画面の大きさには依存しない)
 */
import {
  CAMERA_FOV,
  FIT_PADDING,
  FIT_MIN_RADIUS,
  GUARANTEED_TOP,
  CAMERA_FIT_PREV_CAP,
  CAMERA_FIT_PREV_EDGE,
  CAMERA_FIT_MODES,
} from '../constants.js'
import { fitCamera } from './forceLayout.js'

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)

/** 半径から距離を求める(fitCamera と同じ式) */
function distanceForRadius(radius) {
  const fov = (CAMERA_FOV * Math.PI) / 180
  return (Math.max(radius, FIT_MIN_RADIUS) / Math.sin(fov / 2)) * FIT_PADDING
}

/**
 * @param {Map<string, {x:number,y:number,z:number}>} nodes 今の配置
 * @param {{source:string, target:string, type?:string, relScore?:number}[]} links buildGraph の線(child は 中心 → 子)
 * @param {string|null} currentId 今の中心
 * @param {string} mode cameraFit
 * @returns {{center:{x,y,z}, distance:number, prevIncluded:boolean|null} | null}
 */
export function cameraFitFor(nodes, links, currentId, mode) {
  const current = currentId ? nodes.get(currentId) : null
  if (mode === 'all' || !current || !CAMERA_FIT_MODES.includes(mode)) {
    const fit = fitCamera(nodes.values(), CAMERA_FOV, FIT_PADDING, FIT_MIN_RADIUS)
    return fit && { ...fit, prevIncluded: null }
  }

  // 今の中心の子(表示中のもの)。並びは線の順(= 展開結果の順)。d は関連スコアの高い順に上位だけ
  let children = links
    .filter((l) => l.type === 'child' && l.source === currentId && nodes.has(l.target))
    .map((l) => ({ id: l.target, relScore: l.relScore || 0 }))
  if (mode === 'd') {
    children = [...children].sort((p, q) => q.relScore - p.relScore).slice(0, GUARANTEED_TOP)
  }
  let radius = 0
  for (const c of children) radius = Math.max(radius, dist(nodes.get(c.id), current))

  // 前の中心(軌跡で今の中心の1つ前)。b・c だけが使う
  const prevLink = links.find((l) => l.type === 'trail' && l.target === currentId && nodes.has(l.source))
  let prevIncluded = null
  if (prevLink && (mode === 'b' || mode === 'c')) {
    const rPrev = dist(nodes.get(prevLink.source), current)
    if (mode === 'b') {
      prevIncluded = rPrev <= radius * CAMERA_FIT_PREV_CAP
      radius = Math.min(Math.max(radius, rPrev), radius * CAMERA_FIT_PREV_CAP)
    } else {
      prevIncluded = rPrev <= radius * CAMERA_FIT_PREV_EDGE
      if (prevIncluded) radius = Math.max(radius, rPrev)
    }
  }
  return { center: { x: current.x, y: current.y, z: current.z }, distance: distanceForRadius(radius), prevIncluded }
}
