/**
 * src/utils/depthFade.js のテスト(ラベルの深さフェード。SPEC 6.3)。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { depthFadeOf, keepsLabelCandidate } from '../src/utils/depthFade.js'
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
