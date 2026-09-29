/**
 * 長い経路の歩き方と、輪の起きやすさの数え方(タスク11)のテスト。
 *   src/debug/walks.js … nextWalkStep・walkRoute・loopOpportunities
 *   tests/fixtures/walk-routes.json(09。中心5件)・long-walk-routes.json(11。中心8件まで)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { nextWalkStep, walkRoute, loopOpportunities } from '../src/debug/walks.js'

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const kids = (...titles) => titles.map((title, i) => ({ title, relScore: 1 - i / 100 }))

describe('歩き方(nextWalkStep)', () => {
  test('top: まだ通っていない子のうち、関連スコアがいちばん高い記事', () => {
    const c = [{ title: 'A', relScore: 0.9 }, { title: 'B', relScore: 0.95 }, { title: 'C', relScore: 0.5 }]
    assert.equal(nextWalkStep(c, new Set(), 'top'), 'B')
    assert.equal(nextWalkStep(c, new Set(['B']), 'top'), 'A')
  })

  test('draw: 抽選の枠(11位以降)から、いちばん順位が高い記事。確定枠(1〜10位)からは選ばない', () => {
    const c = kids(...Array.from({ length: 24 }, (_, i) => `x${i + 1}`))
    assert.equal(nextWalkStep(c, new Set(), 'draw'), 'x11')
    assert.equal(nextWalkStep(c, new Set(['x11']), 'draw'), 'x12')
    // neighborLimit(24)より後ろは選ばない
    const all = new Set(c.slice(10, 24).map((l) => l.title))
    assert.equal(nextWalkStep([...c, { title: 'x25', relScore: 1 }], all, 'draw'), null)
  })
})

describe('保存した長い経路', () => {
  test('09 の経路(中心5件)を、保存した展開結果から同じ歩き方で作り直せる', () => {
    for (const [key, { mode, trail, expansions }] of Object.entries(read('walk-routes.json'))) {
      assert.deepEqual(walkRoute(trail[0], new Map(Object.entries(expansions)), mode, 5), trail, key)
    }
  })

  test('11 の長い経路が読め、2種類の歩き方で、同じデータから毎回同じ経路になる', () => {
    const file = new URL('./fixtures/long-walk-routes.json', import.meta.url)
    const walks = JSON.parse(fs.readFileSync(file, 'utf8'))
    const keys = Object.keys(walks)
    assert.ok(keys.length >= 8, `${keys.length} 経路`)
    assert.deepEqual([...new Set(keys.map((k) => walks[k].mode))].sort(), ['draw', 'top'])
    for (const [key, { mode, trail, expansions }] of Object.entries(walks)) {
      const e = new Map(Object.entries(expansions))
      const again = walkRoute(trail[0], e, mode, trail.length)
      assert.deepEqual(again, trail, key)
      assert.deepEqual(walkRoute(trail[0], e, mode, trail.length), again, `${key}: 2回目`)
    }
  })
})

describe('輪の起きやすさの数え方(loopOpportunities)', () => {
  test('3件目以降の各時点で、閉じられる輪と長さ(1つ前の中心は長さ2なので数えない)', () => {
    const trail = ['A', 'B', 'C', 'D']
    const e = new Map([
      ['C', kids('A', 'B')],
      ['D', kids('A', 'B', 'C')],
    ])
    assert.deepEqual(loopOpportunities(trail, e), [
      { at: 'C', candidates: [{ title: 'A', length: 3 }] },
      { at: 'D', candidates: [{ title: 'A', length: 4 }, { title: 'B', length: 3 }] },
    ])
  })

  test('子は neighborLimit 件目までに切り詰めて数える', () => {
    const many = kids(...Array.from({ length: 30 }, (_, i) => `x${i}`), 'A')
    const e = new Map([['C', many]])
    assert.equal(loopOpportunities(['A', 'B', 'C'], e, 24)[0].candidates.length, 0)
    assert.equal(loopOpportunities(['A', 'B', 'C'], e, 40)[0].candidates.length, 1)
  })
})
