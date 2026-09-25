/**
 * src/utils/depthFade.js のテスト(ラベルの深さフェード。SPEC 6.3)。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { depthFadeOf, keepsLabelCandidate, approach, smoothstep } from '../src/utils/depthFade.js'
import { LABEL_FADE_SHOW, LABEL_FADE_KEEP } from '../src/constants.js'

describe('depthFadeOf', () => {
  test('手前(start 以下)は 1、end 以上の奥は 0、その間は線形', () => {
    assert.equal(depthFadeOf(-50, 0, 110), 1)
    assert.equal(depthFadeOf(0, 0, 110), 1)
    assert.equal(depthFadeOf(55, 0, 110), 0.5)
    assert.equal(depthFadeOf(110, 0, 110), 0)
    assert.equal(depthFadeOf(500, 0, 110), 0)
  })

  test('start が負なら現在地より手前から薄くなる', () => {
    assert.equal(depthFadeOf(0, -20, 20), 0.5)
  })

  test('end ≤ start でも NaN にならず、境目で切り替わる', () => {
    assert.equal(depthFadeOf(10, 10, 10), 1)
    assert.equal(depthFadeOf(11, 10, 10), 0)
    assert.equal(depthFadeOf(15, 20, 10), 1)
    assert.equal(depthFadeOf(25, 20, 10), 0)
  })
})

describe('keepsLabelCandidate', () => {
  test('新たに出すには SHOW 以上、出し続けるには KEEP 以上(境目でチラつかない)', () => {
    const mid = (LABEL_FADE_SHOW + LABEL_FADE_KEEP) / 2
    assert.equal(keepsLabelCandidate(mid, false, LABEL_FADE_SHOW, LABEL_FADE_KEEP), false)
    assert.equal(keepsLabelCandidate(mid, true, LABEL_FADE_SHOW, LABEL_FADE_KEEP), true)
    assert.equal(keepsLabelCandidate(0, true, LABEL_FADE_SHOW, LABEL_FADE_KEEP), false)
    assert.equal(keepsLabelCandidate(1, false, LABEL_FADE_SHOW, LABEL_FADE_KEEP), true)
  })
})

describe('ラベルの出入り(approach / smoothstep)', () => {
  test('approach は目標を越えずに等速で近づく', () => {
    assert.equal(approach(0, 1, 0.3), 0.3)
    assert.equal(approach(0.9, 1, 0.3), 1)
    assert.equal(approach(1, 0, 0.25), 0.75)
    assert.equal(approach(0.1, 0, 0.25), 0)
    assert.equal(approach(0.5, 0.5, 0.1), 0.5)
  })

  test('smoothstep は端で 0 / 1、真ん中で 0.5、出始めと終わりがゆっくり', () => {
    assert.equal(smoothstep(0), 0)
    assert.equal(smoothstep(1), 1)
    assert.equal(smoothstep(0.5), 0.5)
    assert.ok(smoothstep(0.1) < 0.1) // 出始めは等速より遅い
    assert.ok(smoothstep(0.9) > 0.9) // 終わりも等速よりゆっくり目標に寄る
    assert.equal(smoothstep(-1), 0)
    assert.equal(smoothstep(2), 1)
  })
})
