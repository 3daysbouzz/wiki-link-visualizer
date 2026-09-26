/**
 * Graph3D.jsx から切り出した計算が、切り出す前と同じ結果を返すかのテスト(タスク06。SPEC 12.5)。
 *   src/utils/forceLayout.js … 力学の1ステップ
 *   src/utils/labelSelect.js … ラベルの選び方
 *
 * 期待値(tests/fixtures/extract-golden.json)は、切り出す前のコミット(0d60a1c)の Graph3D.jsx から
 * stepSimulation / updateLabelVisibility の本文をそのまま取り出して、下と同じ入力で動かした結果。
 * 表示の配置とラベルの出方が変わっていないことを、浮動小数点の末尾まで一致で確かめる
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'

import { stepForces } from '../src/utils/forceLayout.js'
import { selectLabels, focusForArrival } from '../src/utils/labelSelect.js'
import { seededRandom } from '../src/utils/prng.js'
import { LABEL_KEEP_BIAS } from '../src/constants.js'

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/extract-golden.json', import.meta.url), 'utf8'))

describe('力学の1ステップ(stepForces)', () => {
  function makeSim() {
    const r = seededRandom(7, 'golden')
    const nodes = new Map()
    for (let i = 0; i < 30; i++) {
      const id = `n${i}`
      nodes.set(id, { id, x: (r() - 0.5) * 120, y: (r() - 0.5) * 120, z: (r() - 0.5) * 120, vx: 0, vy: 0, vz: 0 })
    }
    // 2点を同じ座標にして、jitter の分岐も通す
    Object.assign(nodes.get('n29'), { x: nodes.get('n28').x, y: nodes.get('n28').y, z: nodes.get('n28').z })
    const links = []
    for (let i = 1; i < 30; i++) links.push({ source: 'n0', target: `n${i}`, springLength: 33 + (i % 5) * 11 })
    for (let i = 1; i < 10; i++) links.push({ source: `n${i}`, target: `n${i + 10}`, springLength: 55 })
    return {
      nodes, links, alpha: 1, jitter: seededRandom(1, 'jitter'),
      layout: { repulsion: 2600, repulsionRange: 320, springK: 0.012, centerK: 0.006, damping: 0.86, alphaDecay: 0.99 },
    }
  }

  test('決まった入力で、切り出す前と同じ位置・alpha になる(1・50・450 ステップ目)', () => {
    const sim = makeSim()
    let stepped = 0
    for (let s = 1; s <= 450; s++) {
      if (stepForces(sim)) stepped += 1
      const want = golden.snaps[s]
      if (!want) continue
      assert.equal(sim.alpha, want.alpha)
      assert.deepEqual(Array.from(sim.nodes.values()).map((n) => [n.x, n.y, n.z]), want.pos)
    }
    // alpha が ALPHA_MIN を下回ったら進めない(0.99^418 < 0.015)
    assert.equal(stepped, 418)
  })
})

describe('ラベルの選び方(selectLabels)', () => {
  function makeState({ fadeOn, hoveredId = null, boost = [] }) {
    const r = seededRandom(3, 'labels')
    const nodes = []
    const adjacency = new Map()
    for (let i = 0; i < 40; i++) {
      const id = `L${i}`
      const tier = i === 0 ? 0 : i < 25 ? 1 : 2
      nodes.push({
        id, tier, isCurrent: i === 0,
        x: (r() - 0.5) * 300, y: (r() - 0.5) * 200, z: (r() - 0.5) * 300,
        basePx: i === 0 ? 14 : tier === 1 ? 6 + (i % 4) : 4,
        fadeTarget: fadeOn ? Math.round(r() * 100) / 100 : 1,
        selected: false,
        visible: false,
        center: { x: 0, y: 0 },
        labelPx: i === 0 ? 14 * 1.4 : 12 * 1.4,
        labelAspect: 2 + (i % 7) * 0.9,
      })
      adjacency.set(id, new Set())
    }
    for (let i = 1; i < 25; i++) {
      adjacency.get('L0').add(`L${i}`)
      adjacency.get(`L${i}`).add('L0')
    }
    const camera = new THREE.PerspectiveCamera(60, 940 / 736, 1, 6000)
    camera.position.set(20, 30, 420)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    return { nodes, adjacency, hoveredId, camera, boost: new Set(boost), fadeOn }
  }

  // Graph3D の updateLabelVisibility と同じ手順で、選んだ結果を反映する
  function update(st, keepBias = LABEL_KEEP_BIAS) {
    const items = st.nodes.map((n) => {
      const wasSelected = n.selected
      n.selected = false
      if (!st.fadeOn) n.visible = false
      return {
        id: n.id, isCurrent: n.isCurrent, tier: n.tier, boosted: st.boost.has(n.id),
        fadeTarget: n.fadeTarget, wasSelected, pos: n, radiusPx: n.basePx,
        labelPx: n.labelPx, labelAspect: n.labelAspect,
      }
    })
    const results = selectLabels(items, {
      camera: st.camera, width: 940, height: 736,
      hoveredId: st.hoveredId,
      neighbors: st.hoveredId ? st.adjacency.get(st.hoveredId) : null,
      fadeOn: st.fadeOn, visibleLabels: 12, keepBias,
    })
    st.nodes.forEach((n, i) => {
      const res = results[i]
      n.reason = res.reason
      if (res.center) n.center = { ...res.center }
      if (res.selected) {
        n.selected = true
        n.visible = true
      }
    })
    return results
  }
  const snap = (st) => st.nodes.map((n) => [n.id, n.reason, n.selected ? 1 : 0, n.visible, n.center.x, n.center.y])
  const rotate = (st) => {
    st.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.15)
    st.camera.lookAt(0, 0, 0)
    st.camera.updateMatrixWorld()
  }

  const cases = {
    plain: { fadeOn: false },
    fade: { fadeOn: true },
    hover: { fadeOn: true, hoveredId: 'L3' },
    boost: { fadeOn: true, boost: ['L20', 'L21'] },
  }
  for (const [name, opt] of Object.entries(cases)) {
    test(`前回の表示を渡すと、切り出す前と同じ結果になる(${name})`, () => {
      const st = makeState(opt)
      update(st)
      assert.deepEqual(snap(st), golden.labelCases[name].first)
      rotate(st)
      update(st)
      assert.deepEqual(snap(st), golden.labelCases[name].second)
    })
  }

  test('まっさらな状態で選ぶと、前回の表示に左右されない', () => {
    // 同じカメラで「一度選んでから回した」ものと「回した位置でいきなり選んだ」ものを、
    // wasSelected=false・keepBias=1 で選び直すと一致する
    const a = makeState({ fadeOn: true })
    update(a)
    rotate(a)
    for (const n of a.nodes) n.selected = false
    const fromA = update(a, 1).map((r) => r.reason)

    const b = makeState({ fadeOn: true })
    rotate(b)
    const fromB = update(b, 1).map((r) => r.reason)
    assert.deepEqual(fromA, fromB)
  })

  test('前回の表示の優遇(keepBias)は、同じ場所を争ったときに前回表示していた方を勝たせる', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 6000)
    camera.position.set(0, 0, 300)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    // a は b より少し遠いが、ほぼ同じ場所に出る(ラベルが重なる)
    const item = (id, z, wasSelected) => ({
      id, isCurrent: false, tier: 1, boosted: false, fadeTarget: 1, wasSelected,
      pos: { x: 0, y: 0, z }, radiusPx: 6, labelPx: 16.8, labelAspect: 4,
    })
    const opts = (keepBias) => ({
      camera, width: 800, height: 800, hoveredId: null, neighbors: null,
      fadeOn: false, visibleLabels: 12, keepBias,
    })
    const items = [item('a', 0, true), item('b', 10, false)]
    assert.deepEqual(selectLabels(items, opts(LABEL_KEEP_BIAS)).map((r) => r.reason), ['shown', 'overlap'])
    assert.deepEqual(selectLabels(items, opts(1)).map((r) => r.reason), ['overlap', 'shown'])
  })
})

describe('ラベルの注目状態: 到着時の共通ワード強調(focusForArrival。SPEC 6.10)', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 6000)
  camera.position.set(0, 0, 300)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const item = (id, x, fadeTarget, extra = {}) => ({
    id, isCurrent: false, tier: 1, boosted: false, fadeTarget, wasSelected: false,
    pos: { x, y: 0, z: 0 }, radiusPx: 6, labelPx: 16.8, labelAspect: 4, ...extra,
  })
  const opts = (focus) => ({
    camera, width: 800, height: 800, focus, fadeOn: true, visibleLabels: 24, keepBias: 1,
  })
  // s3 は共通ワードだが名前を保証しない(labelOrder に無い)
  const set = { nodes: new Set(['C', 'P', 's1', 's2', 's3']), labelOrder: ['C', 'P', 's1', 's2'] }

  test('対象は深さフェードを受けず(奥でも出る)、対象の外は reason=arrival で出さない', () => {
    const items = [
      item('C', -120, 1, { isCurrent: true, tier: 0 }),
      item('P', -60, 0, { tier: 2 }), // 奥で深さフェードの目標が 0
      item('s1', 60, 0),
      item('other', 120, 1),
      item('s3', 0, 1, { pos: { x: 0, y: 100, z: 0 } }),
    ]
    const reasons = selectLabels(items, opts(focusForArrival(set))).map((r) => r.reason)
    // 名前を保証しない共通ワード(s3)も、ほかと同じくラベルは出さない
    assert.deepEqual(reasons, ['shown', 'shown', 'shown', 'arrival', 'arrival'])
    // 強調していなければ、奥の2件は深さで消える
    assert.deepEqual(selectLabels(items, opts(null)).map((r) => r.reason), ['shown', 'depth', 'depth', 'shown', 'shown'])
  })

  test('対象どうしが重なったら、今の中心の並び順が上のもの(labelOrder の前)が場所を取る', () => {
    // s2 の方がカメラに近いが、並び順は s1 が上
    const items = [item('s2', 0, 1, { pos: { x: 0, y: 0, z: 20 } }), item('s1', 0, 1)]
    const reasons = selectLabels(items, opts(focusForArrival(set))).map((r) => r.reason)
    assert.deepEqual(reasons, ['overlap', 'shown'])
  })
})
