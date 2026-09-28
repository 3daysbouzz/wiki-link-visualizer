/**
 * 輪を閉じたときの演出(タスク10。SPEC 6.11)のテスト。
 *   src/utils/relation.js … detectLoop・loopRoute・loopCandidates・eggColorFor
 *   src/config/presets.ts … easterEgg の既定値
 * current・rev2・rev3 の配置とカメラ距離が 09 完了時と一致することは tests/rev5.test.js が検査している
 * (09 で配置・カメラの計算は変えていないので、08 完了時の期待値 = 09 完了時)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  detectLoop,
  loopRoute,
  loopCandidates,
  loopCandidateSteps,
  eggColorFor,
  startsArrival,
} from '../src/utils/relation.js'
import { buildGraph } from '../src/utils/buildGraph.js'
import { PRESETS } from '../src/config/presets.ts'
import { readUrlState } from '../src/config/urlState.js'
import { EGG_COLORS, EASTER_EGG, EGG_CINEMATIC_MIN, EGG_HINT_PERIOD_S, BREATH_PERIOD_S } from '../src/constants.js'

const kids = (...titles) => titles.map((title) => ({ title }))

describe('detectLoop(輪の判定)', () => {
  // A → B → C → D と進んだ。D の子は A・B・C・x
  const shown = ['A', 'B', 'C', 'D']
  const expansions = new Map([['D', kids('A', 'B', 'C', 'x')]])

  test('今の中心の子を通って、経路の記事へ戻ると輪(長さ = 輪に含まれる中心の数)', () => {
    assert.equal(detectLoop(shown, expansions, 'A'), 4)
  })

  test('経路の途中から始まる輪(D から B へ戻る = 長さ3)', () => {
    assert.equal(detectLoop(shown, expansions, 'B'), 3)
    assert.deepEqual(loopRoute(shown, 3), ['B', 'C', 'D'])
  })

  test('A → B → A(長さ2)は輪にしない', () => {
    assert.equal(detectLoop(shown, expansions, 'C'), 0)
    assert.equal(detectLoop(['A', 'B'], new Map([['B', kids('A')]]), 'A'), 0)
  })

  test('今の中心の子でない記事へ戻っても輪にしない', () => {
    const e = new Map([['D', kids('C', 'x')]])
    assert.equal(detectLoop(shown, e, 'A'), 0)
    assert.equal(detectLoop(shown, e, 'B'), 0)
  })

  test('経路にない記事(未訪問の子)は輪にしない', () => {
    assert.equal(detectLoop(shown, expansions, 'x'), 0)
  })

  test('今の中心そのもの・展開していない中心は 0', () => {
    assert.equal(detectLoop(shown, expansions, 'D'), 0)
    assert.equal(detectLoop(shown, new Map(), 'A'), 0)
  })

  test('trailEnabled=false(画面に出す経路が今の中心だけ)なら輪は起きない', () => {
    assert.equal(detectLoop(shown.slice(-1), expansions, 'A'), 0)
  })

  test('輪の線はすべてグラフにある(経路の線と、今の中心 → 戻り先の子の線)', () => {
    const e = new Map([
      ['A', kids('B', 'y')],
      ['B', kids('C')],
      ['C', kids('D')],
      ['D', kids('A', 'B', 'C', 'x')],
    ])
    const graph = buildGraph(shown, e, new Map(), PRESETS.rev5)
    const has = (a, b) => graph.links.some((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a))
    for (const target of ['A', 'B']) {
      const route = loopRoute(shown, detectLoop(shown, e, target))
      for (let j = 0; j < route.length; j++) {
        assert.ok(has(route[j], route[(j + 1) % route.length]), `${route[j]} - ${route[(j + 1) % route.length]}`)
      }
    }
  })
})

describe('loopCandidates(輪の候補)', () => {
  test('2つ以上前に通った記事だけを返す。1つ前の中心は含めない。並びは展開結果の順', () => {
    const e = new Map([['D', kids('C', 'x', 'B', 'A')]])
    assert.deepEqual(loopCandidates(['A', 'B', 'C', 'D'], e), ['B', 'A'])
  })

  test('中心が2件以下なら候補は無い', () => {
    assert.deepEqual(loopCandidates(['A', 'B'], new Map([['B', kids('A')]])), [])
    assert.deepEqual(loopCandidates(['A'], new Map()), [])
  })

  test('候補はどれも、クリックすれば輪になる', () => {
    const shown = ['A', 'B', 'C', 'D', 'E']
    const e = new Map([['E', kids('A', 'C', 'D', 'q')]])
    for (const t of loopCandidates(shown, e)) assert.ok(detectLoop(shown, e, t) >= 3, t)
  })

  test('M10(loopCandidateSteps)は各時点の loopCandidates の数(表示と測定が同じ関数を呼ぶ)', () => {
    const trail = ['A', 'B', 'C', 'D']
    const e = new Map([
      ['C', kids('A', 'B')],
      ['D', kids('A', 'B', 'C')],
    ])
    const m = loopCandidateSteps(trail, e)
    assert.deepEqual(m.perStep.map((p) => p.titles), [loopCandidates(trail.slice(0, 3), e), loopCandidates(trail, e)])
  })

  test('保存した長い経路(walks)を 24件で歩くと、M10 は合計 23 件(09 のレポートと同じ)', () => {
    const file = new URL('./fixtures/walk-routes.json', import.meta.url)
    const walks = JSON.parse(fs.readFileSync(file, 'utf8'))
    let total = 0
    for (const { trail, expansions } of Object.values(walks)) {
      const e = new Map(Object.entries(expansions).map(([k, v]) => [k, v.slice(0, PRESETS.rev5.neighborLimit)]))
      total += loopCandidateSteps(trail, e).total
    }
    assert.equal(total, 23)
  })
})

/** '#rrggbb' の色相(度) */
function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}

describe('輪の色(EGG_COLORS)', () => {
  test('3〜9 のすべてに色がある', () => {
    for (let n = 3; n <= 9; n++) assert.match(EGG_COLORS[n], /^#[0-9a-f]{6}$/i, String(n))
  })

  test('長さの順に、色相が一方向に進む(黄 → 黄緑 → 緑 → … → 青に近い色)', () => {
    const hues = [3, 4, 5, 6, 7, 8, 9].map((n) => hueOf(eggColorFor(n)))
    for (let i = 1; i < hues.length; i++) assert.ok(hues[i] > hues[i - 1], `${i + 3}: ${hues[i]} > ${hues[i - 1]}`)
    // 3 は黄(45〜65°)、4 は黄緑、5 は緑、9 は青に近い(200〜240°)
    assert.ok(hues[0] >= 45 && hues[0] <= 65, `3: ${hues[0]}`)
    assert.ok(hues[1] > 65 && hues[1] < 100, `4: ${hues[1]}`)
    assert.ok(hues[2] >= 100 && hues[2] <= 140, `5: ${hues[2]}`)
    assert.ok(hues[6] >= 200 && hues[6] <= 240, `9: ${hues[6]}`)
  })

  test('9 より長い輪は 9 の色(折り返さない)', () => {
    assert.equal(eggColorFor(12), EGG_COLORS[9])
  })
})

describe('設定', () => {
  test('easterEgg: rev5・rev4 は on、current・rev2・rev3 は off', () => {
    assert.equal(PRESETS.rev5.easterEgg, true)
    assert.equal(PRESETS.rev4.easterEgg, true)
    for (const name of ['current', 'rev2', 'rev3']) assert.equal(PRESETS[name].easterEgg, false, name)
    assert.equal(PRESETS.current.easterEgg, EASTER_EGG)
  })

  test('URL で easterEgg を切り替えられる', () => {
    assert.equal(readUrlState('?preset=rev5&easterEgg=0').config.easterEgg, false)
    assert.equal(readUrlState('?preset=rev2&easterEgg=1').config.easterEgg, true)
  })

  test('カメラワークの境目は 6(10b)。合図の周期は今の中心の呼吸と見分けがつく', () => {
    assert.equal(EGG_CINEMATIC_MIN, 6)
    assert.ok(Math.abs(EGG_HINT_PERIOD_S - BREATH_PERIOD_S) >= 1, `${EGG_HINT_PERIOD_S} と ${BREATH_PERIOD_S}`)
    // 1秒間に3回を超えて点滅させない
    assert.ok(1 / EGG_HINT_PERIOD_S <= 3)
  })
})

describe('輪を閉じた後の戻る処理', () => {
  test('到着時の共通ワード強調は出ない(強調は進んだときだけ)', () => {
    // A → B → C → D から、D の子の B へ戻る(経路は B で切られる)
    assert.equal(startsArrival(['A', 'B', 'C', 'D'], ['A', 'B']), false)
    assert.equal(startsArrival(['A', 'B', 'C', 'D'], ['A']), false)
  })
})

import { eggPlan, loopEdgeGlow, orbitFitDistance } from '../src/utils/eggMotion.js'

describe('演出の時間割(eggPlan。10b)', () => {
  test('6件以上はカメラワーク、5件以下は光らせるだけ', () => {
    for (const n of [3, 4, 5]) assert.equal(eggPlan(n, false).cinematic, false, String(n))
    for (const n of [6, 7, 9, 12]) assert.equal(eggPlan(n, false).cinematic, true, String(n))
  })

  test('動きを減らす設定ではカメラワークを行わず、光も走らせない(3〜5件と同じ演出)', () => {
    for (const n of [3, 6, 9]) {
      const p = eggPlan(n, true)
      assert.equal(p.cinematic, false, String(n))
      assert.equal(p.reduced, true, String(n))
    }
  })

  test('全体の長さの目安: 3〜5件は2秒前後、6件以上は5秒前後', () => {
    const total = (p) => p.inMs + p.lapMs + p.outMs
    assert.ok(Math.abs(total(eggPlan(3, false)) - 2000) <= 300)
    assert.ok(Math.abs(total(eggPlan(6, false)) - 5000) <= 500)
    // カメラワークでは光が輪を何周か走る
    assert.ok(eggPlan(6, false).laps >= 2)
  })
})

/**
 * 線 j の明るさの山の時刻(ms)。0.9 を超えたら山、0.8 を下回ったら次の山を数えられる(ヒステリシス)。
 * 明るいまま残る線(3〜5件)は、山が1回だけと数える
 */
function peakTimes(plan, edges, j, stepMs = 5) {
  const out = []
  let armed = true
  for (let t = 0; t <= plan.lapMs; t += stepMs) {
    const v = loopEdgeGlow((t / plan.lapMs) * edges * plan.laps, j, edges, plan.laps)
    if (armed && v > 0.9) {
      out.push(t)
      armed = false
    } else if (!armed && v < 0.8) {
      armed = true
    }
  }
  return out
}

describe('光の明るさ(loopEdgeGlow)と点滅の安全', () => {
  test('3〜5件: どの線も明るくなるのは1回だけで、明るいまま残る', () => {
    const p = eggPlan(4, false)
    for (let j = 0; j < 4; j++) {
      assert.equal(loopEdgeGlow(0, j, 4, p.laps), 0)
      assert.equal(loopEdgeGlow(4 * p.laps, j, 4, p.laps), 1)
      assert.equal(peakTimes(p, 4, j).length, 1, `線 ${j}`)
    }
  })

  test('光は 戻り先 → … → 今の中心 → 戻り先 の順に進む(番号の小さい線から先に明るくなる)', () => {
    for (const n of [3, 6, 9]) {
      const p = eggPlan(n, false)
      const firstLit = []
      for (let j = 0; j < n; j++) {
        let t = 0
        while (loopEdgeGlow((t / p.lapMs) * n * p.laps, j, n, p.laps) < 0.5) t += 5
        firstLit.push(t)
      }
      for (let j = 1; j < n; j++) assert.ok(firstLit[j] > firstLit[j - 1], `${n}: 線 ${j}`)
    }
  })

  test('6〜9件: どの線も、1秒間に3回を超えて明るさの山が来ない', () => {
    for (const n of [6, 7, 8, 9]) {
      const p = eggPlan(n, false)
      for (let j = 0; j < n; j++) {
        const peaks = peakTimes(p, n, j)
        assert.ok(peaks.length >= 2, `${n}件 線 ${j}: 光が何周か走る`)
        for (let k = 0; k < peaks.length; k++) {
          const within = peaks.filter((t) => t >= peaks[k] && t < peaks[k] + 1000).length
          assert.ok(within <= 3, `${n}件 線 ${j}: 1秒に ${within} 回`)
        }
      }
    }
  })

  test('6〜9件: 山と山のあいだも暗くしすぎない(明暗の差を小さくする)', () => {
    const p = eggPlan(6, false)
    // 1周目を終えたあとは、どの線も底(EGG_CINE_BASE)より暗くならない
    for (let head = 6; head <= 6 * p.laps; head += 0.05) {
      for (let j = 0; j < 6; j++) assert.ok(loopEdgeGlow(head, j, 6, p.laps) >= 0.5, `head ${head} 線 ${j}`)
    }
  })
})

describe('カメラワークの距離(orbitFitDistance)', () => {
  test('輪を囲む球が、縦にも横にも画角の中に入る', () => {
    for (const aspect of [940 / 736, 844 / 346, 0.5]) {
      const d = orbitFitDistance(100, 45, aspect, 1)
      const halfV = (45 * Math.PI) / 360
      const halfH = Math.atan(Math.tan(halfV) * aspect)
      // 球の見かけの半角 asin(r/d) が、縦・横の半角以下
      assert.ok(Math.asin(100 / d) <= Math.min(halfV, halfH) + 1e-9, String(aspect))
    }
  })

  test('縦長(スマホの縦画面)では、横の画角に合わせて遠くなる', () => {
    assert.ok(orbitFitDistance(100, 45, 0.5, 1) > orbitFitDistance(100, 45, 1.5, 1))
  })
})
