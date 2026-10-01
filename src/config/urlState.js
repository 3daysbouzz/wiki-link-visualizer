/**
 * URL クエリと状態の対応。
 *
 *   ?preset=mesh&nodeLimit=64      … 表示パラメータ(プリセット名 + 個別上書き)
 *   ?repulsion=4000&springK=0.02   … 力学パラメータも同じしくみで上書きできる(12.2)
 *   ?wMutual=0&wLead=0             … 関連スコアの重みも同じ(3.3)
 *   ?moreBatch=4&moreMax=20        … 追加表示の件数も同じ(6.8)
 *   ?labelDepthFade=0&fadeEnd=160  … ラベルの深さフェードも同じ(6.3)
 *   ?start=流体力学&path=マグネシウム,ウラン … 探索経路(開始記事と、そこから辿った記事)
 *   ?debug=1                       … デバッグパネルと window.__viz を出す(開発サーバーだけ。本番ビルドでは無視する)
 *   ?debug=1&maxConcurrent=5       … 同時リクエスト数の上限を変える(計測用。debug のときだけ効く。
 *                                    本番ビルドでは 3 より上げられない。effectiveMaxConcurrent)
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
  RANKING_KEYS,
} from './presets.ts'
import { MAX_CONCURRENT_REQUESTS } from '../constants.js'

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
  ...RANKING_KEYS,
]

// maxConcurrent(計測用)として受け付ける範囲
const MAX_CONCURRENT_RANGE = [1, 16]

/**
 * URL で指定された同時リクエスト数の上限(readUrlState の maxConcurrent)を、実際に使う値にする。
 * 開発サーバーでは指定どおり(計測用に上げられる)。本番ビルドでは MAX_CONCURRENT_REQUESTS を超えさせない
 * (?debug=1 は誰でも付けられるので、共有 URL で開いた人のブラウザが推奨の同時3本を超えて送らないように)。
 * 下げるのは本番でも可。指定が無ければ null(既定のまま)
 *
 * @param {number|null} requested
 * @param {boolean} isDev import.meta.env.DEV
 */
export function effectiveMaxConcurrent(requested, isDev) {
  if (!requested) return null
  return isDev ? requested : Math.min(requested, MAX_CONCURRENT_REQUESTS)
}

/**
 * URL から { presetName, config, overrides, start, path, debug, maxConcurrent } を読む。
 *
 * debug は開発サーバー(allowDebug = import.meta.env.DEV)のときだけ読む。
 * デバッグモードの measure() や leva の表示件数の変更は、Wikipedia への問い合わせを大量に送れるので、
 * 公開版では ?debug=1 を付けても何も起きないようにする(import.meta.env は Node のテストに無いので引数で受け取る)
 *
 * @param {string} [search]
 * @param {boolean} [allowDebug] import.meta.env.DEV
 */
export function readUrlState(search = window.location.search, allowDebug = false) {
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

  const debug = allowDebug && params.get('debug') === '1'

  // 同時リクエスト数の上書きは計測用なので、debug のときだけ読む(公開版の URL では効かない)
  let maxConcurrent = null
  if (debug && params.has('maxConcurrent')) {
    const n = Number(params.get('maxConcurrent'))
    const [lo, hi] = MAX_CONCURRENT_RANGE
    if (Number.isInteger(n) && n >= lo && n <= hi) maxConcurrent = n
    else console.warn('[config] maxConcurrent は %d〜%d の整数で指定してください', lo, hi)
  }

  return {
    presetName,
    config,
    overrides: Object.keys(overrides),
    start,
    path,
    debug,
    maxConcurrent,
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
