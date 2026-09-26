/**
 * 3D の位置を画面(描画領域内の CSS px)へ投影する計算と、測定用の視点の決め方(SPEC 6.3・12.5)。
 * Graph3D.jsx から切り出した。
 *
 * 表示(ラベルの間引き・クリック判定・window.__viz.screenOf)と、
 * 画面上の見え方の測定(src/debug/measure.js)が同じ関数を呼ぶ。
 * three の数学クラスだけを使う(描画はしない)ので node:test でも動く。
 */
import * as THREE from 'three'
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR } from '../constants.js'

const _p = new THREE.Vector3()
const _forward = new THREE.Vector3()

/**
 * point を camera で投影し、描画領域 width×height の中の px 座標にする。
 * inFront は「カメラの前にあり、奥行きの描画範囲に入っているか」(NDC の z が -1〜1)。
 * カメラの後ろにある点は z が範囲外になる。x・y は後ろの点でも数値が入るが意味はない
 *
 * @param {{x:number,y:number,z:number}} point
 * @param {THREE.Camera} camera 行列(matrixWorldInverse・projectionMatrix)が最新であること
 * @param {object} [out] 結果を書き込むオブジェクト(毎フレームの new を避けたいとき)
 * @returns {{x:number, y:number, inFront:boolean}}
 */
export function projectToScreen(point, camera, width, height, out = {}) {
  _p.set(point.x, point.y, point.z).project(camera)
  out.x = (_p.x * 0.5 + 0.5) * width
  out.y = (-_p.y * 0.5 + 0.5) * height
  out.inFront = !(_p.z < -1 || _p.z > 1)
  return out
}

/** 投影した点が描画領域の中(端を含む)にあるか */
export function isOnScreen(s, width, height) {
  return s.inFront && s.x >= 0 && s.x <= width && s.y >= 0 && s.y <= height
}

/**
 * 視線方向に沿った深さ(ラベルの深さフェードに使う。SPEC 6.3)。
 * forward は camera.getWorldDirection で求めた単位ベクトル。省略時はここで求める
 */
export function viewDepth(point, camera, forward) {
  const f = forward || camera.getWorldDirection(_forward)
  return (point.x - camera.position.x) * f.x +
    (point.y - camera.position.y) * f.y +
    (point.z - camera.position.z) * f.z
}

/**
 * 表示と同じ画角・描画範囲のカメラを作る(測定の仮想画面用)。
 * target を注視し、up を上方向にする。行列まで更新した状態で返す
 */
export function makeViewCamera(width, height, position, target, up = { x: 0, y: 1, z: 0 }) {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / height, CAMERA_NEAR, CAMERA_FAR)
  aimCamera(camera, position, target, up)
  return camera
}

/** カメラの位置と向きを変え、行列を更新する */
export function aimCamera(camera, position, target, up = { x: 0, y: 1, z: 0 }) {
  camera.up.set(up.x, up.y, up.z)
  camera.position.set(position.x, position.y, position.z)
  camera.lookAt(target.x, target.y, target.z)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

/**
 * 中心を囲む球面上に均等に並べた n 方向(フィボナッチ球面)。単位ベクトルの列。
 * 乱数を使わないので毎回同じ並びになる
 */
export function orbitDirections(n) {
  const out = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    // y を上端・下端から半刻みずらすと、真上・真下を向く方向が出ない
    const y = 1 - ((i + 0.5) / n) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i
    out.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
  }
  return out
}

/**
 * カメラの上方向。視線(中心 → カメラの向き dir)が (0,1,0) とほぼ平行なときだけ (0,0,1) にする
 * (平行だと lookAt の向きが決まらず、画面が不定に回るため)
 */
export function cameraUpFor(dir) {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  return Math.abs(dir.y / len) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }
}
