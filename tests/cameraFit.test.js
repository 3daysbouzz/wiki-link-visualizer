/**
 * 最初のカメラ距離の決め方のテスト(タスク08。SPEC 4章)。
 *   src/utils/cameraFit.js … cameraFitFor(all / a / b / c / d)
 *
 * 回帰の期待値(tests/fixtures/camera-before08.json)は、タスク08 の前のコミット(f333400 = タスク07 完了時)のコードで、
 * 段階の確認用の12経路の展開結果(tests/fixtures/tier-routes.json)から求めた
 *   - current・rev2・rev3・rev4 の最初のカメラ距離(URL から復元した場合 = 全部 / 検索した場合 = 最初の記事だけ)
 *   - rev4 の配置(一度に組んだ場合と、1件ずつ歩いた場合)
 * 浮動小数点の末尾まで一致で比べる
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { buildGraph } from '../src/utils/buildGraph.js'
import { buildSim, settleSim } from '../src/utils/forceLayout.js'
import { cameraFitFor } from '../src/utils/cameraFit.js'
import { PRESETS } from '../src/config/presets.ts'
import {
  INITIAL_FIT_DELAY_MS,
  SIM_STEPS_PER_SEC,
  CAMERA_FIT,
  CAMERA_FIT_MODES,
  GUARANTEED_TOP,
  CAMERA_FIT_PREV_CAP,
} from '../src/constants.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const routes = read('tier-routes.json')
const golden = read('camera-before08.json')
const FIT_STEP = Math.round((INITIAL_FIT_DELAY_MS / 1000) * SIM_STEPS_PER_SEC)
const positionsOf = (sim) => Object.fromEntries([...sim.nodes].map(([id, n]) => [id, [n.x, n.y, n.z]]))

// アプリの zoomToFit と同じ: 与えた経路を一度に組み、FIT_STEP 目の配置で cameraFit の距離
function fitFor(trail, exp, config) {
  const sim = buildSim(buildGraph(trail, exp, new Map(), config), config)
  settleSim(sim, FIT_STEP)
  return cameraFitFor(sim.nodes, sim.links, trail[trail.length - 1], config.cameraFit)
}

describe('current・rev2・rev3 の最初のカメラ距離は、タスク08 の前と完全に一致する', () => {
  for (const preset of ['current', 'rev2', 'rev3']) {
    test(`${preset}: cameraFit は従来の 'all'`, () => assert.equal(PRESETS[preset].cameraFit, 'all'))
    for (const [key, { trail, expansions }] of Object.entries(routes)) {
      test(`${preset} / ${key}: URL から復元した場合と、検索した場合`, () => {
        const exp = new Map(Object.entries(expansions))
        const want = golden.camera[`${preset}/${key}`]
        assert.equal(fitFor(trail, exp, PRESETS[preset]).distance, want.restore)
        assert.equal(fitFor(trail.slice(0, 1), exp, PRESETS[preset]).distance, want.search)
      })
    }
  }
})

describe('rev4 の配置(中心同士の距離の段階)は、タスク08 の前と完全に一致する', () => {
  const config = PRESETS.rev4
  for (const [key, { trail, expansions }] of Object.entries(routes)) {
    test(`rev4 / ${key}: 一度に組んだ配置と、1件ずつ歩いた配置`, () => {
      const exp = new Map(Object.entries(expansions))
      const want = golden.rev4[key]
      const s1 = buildSim(buildGraph(trail, exp, new Map(), config), config)
      assert.equal(settleSim(s1, 3000).steps, want.steps)
      assert.deepEqual(positionsOf(s1), want.positions)
      let s2 = null
      let walkSteps = 0
      for (let k = 1; k <= trail.length; k++) {
        s2 = buildSim(buildGraph(trail.slice(0, k), exp, new Map(), config), config, s2)
        walkSteps = settleSim(s2, 3000).steps
      }
      assert.equal(walkSteps, want.walkSteps)
      assert.deepEqual(positionsOf(s2), want.walkPositions)
    })
  }
})

describe('rev4 の最初のカメラ距離(cameraFit d)', () => {
  test('既定は all、rev4 だけ d', () => {
    assert.equal(CAMERA_FIT, 'all')
    assert.equal(PRESETS.rev4.cameraFit, 'd')
  })

  test('どの経路でも、URL から復元した場合は 07 の決め方(全体)より近い', () => {
    for (const [key, { trail, expansions }] of Object.entries(routes)) {
      const exp = new Map(Object.entries(expansions))
      assert.ok(fitFor(trail, exp, PRESETS.rev4).distance < golden.camera[`rev4/${key}`].restore, key)
    }
  })

  test('URL の cameraFit で上書きでき、知らない値は元の値に戻る', async () => {
    const { readUrlState } = await import('../src/config/urlState.js')
    assert.equal(readUrlState('?preset=rev4&cameraFit=a').config.cameraFit, 'a')
    assert.equal(readUrlState('?preset=rev4&cameraFit=zoom').config.cameraFit, 'd')
    assert.deepEqual(CAMERA_FIT_MODES, ['all', 'a', 'b', 'c', 'd'])
  })
})

describe('cameraFitFor(小さな入力)', () => {
  // 今の中心 C のまわりに子。子の関連スコアは 1 から下がっていく。遠い子 far は関連が最も低い
  const nodes = new Map([['C', { x: 0, y: 0, z: 0 }], ['P', { x: 300, y: 0, z: 0 }]])
  const links = [{ source: 'P', target: 'C', type: 'trail' }]
  for (let i = 0; i < GUARANTEED_TOP + 2; i++) {
    const id = `k${i}`
    nodes.set(id, { x: 0, y: 50 + i, z: 0 })
    links.push({ source: 'C', target: id, type: 'child', relScore: 1 - i * 0.01 })
  }
  nodes.set('far', { x: 0, y: 0, z: 400 })
  links.push({ source: 'C', target: 'far', type: 'child', relScore: 0 })
  const radiusOf = (mode) => cameraFitFor(nodes, links, 'C', mode)
  const r = (k) => radiusOf(k).distance

  test('a〜d は今の中心を見る。all は外接箱の中心', () => {
    assert.deepEqual(radiusOf('d').center, { x: 0, y: 0, z: 0 })
    assert.notDeepEqual(radiusOf('all').center, { x: 0, y: 0, z: 0 })
  })

  test('d は確定枠の子だけで決まり、遠くに飛んだ子(far)に引っ張られない', () => {
    // 確定枠の最も遠い子は y = 50 + (GUARANTEED_TOP - 1)
    assert.ok(r('d') < r('a'))
    assert.equal(r('a'), r('c')) // P は a の範囲(400)の 1.2 倍以内なので含まれるが、400 より近いので変わらない
  })

  test('b は前の中心まで広げるが、a の CAMERA_FIT_PREV_CAP 倍を超えない', () => {
    const near = new Map(nodes)
    near.delete('far')
    const linksNear = links.filter((l) => l.target !== 'far')
    const a = cameraFitFor(near, linksNear, 'C', 'a').distance
    const b = cameraFitFor(near, linksNear, 'C', 'b')
    assert.ok(b.distance > a)
    assert.ok(b.distance <= a * CAMERA_FIT_PREV_CAP + 1e-9)
  })

  test('今の中心が無ければ全体(all)と同じ', () => {
    assert.deepEqual(cameraFitFor(nodes, links, null, 'd'), cameraFitFor(nodes, links, null, 'all'))
  })
})
