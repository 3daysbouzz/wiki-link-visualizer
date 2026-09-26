/**
 * 配置の回帰テスト(タスク07)。
 *
 * タスク07 で、中心同士の線だけバネを硬くする仕組み(trailSpringK。rev4 の段階で使う)を力学に足した。
 * trailSpringK が効かないプリセット(current・rev2・rev3)の配置が、足す前と完全に一致することを確かめる。
 *
 * 期待値(tests/fixtures/layout-before07.json)は、タスク07 の前のコミット(6d3450d)のコードで、
 * 実際の展開結果(tests/fixtures/layout-routes.json。rev2 の重み・種 1 で Wikipedia から取った3経路)から
 * 求めた全ノードの座標と、落ち着くまでのステップ数。浮動小数点の末尾まで一致で比べる。
 *   一度に組んで落ち着かせる(URL からの復元と同じ)… positions
 *   1件目で落ち着かせてから最後の記事へ進む(散歩でクリックしたのと同じ)… walkPositions
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { buildGraph } from '../src/utils/buildGraph.js'
import { buildSim, settleSim } from '../src/utils/forceLayout.js'
import { computeEdgeSpringK, trailTier } from '../src/utils/relation.js'
import { PRESETS } from '../src/config/presets.ts'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const routes = read('layout-routes.json')
const golden = read('layout-before07.json')
const positionsOf = (sim) => Object.fromEntries([...sim.nodes].map(([id, n]) => [id, [n.x, n.y, n.z]]))

describe('trailSpringK が効かないプリセットの配置は、タスク07 の前と完全に一致する', () => {
  for (const preset of ['current', 'rev2', 'rev3']) {
    const config = PRESETS[preset]

    test(`${preset}: どの線も springK のまま(trailSpringK は効かない)`, () => {
      for (const type of ['trail', 'child']) assert.equal(computeEdgeSpringK({ type }, config), null)
    })

    for (const [key, { trail, expansions }] of Object.entries(routes)) {
      const exp = new Map(Object.entries(expansions))
      const want = golden[`${preset}/${key}`]

      test(`${preset} / ${key}: 一度に組んで落ち着かせた配置`, () => {
        const sim = buildSim(buildGraph(trail, exp, new Map(), config), config)
        const { steps } = settleSim(sim, 3000)
        assert.equal(steps, want.steps)
        assert.deepEqual(positionsOf(sim), want.positions)
      })

      test(`${preset} / ${key}: 1件目から最後の記事へ進んだ後の配置`, () => {
        const first = buildSim(buildGraph(trail.slice(0, -1), exp, new Map(), config), config)
        settleSim(first, 3000)
        const sim = buildSim(buildGraph(trail, exp, new Map(), config), config, first)
        const { steps } = settleSim(sim, 3000)
        assert.equal(steps, want.walkSteps)
        assert.deepEqual(positionsOf(sim), want.walkPositions)
      })
    }
  }
})

test('rev4 では配置が変わる(期待値との比較が実際に効いていることの確認)', () => {
  const { trail, expansions } = routes.work
  const exp = new Map(Object.entries(expansions))
  const config = PRESETS.rev4
  const sim = buildSim(buildGraph(trail, exp, new Map(), config), config)
  settleSim(sim, 3000)
  assert.notDeepEqual(positionsOf(sim), golden['rev3/work'].positions)
})

describe('中心同士の距離の段階(rev4。SPEC 6.9 の 1b)', () => {
  // src/debug/benchRoutes.js の tiers の組(段階ごとに2〜4組)。rev2 の重み・種 1 で取った展開結果
  const tierRoutes = read('tier-routes.json')
  const config = PRESETS.rev4
  const byTier = {}
  for (const { trail, expansions } of Object.values(tierRoutes)) {
    const exp = new Map(Object.entries(expansions))
    const sim = buildSim(buildGraph(trail, exp, new Map(), config), config)
    settleSim(sim, 3000)
    for (const l of sim.links) {
      if (l.type !== 'trail') continue
      const a = sim.nodes.get(l.source)
      const b = sim.nodes.get(l.target)
      const tier = trailTier(l.sharedCount)
      ;(byTier[tier] ||= []).push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z))
    }
  }

  test('どの段階も2組以上ある', () => {
    for (const tier of ['none', 'few', 'mid', 'many']) assert.ok(byTier[tier].length >= 2, tier)
  })

  test('隣り合う段階の実際の距離の比が、最悪値でも 1.3 倍以上', () => {
    const order = ['many', 'mid', 'few', 'none']
    for (let i = 1; i < order.length; i++) {
      const near = Math.max(...byTier[order[i - 1]])
      const far = Math.min(...byTier[order[i]])
      assert.ok(far / near >= 1.3, `${order[i]} / ${order[i - 1]} = ${(far / near).toFixed(3)}`)
    }
  })
})
