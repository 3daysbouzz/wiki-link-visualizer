/**
 * URL クエリと状態の対応。
 *
 *   ?preset=mesh&nodeLimit=64      … 表示パラメータ(プリセット名 + 個別上書き)
 *   ?repulsion=4000&springK=0.02   … 力学パラメータも同じしくみで上書きできる(12.2)
 *   ?start=流体力学&path=マグネシウム,ウラン … 探索経路(開始記事と、そこから辿った記事)
 *   ?debug=1                       … デバッグパネルを出す
 *
 * 2つのタブで別プリセットを開いて同じ経路を並べて比較する、が狙い。
 * 経路は歩くたびに replaceState で書き換える(履歴は汚さない)。
 */

import {
  PRESETS,
  DEFAULT_PRESET,
  coerceConfig,
  LAYOUT_KEYS,
  VISUAL_KEYS,
} from './presets.ts'

// URL に出す VizConfig の項目。ここに無い項目は URL から読まないし書かない
const CONFIG_KEYS = [
  'nodeLimit',
  'neighborLimit',
  'edgeMode',
  'colorMode',
  'trailEnabled',
  'seed',
  ...LAYOUT_KEYS,
  ...VISUAL_KEYS,
]

/** URL から { presetName, config, overrides, start, path, debug } を読む */
export function readUrlState(search = window.location.search) {
  const params = new URLSearchParams(search)

  let presetName = params.get('preset') || DEFAULT_PRESET
  if (!PRESETS[presetName]) {
    console.warn('[config] 不明なプリセット "%s"。%s を使います', presetName, DEFAULT_PRESET)
    presetName = DEFAULT_PRESET
  }

  const overrides = {}
  for (const key of CONFIG_KEYS) {
    if (params.has(key)) overrides[key] = params.get(key)
  }
  const config = coerceConfig(PRESETS[presetName], overrides)

  const start = (params.get('start') || '').trim() || null
  const path = (params.get('path') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    presetName,
    config,
    overrides: Object.keys(overrides),
    start,
    path,
    debug: params.get('debug') === '1',
  }
}

/**
 * 経路を URL に書く。設定系のクエリ(preset / 上書き / debug)は触らない。
 * trail が空なら start/path を消す
 */
export function writeTrailToUrl(trail) {
  const params = new URLSearchParams(window.location.search)
  if (trail.length === 0) {
    params.delete('start')
    params.delete('path')
  } else {
    params.set('start', trail[0])
    if (trail.length > 1) params.set('path', trail.slice(1).join(','))
    else params.delete('path')
  }
  const query = params.toString()
  const url = `${window.location.pathname}${query ? '?' + query : ''}${window.location.hash}`
  window.history.replaceState(null, '', url)
}

/**
 * 設定を URL に書く。プリセットの値と同じ項目は書かない(URL を短く保つ)
 */
export function writeConfigToUrl(presetName, config) {
  const params = new URLSearchParams(window.location.search)
  params.set('preset', presetName)
  const base = PRESETS[presetName] || PRESETS[DEFAULT_PRESET]
  for (const key of CONFIG_KEYS) {
    if (config[key] !== base[key]) params.set(key, String(config[key]))
    else params.delete(key)
  }
  const query = params.toString()
  const url = `${window.location.pathname}${query ? '?' + query : ''}${window.location.hash}`
  window.history.replaceState(null, '', url)
}
