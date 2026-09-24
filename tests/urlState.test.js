/**
 * src/config/urlState.js の URL 読み取りのテスト(node:test)。
 * 存在しない記事名や壊れた値が来ても例外にならず、後段でエラー表示できる形で返ることを確認する。
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { readUrlState } from '../src/config/urlState.js'
import {
  coerceConfig,
  PRESETS,
  RANGES,
  LAYOUT_KEYS,
  VISUAL_KEYS,
  RANKING_KEYS,
  DEFAULT_PRESET,
} from '../src/config/presets.ts'
import {
  REPULSION,
  REPULSION_RANGE,
  SPRING_K,
  SPRING_LENGTH,
  CENTER_K,
  DAMPING,
  ALPHA_DECAY,
  VISIBLE_LABELS,
  EDGE_PRIMARY_OPACITY,
  EDGE_WEAK_OPACITY,
  FOLLOW_LERP,
  W_MORELIKE,
  W_MUTUAL,
  W_LEAD,
} from '../src/constants.js'

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

  test('不明なプリセットは既定(rev2)にフォールバックする', () => {
    const s = readUrlState('?preset=nope')
    assert.equal(DEFAULT_PRESET, 'rev2')
    assert.equal(s.presetName, 'rev2')
    assert.deepEqual(s.config, PRESETS.rev2)
  })

  test('プリセット指定なしなら rev2、?preset=current で従来の設定', () => {
    assert.equal(readUrlState('').presetName, 'rev2')
    assert.deepEqual(readUrlState('?preset=current').config, PRESETS.current)
  })

  test('壊れた数値・真偽値は例外にせずプリセットの値を使う', () => {
    const s = readUrlState('?nodeLimit=abc&seed=-5&trailEnabled=maybe&edgeMode=zzz')
    assert.equal(s.config.nodeLimit, PRESETS[DEFAULT_PRESET].nodeLimit)
    assert.equal(s.config.seed, 0) // 範囲外は下限に丸める
    assert.equal(s.config.trailEnabled, PRESETS[DEFAULT_PRESET].trailEnabled)
    assert.equal(s.config.edgeMode, PRESETS[DEFAULT_PRESET].edgeMode)
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

// ---------------------------------------------------------------------------
// 力学・見た目パラメータ(VizConfig の数値項目)
// 小数を受けること・範囲外を丸めること・不正値で既定に戻ることを確かめる
// ---------------------------------------------------------------------------

describe('coerceConfig: 小数のパラメータ', () => {
  const base = PRESETS.current

  test('小数がそのまま通る(parseInt で 0 に潰れない)', () => {
    const c = coerceConfig(base, { springK: '0.025', centerK: 0.018, alphaDecay: '0.995' })
    assert.equal(c.springK, 0.025)
    assert.equal(c.centerK, 0.018)
    assert.equal(c.alphaDecay, 0.995)
  })

  test('URL から来た文字列も数値になる', () => {
    const c = coerceConfig(base, { repulsion: '8000', springLength: '90' })
    assert.equal(c.repulsion, 8000)
    assert.equal(c.springLength, 90)
  })

  test('範囲外は端に丸める', () => {
    const over = coerceConfig(base, {
      repulsion: 999999,
      springK: 5,
      damping: 1.5,
      alphaDecay: 2,
      edgePrimaryOpacity: 9,
      followLerp: 100,
    })
    assert.equal(over.repulsion, RANGES.repulsion.max)
    assert.equal(over.springK, RANGES.springK.max)
    assert.equal(over.damping, RANGES.damping.max)
    assert.equal(over.alphaDecay, RANGES.alphaDecay.max)
    assert.equal(over.edgePrimaryOpacity, 1)
    assert.equal(over.followLerp, 1)

    const under = coerceConfig(base, {
      repulsion: -500,
      springK: -1,
      damping: 0,
      edgeWeakOpacity: -0.5,
      followLerp: 0,
    })
    assert.equal(under.repulsion, RANGES.repulsion.min)
    assert.equal(under.springK, RANGES.springK.min)
    assert.equal(under.damping, RANGES.damping.min)
    assert.equal(under.edgeWeakOpacity, 0)
    assert.equal(under.followLerp, RANGES.followLerp.min)
  })

  test('数値として読めない値は base の値に戻る', () => {
    const c = coerceConfig(base, {
      repulsion: 'abc',
      springK: '',
      centerK: null,
      damping: undefined,
      alphaDecay: {},
      followLerp: 'NaN',
    })
    assert.equal(c.repulsion, base.repulsion)
    assert.equal(c.springK, base.springK)
    assert.equal(c.centerK, base.centerK)
    assert.equal(c.damping, base.damping)
    assert.equal(c.alphaDecay, base.alphaDecay)
    assert.equal(c.followLerp, base.followLerp)
  })

  test('Infinity / NaN も弾いて base に戻す(発散を防ぐ)', () => {
    const c = coerceConfig(base, {
      repulsion: Infinity,
      springK: -Infinity,
      damping: NaN,
    })
    assert.equal(c.repulsion, base.repulsion)
    assert.equal(c.springK, base.springK)
    assert.equal(c.damping, base.damping)
  })

  test('visibleLabels は整数に丸める(ラベル数に小数はない)', () => {
    assert.equal(coerceConfig(base, { visibleLabels: 12.6 }).visibleLabels, 13)
    assert.equal(coerceConfig(base, { visibleLabels: -5 }).visibleLabels, 0)
    assert.equal(coerceConfig(base, { visibleLabels: 9999 }).visibleLabels, RANGES.visibleLabels.max)
  })

  test('指定しなかった項目は base の値のまま', () => {
    const c = coerceConfig(base, { repulsion: 3000 })
    assert.equal(c.repulsion, 3000)
    for (const k of [...LAYOUT_KEYS, ...VISUAL_KEYS]) {
      if (k === 'repulsion') continue
      assert.equal(c[k], base[k], `${k} が変わってしまっている`)
    }
  })
})

describe('current プリセットと constants.js の一致', () => {
  test('current の力学・見た目の値は constants.js の既定値と同じ(回帰確認の土台)', () => {
    assert.equal(PRESETS.current.repulsion, REPULSION)
    assert.equal(PRESETS.current.repulsionRange, REPULSION_RANGE)
    assert.equal(PRESETS.current.springK, SPRING_K)
    assert.equal(PRESETS.current.springLength, SPRING_LENGTH)
    assert.equal(PRESETS.current.centerK, CENTER_K)
    assert.equal(PRESETS.current.damping, DAMPING)
    assert.equal(PRESETS.current.alphaDecay, ALPHA_DECAY)
    assert.equal(PRESETS.current.visibleLabels, VISIBLE_LABELS)
    assert.equal(PRESETS.current.edgePrimaryOpacity, EDGE_PRIMARY_OPACITY)
    assert.equal(PRESETS.current.edgeWeakOpacity, EDGE_WEAK_OPACITY)
    assert.equal(PRESETS.current.followLerp, FOLLOW_LERP)
    assert.equal(PRESETS.current.wMorelike, W_MORELIKE)
    assert.equal(PRESETS.current.wMutual, W_MUTUAL)
    assert.equal(PRESETS.current.wLead, W_LEAD)
  })

  test('current は加点なし(従来の順位)、rev2 と mesh は加点あり', () => {
    assert.equal(PRESETS.current.wMutual, 0)
    assert.equal(PRESETS.current.wLead, 0)
    for (const name of ['rev2', 'mesh']) {
      assert.equal(PRESETS[name].wMorelike, 1.0)
      assert.equal(PRESETS[name].wMutual, 0.8)
      assert.equal(PRESETS[name].wLead, 0.6)
    }
  })

  test('rev2 の重み以外の値は current と同じ(順位付けの違いだけを比べられる)', () => {
    for (const [key, v] of Object.entries(PRESETS.current)) {
      if (RANKING_KEYS.includes(key)) continue
      assert.equal(PRESETS.rev2[key], v, `${key} が current と違う`)
    }
  })

  test('各プリセットの値はすべて許容範囲の内側にある', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const [key, range] of Object.entries(RANGES)) {
        const v = preset[key]
        assert.ok(
          v >= range.min && v <= range.max,
          `${name}.${key}=${v} が範囲外 (${range.min}〜${range.max})`
        )
      }
    }
  })
})

describe('URL クエリでの力学パラメータの上書き', () => {
  test('?repulsion=&springK= が読める', () => {
    const s = readUrlState('?repulsion=8000&springK=0.03&visibleLabels=40')
    assert.equal(s.config.repulsion, 8000)
    assert.equal(s.config.springK, 0.03)
    assert.equal(s.config.visibleLabels, 40)
  })

  test('?wMutual=&wLead= で重みを上書きでき、範囲外は端に丸める', () => {
    const s = readUrlState('?wMutual=0.5&wLead=9&wMorelike=abc')
    assert.equal(s.config.wMutual, 0.5)
    assert.equal(s.config.wLead, RANGES.wLead.max)
    assert.equal(s.config.wMorelike, PRESETS[DEFAULT_PRESET].wMorelike)
  })

  test('壊れた値は既定プリセットの値に戻る', () => {
    const s = readUrlState('?repulsion=xyz&damping=99')
    assert.equal(s.config.repulsion, PRESETS[DEFAULT_PRESET].repulsion)
    assert.equal(s.config.damping, RANGES.damping.max)
  })
})
