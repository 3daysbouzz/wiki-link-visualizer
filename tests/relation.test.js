/**
 * 関連の強さを配置と動きで見せる計算のテスト(SPEC 6.9)。
 *   src/utils/relation.js   … スコアの正規化・線の自然長・共通ワード・パケットの経路
 *   src/utils/buildGraph.js … 線に種類と関連の強さを持たせる
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeScore,
  computeEdgeSpringLength,
  sharedTitles,
  packetRoutesFor,
  trailTier,
  trailTierLength,
  arrivalHighlightSet,
  startsArrival,
} from '../src/utils/relation.js'
import { buildGraph } from '../src/utils/buildGraph.js'
import { readUrlState } from '../src/config/urlState.js'
import { PRESETS, RANGES } from '../src/config/presets.ts'
import {
  SPRING_LENGTH,
  DISTANCE_BY_SCORE,
  CHILD_SPRING_MIN,
  CHILD_SPRING_MAX,
  TRAIL_SPRING_BASE,
  TRAIL_MUTUAL_BONUS,
  TRAIL_SHARED_BONUS,
  TRAIL_SHARED_CAP,
  SHARED_PACKETS,
  SHARED_PACKET_PX,
  PACKET_PX,
  TRAIL_TIER_FEW_MAX,
  TRAIL_TIER_MID_MAX,
  TRAIL_TIERED,
  TRAIL_LEN_NONE,
  TRAIL_LEN_FEW,
  TRAIL_LEN_MID,
  TRAIL_LEN_MANY,
  ARRIVAL_SHARED,
  ARRIVAL_SHARED_MS,
  ARRIVAL_SHARED_FADE_MS,
  ARRIVAL_SHARED_MAX,
} from '../src/constants.js'

const ON = PRESETS.rev3
const OFF = PRESETS.rev2

/** 記事名の配列から expansions の値の形({ title, mutual, relScore })を作る */
const links = (titles, extra = {}) =>
  titles.map((title) => ({ title, mutual: 0, relScore: 0, ...(extra[title] || {}) }))

describe('normalizeScore', () => {
  test('重みを変えても常に 0〜1 に収まる', () => {
    const weightsList = [
      { wMorelike: 1, wMutual: 0, wLead: 0 },
      { wMorelike: 1, wMutual: 0.8, wLead: 0.6 },
      { wMorelike: 2, wMutual: 2, wLead: 2 },
      { wMorelike: 0.05, wMutual: 0, wLead: 1.5 },
    ]
    for (const w of weightsList) {
      // 素材の組み合わせ(m ∈ [0,1]、mutual・lead ∈ {0,1})をひととおり試す
      for (const m of [0, 0.25, 0.5, 1]) {
        for (const mutual of [0, 1]) {
          for (const lead of [0, 1]) {
            const score = w.wMorelike * m + w.wMutual * mutual + w.wLead * lead
            const r = normalizeScore(score, w)
            assert.ok(r >= 0 && r <= 1, `${JSON.stringify(w)} m=${m} → ${r}`)
          }
        }
      }
      // すべての要素がそろえば 1
      assert.equal(normalizeScore(w.wMorelike + w.wMutual + w.wLead, w), 1)
    }
  })

  test('重みの合計が 0 なら 0(0 で割らない)', () => {
    assert.equal(normalizeScore(0, { wMorelike: 0, wMutual: 0, wLead: 0 }), 0)
  })

  test('重みの半分のスコアなら 0.5', () => {
    assert.equal(normalizeScore(1.2, { wMorelike: 1, wMutual: 0.8, wLead: 0.6 }), 0.5)
  })
})

describe('computeEdgeSpringLength', () => {
  test('distanceByScore が off なら child も trail も springLength', () => {
    const config = { ...OFF, springLength: 70 }
    for (const relScore of [0, 0.5, 1]) {
      assert.equal(computeEdgeSpringLength({ type: 'child', relScore }, config), 70)
    }
    assert.equal(
      computeEdgeSpringLength({ type: 'trail', mutual: 1, sharedCount: 20 }, config),
      70
    )
  })

  test('relScore=1 で childSpringMin、0 で childSpringMax、その間は線形', () => {
    const c = ON
    assert.equal(computeEdgeSpringLength({ type: 'child', relScore: 1 }, c), c.childSpringMin)
    assert.equal(computeEdgeSpringLength({ type: 'child', relScore: 0 }, c), c.childSpringMax)
    assert.equal(
      computeEdgeSpringLength({ type: 'child', relScore: 0.5 }, c),
      (c.childSpringMin + c.childSpringMax) / 2
    )
  })

  test('trail は相互リンク・共通ワードの数に応じて短くなる。共通ワードは上限で頭打ち', () => {
    const c = ON
    const len = (mutual, sharedCount) =>
      computeEdgeSpringLength({ type: 'trail', mutual, sharedCount }, c)
    assert.equal(len(0, 0), c.trailSpringBase)
    assert.equal(len(1, 0), c.trailSpringBase - c.trailMutualBonus)
    assert.equal(len(0, 3), c.trailSpringBase - 3 * c.trailSharedBonus)
    assert.ok(len(1, 3) < len(0, 3))
    assert.ok(len(0, 5) < len(0, 3))
    assert.equal(len(0, c.trailSharedCap + 50), len(0, c.trailSharedCap))
  })

  test('trail は childSpringMin を下回らない', () => {
    const c = { ...ON, trailMutualBonus: 300, trailSharedBonus: 50, trailSharedCap: 150 }
    assert.equal(
      computeEdgeSpringLength({ type: 'trail', mutual: 1, sharedCount: 100 }, c),
      c.childSpringMin
    )
  })

  test('trail の基準は子の最大より外側(「中心同士は大きめ」)', () => {
    assert.ok(ON.trailSpringBase > ON.childSpringMax)
  })
})

describe('sharedTitles', () => {
  test('積集合の件数と一致する(順不同・重複なし)', () => {
    const a = links(['X', 'Y', 'Z', 'W'])
    const b = links(['Z', 'Q', 'X', 'X', 'R'])
    assert.deepEqual(sharedTitles(a, b), ['Z', 'X']) // 並びは b の順
    assert.equal(sharedTitles(b, a).length, 2)
  })

  test('中心自身は数えない', () => {
    const a = links(['B', 'X'])
    const b = links(['A', 'X'])
    assert.deepEqual(sharedTitles(links(['A', 'B', 'X']), links(['A', 'B', 'X']), ['A', 'B']), [
      'X',
    ])
    assert.deepEqual(sharedTitles(a, b, ['A', 'B']), ['X'])
  })

  test('どちらかが未展開(undefined)なら空', () => {
    assert.deepEqual(sharedTitles(undefined, links(['X'])), [])
    assert.deepEqual(sharedTitles(links(['X']), undefined), [])
  })
})

describe('buildGraph: 線の種類と関連の強さ', () => {
  const views = new Map()
  // A → B → C と歩いた。B は A の子(相互リンク)。C は B の子ではない(A の子から進んだ想定)
  const expansions = new Map([
    ['A', links(['B', 'S1', 'S2', 'C', 'P'], { B: { mutual: 1, relScore: 0.9 } })],
    ['B', links(['S1', 'S2', 'Q'], { S1: { mutual: 1, relScore: 0.7 }, Q: { relScore: 0.2 } })],
    ['C', links(['S2', 'R'])],
  ])
  const edge = (graph, s, t) =>
    graph.links.find((l) => (l.source === s && l.target === t) || (l.source === t && l.target === s))

  test('trail edge に mutual と sharedCount、child edge に relScore と mutual が付く', () => {
    const g = buildGraph(['A', 'B'], expansions, views, ON)
    const ab = edge(g, 'A', 'B')
    assert.equal(ab.type, 'trail') // A の子の B とも重なるが、trail が残る
    assert.equal(ab.mutual, 1)
    assert.equal(ab.sharedCount, 2) // S1・S2

    const bs1 = edge(g, 'B', 'S1')
    assert.equal(bs1.type, 'child')
    assert.equal(bs1.mutual, 1)
    assert.equal(bs1.relScore, 0.7)
    assert.equal(edge(g, 'B', 'Q').relScore, 0.2)
  })

  test('後の中心が前の中心の子として記憶されていなければ trail の mutual は 0', () => {
    const g = buildGraph(['A', 'B', 'C'], expansions, views, ON)
    const bc = edge(g, 'B', 'C')
    assert.equal(bc.type, 'trail')
    assert.equal(bc.mutual, 0)
    assert.equal(bc.sharedCount, 1) // S2
  })

  test('shown が1件、または trailEnabled=false なら trail edge は作らない', () => {
    const one = buildGraph(['A'], expansions, views, ON)
    assert.equal(one.links.filter((l) => l.type === 'trail').length, 0)

    const noTrail = buildGraph(['A', 'B'], expansions, views, { ...ON, trailEnabled: false })
    assert.equal(noTrail.links.filter((l) => l.type === 'trail').length, 0)
    assert.ok(noTrail.links.every((l) => l.source === 'B'))
  })
})

describe('packetRoutesFor', () => {
  const expansions = new Map([
    ['A', links(['B', 'S1', 'S2', 'P'])],
    ['B', links(['Q', 'S2', 'S1', 'R'])],
  ])

  test('共通ワードがあれば 前の中心 → 共通ワード → 今の中心(今の中心の並び順・最大 count 件)', () => {
    assert.deepEqual(packetRoutesFor(['A', 'B'], expansions, ON, 12), [
      ['A', 'S2', 'B'],
      ['A', 'S1', 'B'],
    ])
    assert.deepEqual(packetRoutesFor(['A', 'B'], expansions, ON, 1), [['A', 'S2', 'B']])
  })

  test('sharedPackets が off なら従来どおり 今の中心 → 子の上位', () => {
    assert.deepEqual(packetRoutesFor(['A', 'B'], expansions, OFF, 2), [
      ['B', 'Q'],
      ['B', 'S2'],
    ])
  })

  test('最初の記事・共通ワードなし・trailEnabled=false なら従来どおり', () => {
    assert.deepEqual(packetRoutesFor(['A'], expansions, ON, 2), [
      ['A', 'B'],
      ['A', 'S1'],
    ])
    const disjoint = new Map([
      ['A', links(['B', 'X'])],
      ['B', links(['Y'])],
    ])
    assert.deepEqual(packetRoutesFor(['A', 'B'], disjoint, ON, 2), [['B', 'Y']])
    assert.deepEqual(
      packetRoutesFor(['A', 'B'], expansions, { ...ON, trailEnabled: false }, 1),
      [['B', 'Q']]
    )
  })

  test('軌跡が空なら経路なし', () => {
    assert.deepEqual(packetRoutesFor([], expansions, ON, 12), [])
  })
})

describe('プリセット: 関連の強さ', () => {
  test('current・rev2・mesh は off、rev3 は on', () => {
    for (const name of ['current', 'rev2', 'mesh']) {
      assert.equal(PRESETS[name].distanceByScore, false, name)
      assert.equal(PRESETS[name].sharedPackets, false, name)
    }
    assert.equal(PRESETS.rev3.distanceByScore, true)
    assert.equal(PRESETS.rev3.sharedPackets, true)
  })

  test('rev3 は on/off 以外 rev2 と同じ(違いだけを比べられる)', () => {
    const ONLY = ['distanceByScore', 'sharedPackets']
    for (const [key, v] of Object.entries(PRESETS.rev2)) {
      if (ONLY.includes(key)) continue
      assert.equal(PRESETS.rev3[key], v, `${key} が rev2 と違う`)
    }
  })

  test('current の値は constants.js の既定値と同じ', () => {
    const c = PRESETS.current
    assert.equal(c.distanceByScore, DISTANCE_BY_SCORE)
    assert.equal(c.childSpringMin, CHILD_SPRING_MIN)
    assert.equal(c.childSpringMax, CHILD_SPRING_MAX)
    assert.equal(c.trailSpringBase, TRAIL_SPRING_BASE)
    assert.equal(c.trailMutualBonus, TRAIL_MUTUAL_BONUS)
    assert.equal(c.trailSharedBonus, TRAIL_SHARED_BONUS)
    assert.equal(c.trailSharedCap, TRAIL_SHARED_CAP)
    assert.equal(c.sharedPackets, SHARED_PACKETS)
    assert.equal(c.sharedPacketPx, SHARED_PACKET_PX)
  })

  test('子の距離の範囲は springLength の 0.6〜1.4倍程度、中心同士の基準は子の最大の 1.3倍程度', () => {
    assert.ok(Math.abs(CHILD_SPRING_MIN / SPRING_LENGTH - 0.6) < 0.05)
    assert.ok(Math.abs(CHILD_SPRING_MAX / SPRING_LENGTH - 1.4) < 0.05)
    assert.ok(Math.abs(TRAIL_SPRING_BASE / CHILD_SPRING_MAX - 1.3) < 0.05)
  })

  test('新しい数値項目はすべて RANGES に範囲がある', () => {
    for (const key of [
      'childSpringMin',
      'childSpringMax',
      'trailSpringBase',
      'trailMutualBonus',
      'trailSharedBonus',
      'trailSharedCap',
      'sharedPacketPx',
    ]) {
      assert.ok(RANGES[key], key)
    }
  })
})

test('共通ワードのパケットは通常のパケットより少し大きい', () => {
  assert.ok(SHARED_PACKET_PX > PACKET_PX)
})

describe('URL クエリ: 関連の強さ', () => {
  test('?preset=rev3 で on、個別の項目も上書きできる(範囲外は端に丸める)', () => {
    const on = readUrlState('?preset=rev3')
    assert.equal(on.presetName, 'rev3')
    assert.equal(on.config.distanceByScore, true)

    const r = readUrlState('?preset=rev3&distanceByScore=0&childSpringMin=40&sharedPacketPx=50')
    assert.equal(r.config.distanceByScore, false)
    assert.equal(r.config.childSpringMin, 40)
    assert.equal(r.config.sharedPacketPx, RANGES.sharedPacketPx.max)
  })
})

describe('相互リンクの脈動(タスク07で外した)', () => {
  const REMOVED = ['mutualEmphasis', 'mutualWidthMultiplier', 'mutualPulseAmplitude', 'mutualPulseSpeed']

  test('どのプリセット・RANGES にも項目が無い', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const key of REMOVED) assert.equal(key in preset, false, `${name}.${key}`)
    }
    for (const key of REMOVED) assert.equal(key in RANGES, false, key)
  })

  test('古い URL に付いていてもエラーにならず、無視される', () => {
    const r = readUrlState('?preset=rev3&mutualEmphasis=1&mutualWidthMultiplier=3&mutualPulseAmplitude=0.5&mutualPulseSpeed=4')
    assert.equal(r.presetName, 'rev3')
    assert.deepEqual(r.overrides, [])
    for (const key of REMOVED) assert.equal(key in r.config, false, key)
  })
})

describe('中心同士の距離の段階(trailTier。タスク07)', () => {
  test('0 → none、1・3 → few、4・7 → mid、8・15 → many(境目の両側)', () => {
    assert.equal(trailTier(0), 'none')
    assert.equal(trailTier(1), 'few')
    assert.equal(trailTier(3), 'few')
    assert.equal(trailTier(4), 'mid')
    assert.equal(trailTier(7), 'mid')
    assert.equal(trailTier(8), 'many')
    assert.equal(trailTier(15), 'many')
    assert.equal(trailTier(undefined), 'none')
    assert.equal(TRAIL_TIER_FEW_MAX, 3)
    assert.equal(TRAIL_TIER_MID_MAX, 7)
  })

  test('rev4 では段階ごとの長さになり、childSpringMin の下限を掛けない', () => {
    const c = { ...PRESETS.rev4, childSpringMin: 100 }
    const len = (n) => computeEdgeSpringLength({ type: 'trail', sharedCount: n, mutual: 1 }, c)
    assert.equal(len(0), c.trailLenNone)
    assert.equal(len(2), c.trailLenFew)
    assert.equal(len(5), c.trailLenMid)
    assert.equal(len(12), c.trailLenMany)
    assert.equal(trailTierLength('many', c), c.trailLenMany)
    // 相互リンクは使わない
    assert.equal(
      computeEdgeSpringLength({ type: 'trail', sharedCount: 5, mutual: 0 }, c),
      computeEdgeSpringLength({ type: 'trail', sharedCount: 5, mutual: 1 }, c)
    )
  })

  test('trailTiered=false なら 05 の計算と同じ長さ', () => {
    const c = { ...PRESETS.rev3, trailTiered: false }
    const edge = { type: 'trail', sharedCount: 5, mutual: 1 }
    assert.equal(
      computeEdgeSpringLength(edge, c),
      Math.max(c.childSpringMin, c.trailSpringBase - c.trailMutualBonus - c.trailSharedBonus * 5)
    )
  })

  test('rev4 の子の線はすべて springLength(子の距離は使わない)', () => {
    const c = PRESETS.rev4
    for (const relScore of [0, 0.5, 1]) {
      assert.equal(computeEdgeSpringLength({ type: 'child', relScore }, c), SPRING_LENGTH)
    }
  })
})

describe('到着時の共通ワード強調の対象(arrivalHighlightSet。タスク07)', () => {
  const exp = new Map([
    ['A', links(['x', 'y', 'B', 'z', 'w'])],
    ['B', links(['w', 'A', 'q', 'y', 'x', 'z'])],
  ])

  test('前の中心・今の中心・共通ワードの上位 max 件と、その間の線が入る。並びは今の中心の順', () => {
    const set = arrivalHighlightSet(['A', 'B'], exp, 3)
    assert.equal(set.prev, 'A')
    assert.equal(set.current, 'B')
    // B の順(w, y, x, z)のうち上位3件。中心自身(A)は数えない
    assert.deepEqual(set.shared, ['w', 'y', 'x'])
    assert.deepEqual([...set.nodes].sort(), ['A', 'B', 'w', 'x', 'y'])
    assert.deepEqual(set.labelOrder, ['B', 'A', 'w', 'y', 'x'])
    assert.deepEqual(set.links, [
      ['A', 'B'],
      ['A', 'w'], ['w', 'B'],
      ['A', 'y'], ['y', 'B'],
      ['A', 'x'], ['x', 'B'],
    ])
  })

  test('共通ワードが 0 件・軌跡が2件未満・trailEnabled=false のときは null', () => {
    const none = new Map([['A', links(['x'])], ['B', links(['y'])]])
    assert.equal(arrivalHighlightSet(['A', 'B'], none, 8), null)
    assert.equal(arrivalHighlightSet(['B'], exp, 8), null)
    assert.equal(arrivalHighlightSet(['A', 'B'], exp, 8, { trailEnabled: false }), null)
    assert.equal(arrivalHighlightSet(['A', 'B'], exp, 0), null)
  })

  test('3件以上の軌跡では末尾の2件を使う', () => {
    const e = new Map([...exp, ['C', links(['x', 'B', 'q'])]])
    const set = arrivalHighlightSet(['A', 'B', 'C'], e, 8)
    assert.equal(set.prev, 'B')
    assert.deepEqual(set.shared, ['x', 'q'])
  })
})

describe('到着時の強調を始めるか(startsArrival)', () => {
  test('末尾に新しい記事を1件足して進んだときだけ true', () => {
    assert.equal(startsArrival(['A'], ['A', 'B']), true)
    assert.equal(startsArrival(['A', 'B'], ['A', 'B', 'C']), true)
  })

  test('戻る・検索・URL からの復元・追加表示・並び替えでは false', () => {
    assert.equal(startsArrival(['A', 'B', 'C'], ['A', 'B']), false) // 戻る
    assert.equal(startsArrival(['A', 'B'], ['X']), false) // 検索・リセット
    assert.equal(startsArrival([], ['A', 'B']), false) // URL からの復元(空から一度に組む)
    assert.equal(startsArrival(['A', 'B'], ['A', 'B']), false) // 追加表示(軌跡は変わらない)
    assert.equal(startsArrival(['A', 'B', 'C'], ['A', 'C', 'B']), false) // リダイレクトで並び替わった
    assert.equal(startsArrival(['A', 'B'], ['A', 'B', 'A']), false) // 経路上の記事
  })
})

describe('プリセット rev4(タスク07)', () => {
  test('rev3 から sharedPackets・arrivalShared・子の距離・trailTiered だけが違う', () => {
    const DIFF = ['sharedPackets', 'arrivalShared', 'childSpringMin', 'childSpringMax', 'trailTiered']
    for (const [key, v] of Object.entries(PRESETS.rev3)) {
      if (DIFF.includes(key)) continue
      assert.equal(PRESETS.rev4[key], v, `${key} が rev3 と違う`)
    }
    assert.equal(PRESETS.rev4.sharedPackets, false)
    assert.equal(PRESETS.rev4.arrivalShared, true)
    assert.equal(PRESETS.rev4.trailTiered, true)
    assert.equal(PRESETS.rev4.distanceByScore, true)
  })

  test('current・rev2・mesh・rev3 は到着時の強調と段階が off', () => {
    for (const name of ['current', 'rev2', 'mesh', 'rev3']) {
      assert.equal(PRESETS[name].arrivalShared, false, name)
      assert.equal(PRESETS[name].trailTiered, false, name)
    }
  })

  test('順位付けの重みは rev2・rev3 と同じ(06 の道具で同じ展開結果のまま比べられる)', () => {
    for (const key of ['wMorelike', 'wMutual', 'wLead', 'neighborLimit', 'seed']) {
      assert.equal(PRESETS.rev4[key], PRESETS.rev2[key], key)
    }
  })

  test('current の新しい項目は constants.js の既定値と同じで、数値項目は RANGES に範囲がある', () => {
    const c = PRESETS.current
    assert.equal(c.trailTiered, TRAIL_TIERED)
    assert.equal(c.trailLenNone, TRAIL_LEN_NONE)
    assert.equal(c.trailLenFew, TRAIL_LEN_FEW)
    assert.equal(c.trailLenMid, TRAIL_LEN_MID)
    assert.equal(c.trailLenMany, TRAIL_LEN_MANY)
    assert.equal(c.arrivalShared, ARRIVAL_SHARED)
    assert.equal(c.arrivalSharedMs, ARRIVAL_SHARED_MS)
    assert.equal(c.arrivalSharedFadeMs, ARRIVAL_SHARED_FADE_MS)
    assert.equal(c.arrivalSharedMax, ARRIVAL_SHARED_MAX)
    for (const key of ['trailLenNone', 'trailLenFew', 'trailLenMid', 'trailLenMany', 'arrivalSharedMs', 'arrivalSharedFadeMs', 'arrivalSharedMax']) {
      assert.ok(RANGES[key], key)
      assert.ok(c[key] >= RANGES[key].min && c[key] <= RANGES[key].max, key)
    }
  })

  test('URL で rev4 と新しい項目を指定できる', () => {
    const r = readUrlState('?preset=rev4&arrivalSharedMs=1500&trailLenFew=140')
    assert.equal(r.presetName, 'rev4')
    assert.equal(r.config.arrivalShared, true)
    assert.equal(r.config.arrivalSharedMs, 1500)
    assert.equal(r.config.trailLenFew, 140)
  })
})
