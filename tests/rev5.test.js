/**
 * 既定プリセットの切り替え(タスク09)のテスト。
 *   src/config/presets.ts … rev5 = rev4 + 表示件数 24。DEFAULT_PRESET は rev5
 *
 * 回帰の期待値(tests/fixtures/camera-layout-at08.json)は、タスク08 完了時のコミット(aa0d755)のコードで、
 * 保存した展開結果(tier-routes.json の12経路 + walk-routes.json の長い経路10本)から求めた
 *   - current・rev2・rev3・rev4 の最初のカメラ距離(URL から復元した場合 = 全部 / 検索した場合 = 最初の記事だけ)
 *   - 同じく配置(一度に組んだ場合と、1件ずつ歩いた場合)と、落ち着くまでのステップ数
 * 配置は全ノードの座標を JSON にした文字列の sha256 で持つ(座標そのものだと 22経路 × 4 プリセットで数 MB になるため)。
 * 下の computeGolden と同じ計算を aa0d755 のコードに対して行って作った。浮動小数点の末尾まで一致で比べる
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'

import { buildGraph } from '../src/utils/buildGraph.js'
import { buildSim, settleSim } from '../src/utils/forceLayout.js'
import { cameraFitFor } from '../src/utils/cameraFit.js'
import { PRESETS, DEFAULT_PRESET } from '../src/config/presets.ts'
import { readUrlState } from '../src/config/urlState.js'
import {
  INITIAL_FIT_DELAY_MS,
  SIM_STEPS_PER_SEC,
  GUARANTEED_TOP,
  REV5_NEIGHBOR_LIMIT,
  TRAIL_TIER_FEW_MAX,
  TRAIL_TIER_MID_MAX,
} from '../src/constants.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const routes = { ...read('tier-routes.json'), ...read('walk-routes.json') }
const golden = read('camera-layout-at08.json')
const FIT_STEP = Math.round((INITIAL_FIT_DELAY_MS / 1000) * SIM_STEPS_PER_SEC)
const hash = (sim) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([...sim.nodes].map(([id, n]) => [id, n.x, n.y, n.z])))
    .digest('hex')

function computeGolden(trail, exp, config) {
  // アプリの zoomToFit と同じ: 与えた経路を一度に組み、FIT_STEP 目の配置で cameraFit の距離
  const fit = (t) => {
    const s = buildSim(buildGraph(t, exp, new Map(), config), config)
    settleSim(s, FIT_STEP)
    return cameraFitFor(s.nodes, s.links, t[t.length - 1], config.cameraFit).distance
  }
  const s1 = buildSim(buildGraph(trail, exp, new Map(), config), config)
  const steps = settleSim(s1, 3000).steps
  let s2 = null
  let walkSteps = 0
  for (let k = 1; k <= trail.length; k++) {
    s2 = buildSim(buildGraph(trail.slice(0, k), exp, new Map(), config), config, s2)
    walkSteps = settleSim(s2, 3000).steps
  }
  return { restore: fit(trail), search: fit(trail.slice(0, 1)), steps, positions: hash(s1), walkSteps, walkPositions: hash(s2) }
}

describe('rev5 の値', () => {
  test('rev5 = rev4 + 表示件数 24(確定枠 10 + 抽選の枠 14)。ほかの値は rev4 と同じ', () => {
    assert.equal(REV5_NEIGHBOR_LIMIT, 24)
    assert.equal(PRESETS.rev5.neighborLimit, 24)
    assert.equal(GUARANTEED_TOP, 10)
    assert.deepEqual(PRESETS.rev5, { ...PRESETS.rev4, neighborLimit: 24 })
  })

  test('段階の境目は変えない(3件・7件)', () => {
    assert.equal(TRAIL_TIER_FEW_MAX, 3)
    assert.equal(TRAIL_TIER_MID_MAX, 7)
  })

  test('既定のプリセットは rev5。?preset= の無い URL は rev5 で開く', () => {
    assert.equal(DEFAULT_PRESET, 'rev5')
    const s = readUrlState('?start=初音ミク&path=鏡音リン・レン')
    assert.equal(s.presetName, 'rev5')
    assert.deepEqual(s.config, PRESETS.rev5)
  })

  test('current・rev2・rev3・rev4 は残っていて、表示件数は 40 のまま', () => {
    for (const name of ['current', 'rev2', 'rev3', 'rev4']) assert.equal(PRESETS[name].neighborLimit, 40, name)
  })
})

describe('current・rev2・rev3・rev4 の配置とカメラ距離は、タスク08 完了時と完全に一致する', () => {
  for (const preset of ['current', 'rev2', 'rev3', 'rev4']) {
    for (const [key, { trail, expansions }] of Object.entries(routes)) {
      test(`${preset} / ${key}`, () => {
        const want = golden[`${preset}/${key}`]
        assert.ok(want, '期待値がある')
        assert.deepEqual(computeGolden(trail, new Map(Object.entries(expansions)), PRESETS[preset]), want)
      })
    }
  }
})
