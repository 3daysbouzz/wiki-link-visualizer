/**
 * src/config/urlState.js の URL 読み取りのテスト(node:test)。
 * 存在しない記事名や壊れた値が来ても例外にならず、後段でエラー表示できる形で返ることを確認する。
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { readUrlState } from '../src/config/urlState.js'
import { coerceConfig, PRESETS } from '../src/config/presets.ts'

beforeEach(() => {
  console.warn = () => {}
})

describe('readUrlState', () => {
  test('start / path を読む(空要素と前後の空白は落とす)', () => {
    const s = readUrlState('?start=%20初音ミク%20&path=MEIKO,,%20KAITO%20')
    assert.equal(s.start, '初音ミク')
    assert.deepEqual(s.path, ['MEIKO', 'KAITO'])
  })

  test('start が無ければ null、path は空配列', () => {
    const s = readUrlState('?preset=mesh')
    assert.equal(s.start, null)
    assert.deepEqual(s.path, [])
    assert.equal(s.presetName, 'mesh')
  })

  test('不明なプリセットは既定にフォールバックする', () => {
    const s = readUrlState('?preset=nope')
    assert.equal(s.presetName, 'current')
    assert.deepEqual(s.config, PRESETS.current)
  })

  test('壊れた数値・真偽値は例外にせずプリセットの値を使う', () => {
    const s = readUrlState('?nodeLimit=abc&seed=-5&trailEnabled=maybe&edgeMode=zzz')
    assert.equal(s.config.nodeLimit, PRESETS.current.nodeLimit)
    assert.equal(s.config.seed, 0) // 範囲外は下限に丸める
    assert.equal(s.config.trailEnabled, PRESETS.current.trailEnabled)
    assert.equal(s.config.edgeMode, PRESETS.current.edgeMode)
  })

  test('HTML のような文字列もそのまま文字列として返る(表示側で React がエスケープする)', () => {
    const s = readUrlState('?start=%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    assert.equal(s.start, '<script>alert(1)</script>')
  })

  test('debug=1 のときだけ debug が true', () => {
    assert.equal(readUrlState('?debug=1').debug, true)
    assert.equal(readUrlState('?debug=true').debug, false)
  })
})

describe('coerceConfig', () => {
  test('seed は整数に揃えて範囲内に収める', () => {
    // URL からの文字列は parseInt(小数点以下切り捨て)、パネルからの数値は四捨五入
    assert.equal(coerceConfig(PRESETS.current, { seed: '12.7' }).seed, 12)
    assert.equal(coerceConfig(PRESETS.current, { seed: 12.7 }).seed, 13)
    assert.equal(coerceConfig(PRESETS.current, { seed: 99999999999 }).seed, 2147483647)
  })
})
