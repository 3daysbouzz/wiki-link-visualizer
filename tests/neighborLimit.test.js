/**
 * 表示件数の見直し(タスク09)のテスト。
 *   src/api/wikipedia.js  … pickLinks: 件数を減らした抽選は、多い件数の抽選の先頭と同じになる
 *   src/debug/measure.js  … 順位付けに効く値ごとのまとめ・保存した展開結果の切り詰め・M10(輪を閉じられる候補)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { pickLinks } from '../src/api/wikipedia.js'
import { seededRandom } from '../src/utils/prng.js'
import { assertSameRanking } from '../src/utils/screenMetrics.js'
import { groupByRanking, truncatedExpansions, loopCandidates, rankingKeyOf } from '../src/debug/measure.js'
import { PRESETS } from '../src/config/presets.ts'
import { GUARANTEED_TOP } from '../src/constants.js'

describe('件数を減らした抽選は、多い件数の抽選の先頭と同じ(pickLinks)', () => {
  const pool = Array.from({ length: 150 }, (_, i) => ({ title: `t${i}` }))
  for (const seed of [1, 2, 7]) {
    test(`種 ${seed}: n24・n30 は n40 の先頭`, () => {
      const pick = (limit) => pickLinks(pool, limit, seededRandom(seed, 'A')).map((c) => c.title)
      const n40 = pick(40)
      assert.deepEqual(pick(30), n40.slice(0, 30))
      assert.deepEqual(pick(24), n40.slice(0, 24))
      // 確定枠は上位 GUARANTEED_TOP 件
      assert.deepEqual(n40.slice(0, GUARANTEED_TOP), pool.slice(0, GUARANTEED_TOP).map((c) => c.title))
    })
  }

  test('同じ種なら毎回同じ(展開し直しても同じ顔ぶれ)', () => {
    const a = pickLinks(pool, 24, seededRandom(1, 'B')).map((c) => c.title)
    const b = pickLinks(pool, 24, seededRandom(1, 'B')).map((c) => c.title)
    assert.deepEqual(a, b)
  })
})

describe('順位付けに効く値が違う変種(allowDifferentRanking)', () => {
  const named = [
    { name: 'rev4', config: PRESETS.rev4 },
    { name: 'n30', config: { ...PRESETS.rev4, neighborLimit: 30 } },
    { name: 'n24', config: { ...PRESETS.rev4, neighborLimit: 24 } },
    { name: 'rev3', config: PRESETS.rev3 },
  ]

  test('指定しないときは今までどおりエラーになる', () => {
    assert.throws(() => assertSameRanking(named), /neighborLimit/)
  })

  test('順位付けに効く値ごとにまとめる(並びは最初に現れた順)', () => {
    const groups = groupByRanking(named)
    assert.deepEqual(groups.map((g) => g.map((n) => n.name)), [['rev4', 'rev3'], ['n30'], ['n24']])
    assert.notEqual(rankingKeyOf(named[0].config), rankingKeyOf(named[1].config))
  })

  test('保存した展開結果は、件数に合わせて先頭から切り詰める', () => {
    const given = { trail: ['A'], expansions: { A: Array.from({ length: 40 }, (_, i) => ({ title: `x${i}` })) } }
    const out = truncatedExpansions(given, named[2].config, named[0].config, true)
    assert.equal(out.get('A').length, 24)
    assert.deepEqual(out.get('A'), given.expansions.A.slice(0, 24))
    // 許可していなければそのまま
    assert.equal(truncatedExpansions(given, named[2].config, named[0].config, false).get('A').length, 40)
  })

  test('保存した展開結果では、重みや種が違う変種と、保存した件数より多い変種はエラー', () => {
    const given = { trail: ['A'], expansions: { A: Array.from({ length: 40 }, (_, i) => ({ title: `x${i}` })) } }
    assert.throws(() => truncatedExpansions(given, { ...PRESETS.rev4, wLead: 0 }, PRESETS.rev4, true), /wLead/)
    assert.throws(() => truncatedExpansions(given, { ...PRESETS.rev4, neighborLimit: 60 }, PRESETS.rev4, true), /足りません/)
  })
})

describe('M10 輪を閉じられる候補(loopCandidates)', () => {
  test('3件目以降の各時点で、今の中心の子のうち2つ以上前に通った記事を数える', () => {
    const trail = ['A', 'B', 'C', 'D']
    const expansions = new Map([
      ['C', [{ title: 'A' }, { title: 'B' }, { title: 'x' }]], // B は1つ前なので数えない
      ['D', [{ title: 'A' }, { title: 'B' }, { title: 'C' }]], // C は1つ前なので数えない
    ])
    const m = loopCandidates(trail, expansions)
    assert.deepEqual(m.perStep.map((p) => [p.at, p.count]), [['C', 1], ['D', 2]])
    assert.equal(m.total, 3)
    assert.equal(m.max, 2)
  })

  test('中心が2件以下なら候補は無い', () => {
    assert.deepEqual(loopCandidates(['A', 'B'], new Map()), { perStep: [], total: 0, max: 0 })
  })
})

test('保存した長い経路(walks)の子は、n24 でも経路の次の記事を含む(どの変種でも同じ経路になる)', () => {
  const file = new URL('./fixtures/walk-routes.json', import.meta.url)
  if (!fs.existsSync(file)) return
  const walks = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [key, { mode, trail, expansions }] of Object.entries(walks)) {
    if (mode !== 'draw') continue
    for (let k = 0; k + 1 < trail.length; k++) {
      const n24 = expansions[trail[k]].slice(0, 24).map((l) => l.title)
      assert.ok(n24.includes(trail[k + 1]), `${key}: ${trail[k]} → ${trail[k + 1]}`)
    }
  }
})
