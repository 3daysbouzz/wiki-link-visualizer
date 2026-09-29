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

describe('輪の色(EGG_COLORS。4段階。タスク11)', () => {
  test('3・4・5 の色は 10 のときと同じ', () => {
    assert.equal(eggColorFor(3), '#ffe23d')
    assert.equal(eggColorFor(4), '#b4f03c')
    assert.equal(eggColorFor(5), '#46e664')
  })

  test('6・7・9・12 はすべて同じ色(10 の 9件の色 = 青に近い色)', () => {
    for (const n of [6, 7, 9, 12]) assert.equal(eggColorFor(n), '#5a8cff', String(n))
  })

  test('段階は4つ(3・4・5・6以上)', () => {
    assert.deepEqual(Object.keys(EGG_COLORS).map(Number), [3, 4, 5, 6])
    assert.equal(new Set([3, 4, 5, 6, 7, 8, 9, 12].map(eggColorFor)).size, 4)
  })

  test('長さの順に、色相が一方向に進む(黄 → 黄緑 → 緑 → 青に近い色)。戻らない', () => {
    const hues = [3, 4, 5, 6, 7, 9, 12].map((n) => hueOf(eggColorFor(n)))
    for (let i = 1; i < hues.length; i++) assert.ok(hues[i] >= hues[i - 1], `${i}: ${hues[i]} >= ${hues[i - 1]}`)
    for (let i = 1; i < 4; i++) assert.ok(hues[i] > hues[i - 1], `段階 ${i + 3}`)
    // 3 は黄(45〜65°)、4 は黄緑、5 は緑、6以上は青に近い(200〜240°)
    assert.ok(hues[0] >= 45 && hues[0] <= 65, `3: ${hues[0]}`)
    assert.ok(hues[1] > 65 && hues[1] < 100, `4: ${hues[1]}`)
    assert.ok(hues[2] >= 100 && hues[2] <= 140, `5: ${hues[2]}`)
    assert.ok(hues[3] >= 200 && hues[3] <= 240, `6: ${hues[3]}`)
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

import {
  eggTimeline,
  eggFrame,
  eggEdgeBrightness,
  loopEdgeGlow,
  rotateY,
  polygonVertices,
  snapshotLayout,
  restoreLayout,
  polygonFitDistance,
} from '../src/utils/eggMotion.js'
import { buildSim, settleSim } from '../src/utils/forceLayout.js'
import crypto from 'node:crypto'
import {
  EGG_CINE_ELEV_DEG,
  EGG_POLY_PAD_PX,
  EGG_POLY_MAX_PX,
  EGG_POLY_PAD_TOP_PX,
  EGG_POLY_PAD_BOTTOM_PX,
  NODE_PX_CURRENT_MAX,
  LABEL_GAP_PX,
  MEASURE_VIEWPORTS,
  LABEL_PX,
  EGG_RIPPLE_PX,
  EGG_RIPPLE_MS,
  EGG_RIPPLE_MAX_PER_S,
  EGG_RIPPLE_MAX_LIVE,
  CAMERA_FOV,
} from '../src/constants.js'

describe('演出の時間割(eggTimeline。タスク11)', () => {
  const ALL = [3, 4, 5, 6, 7, 9, 12]

  test('6件以上はカメラワーク、5件以下は光らせるだけ。境目 EGG_CINEMATIC_MIN は 6 のまま', () => {
    assert.equal(EGG_CINEMATIC_MIN, 6)
    for (const n of [3, 4, 5]) assert.equal(eggTimeline(n, false).cinematic, false, String(n))
    for (const n of [6, 7, 9, 12]) assert.equal(eggTimeline(n, false).cinematic, true, String(n))
  })

  test('3〜5件の合計は 2.5秒以内、6件以上の合計は 8秒以内', () => {
    for (const n of [3, 4, 5]) assert.ok(eggTimeline(n, false).total <= 2500, String(n))
    for (const n of [6, 7, 9, 12]) assert.ok(eggTimeline(n, false).total <= 8000, String(n))
  })

  test('各段階は重ならずに、隙間なく並ぶ(0 から始まり total で終わる)', () => {
    for (const reduced of [false, true]) {
      for (const n of ALL) {
        const tl = eggTimeline(n, reduced)
        assert.equal(tl.phases[0].start, 0)
        for (let i = 0; i < tl.phases.length; i++) {
          assert.ok(tl.phases[i].end > tl.phases[i].start, `${n}: ${tl.phases[i].name}`)
          if (i > 0) assert.equal(tl.phases[i].start, tl.phases[i - 1].end, `${n}: ${tl.phases[i].name}`)
        }
        assert.equal(tl.phases[tl.phases.length - 1].end, tl.total)
      }
    }
  })

  test('段階の並びは指示書 4.3 のとおり(驚き → リズム/並べ替え・溜め・一周 → 締め → 余韻)', () => {
    assert.deepEqual(eggTimeline(3, false).phases.map((p) => p.name), ['surprise', 'rhythm', 'finale', 'afterglow'])
    assert.deepEqual(eggTimeline(6, false).phases.map((p) => p.name), ['surprise', 'arrange', 'charge', 'orbit', 'finale', 'afterglow'])
  })

  test('6・7・9 は同じ演出(時間割が長さの数字以外すべて同じ。波紋の数は記事の数で変わる)', () => {
    const shape = (n) => {
      const { length, ripples, nodeLit, ...rest } = eggTimeline(n, false)
      return rest
    }
    assert.deepEqual(shape(7), shape(6))
    assert.deepEqual(shape(9), shape(6))
  })

  test('驚き: 始まりの瞬間に一瞬で色が付く(補間しない)', () => {
    for (const n of [3, 6]) assert.equal(eggFrame(eggTimeline(n, false), 0).mix, 1, String(n))
  })

  test('締めは光が一周して戻り先に戻った瞬間(光の区間の終わり)', () => {
    for (const n of [3, 5, 6, 9]) {
      const tl = eggTimeline(n, false)
      assert.equal(tl.finale, tl.light.end, String(n))
      assert.equal(eggFrame(tl, tl.finale).head, n * tl.light.laps, String(n))
    }
  })

  test('余韻の終わりで、色・薄さ・並べ替えはすべて元に戻っている', () => {
    for (const n of [3, 6]) {
      const f = eggFrame(eggTimeline(n, false), eggTimeline(n, false).total)
      assert.equal(f.mix, 0)
      assert.equal(f.dim, 0)
      assert.equal(f.place, 0)
      assert.equal(f.flash > 0.001, false)
    }
  })

  test('6件以上: 並べ替え → 溜め(戻り先から順に灯る)→ 一周 → 余韻で元に戻す', () => {
    const tl = eggTimeline(6, false)
    const at = (name) => tl.phases.find((p) => p.name === name)
    assert.equal(eggFrame(tl, at('arrange').start).place, 0)
    assert.equal(eggFrame(tl, at('arrange').end).place, 1)
    assert.equal(eggFrame(tl, at('orbit').start).orbit, 0)
    assert.equal(eggFrame(tl, at('orbit').end).orbit, 1)
    assert.equal(eggFrame(tl, at('finale').end).place, 1) // 余韻の最初は少し保つ
    for (let k = 1; k < 6; k++) assert.ok(tl.nodeLit[k] > tl.nodeLit[k - 1], `記事 ${k}`)
    assert.ok(tl.nodeLit[0] >= at('charge').start && tl.nodeLit[5] < at('charge').end)
  })

  test('小さな波紋: 1秒あたりに新しく出る数・同時に出ている数が上限以内。直径は 120px 以下', () => {
    assert.ok(EGG_RIPPLE_PX * 2 <= 120)
    for (const n of ALL) {
      const r = eggTimeline(n, false).ripples
      for (const x of r) {
        assert.ok(r.filter((y) => y.t > x.t - 1000 && y.t <= x.t).length <= EGG_RIPPLE_MAX_PER_S, `${n}: 1秒あたり`)
        assert.ok(r.filter((y) => y.t > x.t - EGG_RIPPLE_MS && y.t <= x.t).length <= EGG_RIPPLE_MAX_LIVE, `${n}: 同時`)
      }
      // 1つの記事で、1秒間に3回を超えて波紋が出ない
      for (const x of r) assert.ok(r.filter((y) => y.node === x.node && y.t > x.t - 1000 && y.t <= x.t).length <= 3, `${n}: 記事 ${x.node}`)
    }
  })

  test('3〜5件: 光が記事に届くたびに小さな波紋(戻り先に戻った瞬間は大きな波紋)', () => {
    for (const n of [3, 4, 5]) {
      const tl = eggTimeline(n, false)
      assert.deepEqual(tl.ripples.map((r) => r.node), Array.from({ length: n - 1 }, (_, i) => i + 1))
      assert.deepEqual(tl.bigRipple, { t: tl.finale, node: 0 })
    }
  })

  test('6件以上: 波紋は溜めと1周目だけ(2周目以降は出さない)', () => {
    const tl = eggTimeline(6, false)
    const lapEnd = tl.light.start + (tl.light.end - tl.light.start) / tl.light.laps
    for (const r of tl.ripples) assert.ok(r.t <= lapEnd + 1e-9, `${r.t}`)
    assert.ok(tl.ripples.some((r) => r.t > tl.light.start))
  })

  test('大きな波紋・輪が揃って光る・走査線は、それぞれ演出の中で一度だけ(締めの瞬間)', () => {
    for (const n of [3, 6, 9]) {
      const tl = eggTimeline(n, false)
      assert.equal(typeof tl.bigRipple.t, 'number')
      assert.equal(tl.bigRipple.t, tl.finale)
      assert.equal(tl.flash, tl.finale)
      assert.equal(tl.scan, n >= 6 ? tl.finale : null)
      // 締めの光は一度だけ山が来る(締めの瞬間に 1 になり、下がり続ける)
      let prev = 0
      let rises = 0
      for (let t = 0; t <= tl.total; t += 5) {
        const f = eggFrame(tl, t).flash
        if (f > prev + 1e-9) rises++
        prev = f
      }
      assert.equal(rises, 1, `${n}: 締めの光`)
    }
  })

  test('文字の打ち込みは6件以上の締めから。3〜5件は左上の文字を出さない', () => {
    assert.deepEqual(eggTimeline(6, false).typing, { start: eggTimeline(6, false).finale, charMs: 30 })
    assert.equal(eggTimeline(3, false).typing, null)
    assert.equal(eggTimeline(3, false).banner, null)
  })

  test('背景の円の波は3〜5件の締めだけ(6件以上はグリッドを薄くしているので使わない)', () => {
    assert.equal(eggTimeline(4, false).gridWave, eggTimeline(4, false).finale)
    assert.equal(eggTimeline(6, false).gridWave, null)
  })

  test('動きを減らす設定: 波紋・走査線・文字の打ち込み・締めの光・背景の波の予定が入らず、カメラワークと並べ替えもしない', () => {
    for (const n of ALL) {
      const tl = eggTimeline(n, true)
      assert.equal(tl.cinematic, false)
      assert.deepEqual(tl.ripples, [])
      assert.equal(tl.bigRipple, null)
      assert.equal(tl.flash, null)
      assert.equal(tl.scan, null)
      assert.equal(tl.typing, null)
      assert.equal(tl.gridWave, null)
      assert.equal(tl.arrange, null)
      assert.equal(tl.light, null)
      // 左上の文字は6件以上だけ、始まりから一度に出す
      assert.equal(tl.banner, n >= 6 ? 0 : null)
    }
  })
})

/**
 * 線 j の明るさの山の時刻(ms)。0.9 を超えたら山、0.8 を下回ったら次の山を数えられる(ヒステリシス)。
 * 明るいまま残る線は、山が1回だけと数える
 */
function peakTimes(tl, j, stepMs = 5) {
  const out = []
  let armed = true
  for (let t = 0; t <= tl.total; t += stepMs) {
    const v = eggEdgeBrightness(eggFrame(tl, t), j, tl.length)
    if (armed && v > 0.9) {
      out.push(t)
      armed = false
    } else if (!armed && v < 0.8) {
      armed = true
    }
  }
  return out
}

describe('光の明るさ(loopEdgeGlow・eggEdgeBrightness)と点滅の安全', () => {
  test('3〜5件: 光が通った線は明るいまま残り、締めで揃って一度だけ最大になる', () => {
    for (const n of [3, 4, 5]) {
      const tl = eggTimeline(n, false)
      for (let j = 0; j < n; j++) {
        assert.equal(eggEdgeBrightness(eggFrame(tl, tl.light.start), j, n), 0, `線 ${j} 始まり`)
        assert.equal(eggEdgeBrightness(eggFrame(tl, tl.finale), j, n), 1, `線 ${j} 締め`)
        assert.equal(peakTimes(tl, j).length, 1, `線 ${j}`)
      }
    }
  })

  test('光は 戻り先 → … → 今の中心 → 戻り先 の順に進む(番号の小さい線から先に明るくなる)', () => {
    for (const n of [3, 6, 9]) {
      const tl = eggTimeline(n, false)
      const firstLit = []
      for (let j = 0; j < n; j++) {
        let t = 0
        while (eggEdgeBrightness(eggFrame(tl, t), j, n) < 0.5) t += 5
        firstLit.push(t)
      }
      for (let j = 1; j < n; j++) assert.ok(firstLit[j] > firstLit[j - 1], `${n}: 線 ${j}`)
    }
  })

  test('どの線も、1秒間に3回を超えて明るさの山が来ない(6〜9件は光が何周か走る)', () => {
    for (const n of [3, 5, 6, 7, 8, 9]) {
      const tl = eggTimeline(n, false)
      for (let j = 0; j < n; j++) {
        const peaks = peakTimes(tl, j)
        if (n >= 6) assert.ok(peaks.length >= 2, `${n}件 線 ${j}: 光が何周か走る`)
        for (let k = 0; k < peaks.length; k++) {
          const within = peaks.filter((t) => t >= peaks[k] && t < peaks[k] + 1000).length
          assert.ok(within <= 3, `${n}件 線 ${j}: 1秒に ${within} 回`)
        }
      }
    }
  })

  test('6〜9件: 1周目を終えたあとは、山と山のあいだも暗くしすぎない(明暗の差を小さくする)', () => {
    const edges = 6
    for (let head = 6; head <= 6 * 3; head += 0.05) {
      for (let j = 0; j < edges; j++) assert.ok(loopEdgeGlow(head, j, edges, 3) >= 0.5, `head ${head} 線 ${j}`)
    }
  })
})

describe('カメラワークの前に輪を並べ替える(10c)', () => {
  test('rotateY は three の applyAxisAngle((0,1,0), angle) と同じ向き', async () => {
    const THREE = await import('three')
    for (const angle of [0.3, 1.2, -2]) {
      const v = new THREE.Vector3(1.5, 0.4, -0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
      const r = rotateY({ x: 1.5, y: 0.4, z: -0.7 }, angle)
      assert.ok(Math.abs(v.x - r.x) < 1e-12 && Math.abs(v.y - r.y) < 1e-12 && Math.abs(v.z - r.z) < 1e-12)
    }
  })

  test('頂点は重心を中心とする水平な面の上の正多角形。今の中心(最後)がカメラの側に来る', () => {
    const center = { x: 10, y: -5, z: 3 }
    for (const n of [6, 7, 9]) {
      const vs = polygonVertices(n, center, { x: 0, z: 2 }, 50)
      assert.equal(vs.length, n)
      const side = Math.hypot(vs[1].x - vs[0].x, vs[1].z - vs[0].z)
      for (let j = 0; j < n; j++) {
        const v = vs[j]
        const w = vs[(j + 1) % n]
        assert.equal(v.y, center.y)
        assert.ok(Math.abs(Math.hypot(v.x - center.x, v.z - center.z) - 50) < 1e-9)
        assert.ok(Math.abs(Math.hypot(w.x - v.x, w.z - v.z) - side) < 1e-9, `${n}: 辺 ${j}`)
      }
      const last = vs[n - 1]
      assert.ok(Math.abs(last.x - center.x) < 1e-9 && Math.abs(last.z - center.z - 50) < 1e-9)
    }
  })

  test('光が輪を走る向き(頂点 j → j+1)と、カメラが回る向き(角度が増える)が揃っている', () => {
    const center = { x: 0, y: 0, z: 0 }
    const vs = polygonVertices(6, center, { x: 1, z: 0 }, 1)
    // 頂点 j+1 は頂点 j を +2π/6 だけ rotateY したもの = カメラの向き(rotateY(view, +angle))と同じ回り方
    for (let j = 0; j < 6; j++) {
      const r = rotateY(vs[j], (2 * Math.PI) / 6)
      const w = vs[(j + 1) % 6]
      assert.ok(Math.abs(r.x - w.x) < 1e-9 && Math.abs(r.z - w.z) < 1e-9, `頂点 ${j}`)
    }
  })

  test('スマホの横画面・pc でも、一周のどの角度でも、多角形と横に出るラベルが画面に収まる(three で投影して確かめる)', async () => {
    const THREE = await import('three')
    // ラベルの幅は、打ち切られた最長の記事名(16文字 + …)を JetBrains Mono 12px(1文字 約 0.6em)で見積もる
    const labelW = 17 * LABEL_PX * 0.6
    const labelH = 16
    const belowPx = NODE_PX_CURRENT_MAX + LABEL_GAP_PX + labelH
    const opts = { pad: EGG_POLY_PAD_PX, padTop: EGG_POLY_PAD_TOP_PX, padBottom: EGG_POLY_PAD_BOTTOM_PX, maxPx: EGG_POLY_MAX_PX, belowPx }
    const elev = (EGG_CINE_ELEV_DEG * Math.PI) / 180
    for (const [key, vp] of Object.entries(MEASURE_VIEWPORTS)) {
      for (const n of [6, 9]) {
        const radius = 100
        const D = polygonFitDistance(radius, EGG_CINE_ELEV_DEG, CAMERA_FOV, vp.width, vp.height, labelW, labelH, opts)
        const center = { x: 0, y: 0, z: 0 }
        const view = { x: 0, y: Math.sin(elev) * D, z: Math.cos(elev) * D }
        const vs = polygonVertices(n, center, { x: 0, z: 1 }, radius)
        const camera = new THREE.PerspectiveCamera(CAMERA_FOV, vp.width / vp.height, 1, 100000)
        let widest = 0
        let tallest = 0
        for (let k = 0; k < 36; k++) {
          const v = rotateY(view, (k / 36) * Math.PI * 2)
          camera.position.set(v.x, v.y, v.z)
          camera.lookAt(0, 0, 0)
          camera.updateMatrixWorld(true)
          for (const p of vs) {
            const s = new THREE.Vector3(p.x, p.y, p.z).project(camera)
            const sx = (s.x * 0.5 + 0.5) * vp.width
            const sy = (-s.y * 0.5 + 0.5) * vp.height
            widest = Math.max(widest, Math.abs(sx - vp.width / 2))
            tallest = Math.max(tallest, Math.abs(sy - vp.height / 2))
            assert.ok(Math.abs(sx - vp.width / 2) + 16 + labelW <= vp.width / 2 - EGG_POLY_PAD_PX + 0.5, `${key} ${n}: 横 ${sx}`)
            // 上: 左上のステータス行の下 / 下: 真下に出るラベルがパンくずとズームボタンより上
            assert.ok(sy - labelH / 2 >= EGG_POLY_PAD_TOP_PX - 0.5, `${key} ${n}: 上 ${sy}`)
            assert.ok(sy + belowPx <= vp.height - EGG_POLY_PAD_BOTTOM_PX + 0.5, `${key} ${n}: 下 ${sy}`)
          }
        }
        // 必要以上に引いていない: 横か縦のどちらかが収まる限界まで広がっている。
        // そうでなければ、大きな画面で広がりすぎないための上限(重心の深さで半径 EGG_POLY_MAX_PX)で止めている
        const focal = vp.height / 2 / Math.tan((CAMERA_FOV * Math.PI) / 360)
        const atLimit =
          widest + 16 + labelW >= vp.width / 2 - EGG_POLY_PAD_PX - 3 ||
          tallest + belowPx >= vp.height / 2 - EGG_POLY_PAD_BOTTOM_PX - 3 ||
          Math.abs((radius * focal) / D - EGG_POLY_MAX_PX) < 0.5
        assert.ok(atLimit, `${key} ${n}: 横 ${widest}px・縦 ${tallest}px`)
      }
    }
  })

  test('並べ替えて戻した後の配置は、並べ替えをしなかった場合と一致する(その後も力学を進めて比べる)', () => {
    const walks = JSON.parse(fs.readFileSync(new URL('./fixtures/walk-routes.json', import.meta.url), 'utf8'))
    const hash = (sim) =>
      crypto.createHash('sha256').update(JSON.stringify([sim.alpha, [...sim.nodes].map(([id, n]) => [id, n.x, n.y, n.z, n.vx, n.vy, n.vz])])).digest('hex')
    for (const key of ['walk-top-コーヒー', 'walk-draw-富士山']) {
      const { trail, expansions } = walks[key]
      const e = new Map(Object.entries(expansions).map(([k, v]) => [k, v.slice(0, PRESETS.rev5.neighborLimit)]))
      const make = () => {
        const sim = buildSim(buildGraph(trail, e, new Map(), PRESETS.rev5), PRESETS.rev5)
        settleSim(sim, 40) // 落ち着く途中(速度が残っている)で演出が始まった場合
        return sim
      }
      const plain = make()
      const arranged = make()
      assert.equal(hash(plain), hash(arranged))

      // 演出: 記録 → 輪の記事を多角形へ動かす(力学は止める)→ 記録した位置へ戻す
      const snap = snapshotLayout(arranged.nodes, arranged.alpha)
      const members = trail.map((id) => arranged.nodes.get(id))
      const vs = polygonVertices(members.length, { x: 0, y: 0, z: 0 }, { x: 0, z: 1 }, 300)
      members.forEach((n, i) => Object.assign(n, vs[i], { vx: 9, vy: 9, vz: 9 }))
      arranged.alpha = 0.5
      arranged.alpha = restoreLayout(arranged.nodes, snap)
      assert.equal(hash(arranged), hash(plain), `${key}: 戻した直後`)

      // 戻る処理の後(経路を戻り先で切って組み直し、力学を進める)も一致する
      const back = trail.slice(0, 2)
      const s1 = buildSim(buildGraph(back, e, new Map(), PRESETS.rev5), PRESETS.rev5, plain)
      const s2 = buildSim(buildGraph(back, e, new Map(), PRESETS.rev5), PRESETS.rev5, arranged)
      settleSim(s1, 3000)
      settleSim(s2, 3000)
      assert.equal(hash(s2), hash(s1), `${key}: 戻る処理の後`)
    }
  })
})
