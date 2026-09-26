/**
 * 力学レイアウトの計算(SPEC 8章・12.1)。Graph3D.jsx から切り出した純粋関数。
 *
 * 表示(Graph3D)と画面上の見え方の測定(src/debug/measure.js。SPEC 12.5)が同じ関数を呼ぶ。
 * 測定側で計算を写して作り直すと、表示の調整が測定に反映されずに数字だけがずれていくので、
 * ここを唯一の実装にしている。three に依存しないので node:test で直接確かめられる。
 */
import { ALPHA_MIN, MAX_SPEED, SPAWN_SPREAD } from '../constants.js'
import { seededRandom } from './prng.js'
import { computeEdgeSpringLength, computeEdgeSpringK } from './relation.js'
import { LAYOUT_KEYS } from '../config/presets.ts'

/**
 * ノードの初期位置を (seed, 記事名) から決める。
 * 原点付近にばらまく(完全に同一座標だと反発力が発散する)。
 * random は seededRandom(seed, id) を渡す。追加表示の出現位置(Graph3D)も同じ乱数列を使うので、
 * 乱数は呼ぶ側で作る
 */
export function spawnScatter(random, out) {
  out.x = (random() - 0.5) * SPAWN_SPREAD
  out.y = (random() - 0.5) * SPAWN_SPREAD
  out.z = (random() - 0.5) * SPAWN_SPREAD
  return out
}

/** 初期位置(追加表示でない場合)。測定はこちらを使う */
export function initialPosition(seed, id, out) {
  return spawnScatter(seededRandom(seed, id), out)
}

/**
 * 力学シミュレーションを1ステップ進める。
 *
 * sim は { nodes: Map<id, node>, links, layout, alpha, jitter } を持つオブジェクト
 * (Graph3D の ctx をそのまま渡せる形)。node は x/y/z と vx/vy/vz を持ち、ここで書き換える。
 * link は { source, target, springLength, springK? }。springK が無ければ layout.springK を使う。
 *
 * alpha が ALPHA_MIN を下回っていたら何もしない。
 * @returns {boolean} 実際に進めたか(落ち着くまでのステップ数を数えるのに使う)
 */
export function stepForces(sim) {
  if (sim.alpha < ALPHA_MIN) return false

  const nodes = Array.from(sim.nodes.values())
  const n = nodes.length
  if (n === 0) return false

  // 毎ステップ config を読みに行かず、最初に取り出しておく(内側のループが O(n^2) のため)
  const {
    repulsion,
    repulsionRange,
    springK,
    centerK,
    damping,
    alphaDecay,
  } = sim.layout

  // --- ノード間の反発(O(n^2)。数百ノード程度までを想定) ---
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dz = a.z - b.z
      let distSq = dx * dx + dy * dy + dz * dz

      if (distSq > repulsionRange * repulsionRange) continue
      if (distSq < 1) {
        // ほぼ同一座標だと力が発散するので微小にずらす
        dx = sim.jitter() - 0.5
        dy = sim.jitter() - 0.5
        dz = sim.jitter() - 0.5
        distSq = 1
      }

      const dist = Math.sqrt(distSq)
      const force = repulsion / distSq
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      const fz = (dz / dist) * force

      a.vx += fx
      a.vy += fy
      a.vz += fz
      b.vx -= fx
      b.vy -= fy
      b.vz -= fz
    }
  }

  // --- リンクのバネ ---
  for (const link of sim.links) {
    const a = sim.nodes.get(link.source)
    const b = sim.nodes.get(link.target)
    if (!a || !b) continue

    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001
    // 自然長は線ごと(関連スコア・中心同士の関係で変わる。SPEC 6.9)。
    // distanceByScore が off なら、どの線も config.springLength が入っている
    const force = (dist - link.springLength) * (link.springK ?? springK)
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    const fz = (dz / dist) * force

    a.vx += fx
    a.vy += fy
    a.vz += fz
    b.vx -= fx
    b.vy -= fy
    b.vz -= fz
  }

  // --- 中心への引力 + 速度更新 ---
  for (const node of nodes) {
    node.vx -= node.x * centerK
    node.vy -= node.y * centerK
    node.vz -= node.z * centerK

    node.vx *= damping
    node.vy *= damping
    node.vz *= damping

    const speed = Math.sqrt(
      node.vx * node.vx + node.vy * node.vy + node.vz * node.vz
    )
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed
      node.vx *= s
      node.vy *= s
      node.vz *= s
    }

    node.x += node.vx * sim.alpha
    node.y += node.vy * sim.alpha
    node.z += node.vz * sim.alpha
  }

  sim.alpha *= alphaDecay
  return true
}

/**
 * グラフ全体が収まるカメラの注視点と距離(zoomToFit の式)。
 * 画角は縦方向(PerspectiveCamera の fov)なので、画面の大きさには依存しない。
 * points は {x,y,z} の列。空なら null
 *
 * @returns {{center:{x,y,z}, distance:number} | null}
 */
export function fitCamera(points, fovDeg, padding, minRadius) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let count = 0
  for (const p of points) {
    count += 1
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  if (count === 0) return null
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
  // THREE.Box3 の getSize().length() と同じ計算にする(Math.hypot は末尾の桁が違うことがある)
  const sx = maxX - minX
  const sy = maxY - minY
  const sz = maxZ - minZ
  const radius = Math.max(Math.sqrt(sx * sx + sy * sy + sz * sz) / 2, minRadius)
  const fov = (fovDeg * Math.PI) / 180
  return { center, distance: (radius / Math.sin(fov / 2)) * padding }
}

/**
 * グラフ(buildGraph の戻り値)から、力学の計算に渡す状態を作る。Graph3D の syncGraph と同じ手順:
 *   - ノードは graphData.nodes の順に並べる(反発の計算順が配置に効く)
 *   - 初期位置は (seed, 記事名) から決める
 *   - 線ごとに自然長と硬さを決める(SPEC 6.9)
 * previous(前の状態)を渡すと、散歩でクリックしたときと同じく、残るノードは位置と速度と並び順を引き継ぎ、
 * 新しいノードだけを初期位置に置き、alpha を 1 に戻す(乱数列 jitter も引き継ぐ)
 *
 * 画面上の見え方の測定(src/debug/measure.js)と、配置の回帰テストが使う
 */
export function buildSim(graph, config, previous = null) {
  const layout = {}
  for (const k of LAYOUT_KEYS) layout[k] = config[k]

  const nodes = new Map()
  const incoming = new Set(graph.nodes.map((g) => g.id))
  if (previous) {
    for (const [id, node] of previous.nodes) if (incoming.has(id)) nodes.set(id, node)
  }
  for (const g of graph.nodes) {
    if (nodes.has(g.id)) continue
    const node = { id: g.id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    initialPosition(config.seed, g.id, node)
    nodes.set(g.id, node)
  }
  const links = graph.links
    .map((l) => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      type: l.type,
      relScore: l.relScore || 0,
      mutual: l.mutual ? 1 : 0,
      sharedCount: l.sharedCount || 0,
    }))
    .filter((l) => nodes.has(l.source) && nodes.has(l.target))
  for (const link of links) {
    link.springLength = computeEdgeSpringLength(link, layout)
    link.springK = computeEdgeSpringK(link, layout)
  }
  return {
    nodes,
    links,
    layout,
    alpha: 1,
    jitter: previous ? previous.jitter : seededRandom(config.seed, 'jitter'),
  }
}

/**
 * alpha が ALPHA_MIN を下回るまで(最大 maxSteps)進める。onStep(steps, sim) を毎ステップ呼ぶ。
 * @returns {{steps:number, capped:boolean}}
 */
export function settleSim(sim, maxSteps, onStep = null) {
  let steps = 0
  while (steps < maxSteps && stepForces(sim)) {
    steps += 1
    if (onStep) onStep(steps, sim)
  }
  return { steps, capped: sim.alpha >= ALPHA_MIN }
}
