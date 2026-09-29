/**
 * src/api/requestQueue.js(全通信共通の同時実行数の行列)のテスト。
 * 通信は使わず、手で終わらせる task で順番と同時実行数を確かめる。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { createRequestQueue, isCancelled } from '../src/api/requestQueue.js'

/** 手で終わらせる task を作る。started に開始順の名前を積む */
function tasks() {
  const started = []
  const finishers = new Map()
  let active = 0
  let maxActive = 0
  const make = (name) => () => {
    started.push(name)
    active += 1
    maxActive = Math.max(maxActive, active)
    return new Promise((resolve) => {
      finishers.set(name, () => {
        active -= 1
        resolve(name)
      })
    })
  }
  const finish = async (name) => {
    finishers.get(name)()
    // then → finally → pump まで進める
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return { started, make, finish, get maxActive() { return maxActive } }
}

describe('createRequestQueue', () => {
  test('同時実行数は上限を超えない', async () => {
    const q = createRequestQueue(3)
    const t = tasks()
    const names = Array.from({ length: 20 }, (_, i) => `t${i}`)
    const all = Promise.all(names.map((n) => q.run(t.make(n))))
    assert.equal(t.started.length, 3)
    for (const n of names) {
      // 開始済みのものだけ終わらせられる
      while (!t.started.includes(n)) await Promise.resolve()
      await t.finish(n)
    }
    assert.deepEqual(await all, names)
    assert.equal(t.maxActive, 3)
    assert.equal(q.active, 0)
    assert.equal(q.waiting, 0)
  })

  test('high → mid → low の順。同じ優先度の中は入れた順', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const runs = [q.run(t.make('枠'))]
    runs.push(q.run(t.make('low1'), { priority: 'low' }))
    runs.push(q.run(t.make('mid1'), { priority: 'mid' }))
    runs.push(q.run(t.make('high1'), { priority: 'high' }))
    runs.push(q.run(t.make('low2'), { priority: 'low' }))
    runs.push(q.run(t.make('mid2'), { priority: 'mid' }))
    runs.push(q.run(t.make('high2')))
    for (const n of ['枠', 'high1', 'high2', 'mid1', 'mid2', 'low1', 'low2']) {
      assert.equal(t.started.at(-1), n)
      await t.finish(n)
    }
    await Promise.all(runs)
  })

  test('待機中に取り消すと CancelledError で失敗し、task は呼ばれない', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const first = q.run(t.make('枠'))
    const controller = new AbortController()
    const cancelled = q.run(t.make('取り消し'), { signal: controller.signal })
    const after = q.run(t.make('後'))
    controller.abort()
    await assert.rejects(cancelled, (e) => isCancelled(e))
    assert.equal(q.waiting, 1)
    await t.finish('枠')
    await t.finish('後')
    await Promise.all([first, after])
    assert.deepEqual(t.started, ['枠', '後'])
  })

  test('取り消し済みの signal なら行列に入れずに失敗する', async () => {
    const q = createRequestQueue(1)
    const controller = new AbortController()
    controller.abort()
    let called = false
    await assert.rejects(
      q.run(() => { called = true }, { signal: controller.signal }),
      (e) => isCancelled(e)
    )
    assert.equal(called, false)
  })

  test('開始後の取り消しは何もしない(結果はそのまま届く)', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const controller = new AbortController()
    const running = q.run(t.make('実行中'), { signal: controller.signal })
    controller.abort()
    await t.finish('実行中')
    assert.equal(await running, '実行中')
  })

  test('setPriority で待機中の優先度を上げられる(上げた段の最後に並ぶ)', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const handle = {}
    const runs = [
      q.run(t.make('枠')),
      q.run(t.make('mid1'), { priority: 'mid' }),
      q.run(t.make('昇格'), { priority: 'low', handle }),
    ]
    runs.push(q.run(t.make('mid2'), { priority: 'mid' }))
    handle.setPriority('mid')
    for (const n of ['枠', 'mid1', 'mid2', '昇格']) {
      assert.equal(t.started.at(-1), n)
      await t.finish(n)
    }
    await Promise.all(runs)
  })

  test('task が例外を投げても枠は空き、次が始まる', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const bad = q.run(() => { throw new Error('同期の失敗') })
    const bad2 = q.run(async () => { throw new Error('非同期の失敗') })
    const ok = q.run(t.make('次'))
    await assert.rejects(bad, /同期の失敗/)
    await assert.rejects(bad2, /非同期の失敗/)
    while (!t.started.includes('次')) await Promise.resolve()
    await t.finish('次')
    assert.equal(await ok, '次')
  })

  test('setLimit で上限を上げると、待っている分がすぐ始まる', async () => {
    const q = createRequestQueue(1)
    const t = tasks()
    const runs = ['a', 'b', 'c'].map((n) => q.run(t.make(n)))
    assert.equal(t.started.length, 1)
    q.setLimit(3)
    assert.equal(t.started.length, 3)
    for (const n of ['a', 'b', 'c']) await t.finish(n)
    await Promise.all(runs)
  })
})
