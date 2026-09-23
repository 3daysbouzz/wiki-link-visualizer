import React from 'react'
import { Leva, useControls, folder } from 'leva'
import { PRESETS, RANGES } from '../config/presets.ts'

/**
 * 表示パラメータ(VizConfig)をその場で切り替えるデバッグパネル。
 * ?debug=1 のときだけ出す。
 *
 * leva の onChange は初期化時(initial)にも fromPanel=true で呼ばれるので、
 * 「初期化でなく、人がパネルを触った」ときだけ上位へ通知する。
 * そうしないと読み込んだだけで URL が書き換わり、設定の反映が循環する。
 *
 * 項目は layout(力学)と visual(見た目)のフォルダに分けている。
 * layout を動かすと配置の計算が再開し、visual は描画だけが変わる(SPEC 12.2)。
 * スライダーの端は presets.ts の RANGES と同じものを使う
 * (パネルと URL で通る値の範囲がずれないようにするため)。
 */
export default function DebugPanel({ presetName, config, onChange, onPreset }) {
  const fromPanelOnly = (fn) => (value, _path, ctx) => {
    if (ctx && ctx.fromPanel && !ctx.initial) fn(value)
  }

  /** RANGES の min/max/step をそのまま leva のスライダー定義にする */
  const slider = (key, label, hint) => ({
    value: config[key],
    min: RANGES[key].min,
    max: RANGES[key].max,
    step: RANGES[key].step ?? 1,
    label: label || key,
    ...(hint ? { hint } : {}),
    onChange: fromPanelOnly((v) => onChange({ [key]: v })),
  })

  useControls(
    () => ({
      preset: {
        value: presetName,
        options: Object.keys(PRESETS),
        onChange: fromPanelOnly((v) => onPreset(v)),
        transient: false,
      },
      nodeLimit: {
        ...slider('nodeLimit', 'nodeLimit (Phase 2)'),
        max: 300,
      },
      neighborLimit: slider(
        'neighborLimit',
        'neighborLimit',
        '次に展開する記事から効く'
      ),
      edgeMode: {
        value: config.edgeMode,
        options: ['radial', 'induced'],
        label: 'edgeMode (induced: Phase 1)',
        onChange: fromPanelOnly((v) => onChange({ edgeMode: v })),
      },
      colorMode: {
        value: config.colorMode,
        options: ['mono', 'category'],
        label: 'colorMode (category: Phase 3)',
        onChange: fromPanelOnly((v) => onChange({ colorMode: v })),
      },
      trailEnabled: {
        value: config.trailEnabled,
        label: 'trailEnabled',
        onChange: fromPanelOnly((v) => onChange({ trailEnabled: v })),
      },
      seed: {
        ...slider('seed', 'seed', '配置を作り直す。抽選は次に展開する記事から効く'),
        max: 9999,
      },

      // 力学。動かすと今の位置から計算が再開する(配置は作り直さない)
      layout: folder(
        {
          repulsion: slider('repulsion', 'repulsion', '大きいほど全体が広がる'),
          repulsionRange: slider(
            'repulsionRange',
            'repulsionRange',
            '反発を計算する距離の上限'
          ),
          springK: slider('springK', 'springK', '大きすぎると振動する'),
          springLength: slider('springLength', 'springLength', '隣接ノードの狙いの距離'),
          centerK: slider('centerK', 'centerK', '0 にすると際限なく広がる'),
          damping: slider('damping', 'damping', '小さいほど早く止まる'),
          alphaDecay: slider('alphaDecay', 'alphaDecay', '小さいほど早く収束する'),
        },
        { collapsed: false }
      ),

      // 見た目。配置には影響しない
      visual: folder(
        {
          visibleLabels: slider('visibleLabels', 'visibleLabels'),
          edgePrimaryOpacity: slider('edgePrimaryOpacity', 'edgePrimaryOpacity'),
          edgeWeakOpacity: slider('edgeWeakOpacity', 'edgeWeakOpacity'),
          followLerp: slider('followLerp', 'followLerp', 'カメラ追従の機敏さ'),
        },
        { collapsed: false }
      ),
    }),
    // 外(URL・プリセット切替)から値が変わったらパネル側も作り直す
    [presetName, config]
  )

  return (
    <div className="debug-panel">
      <Leva
        titleBar={{ title: `VIZ CONFIG · ${presetName}`, filter: false }}
        theme={{
          fonts: { mono: '"JetBrains Mono", ui-monospace, monospace', sans: '"JetBrains Mono", ui-monospace, monospace' },
          colors: {
            elevation1: '#000',
            elevation2: '#0a0a0a',
            elevation3: '#1a1a1a',
            accent1: '#eaeaea',
            accent2: '#cfcfcf',
            accent3: '#8a8a8a',
            highlight1: '#666',
            highlight2: '#cfcfcf',
            highlight3: '#fff',
          },
          radii: { xs: '0px', sm: '0px', lg: '0px' },
        }}
      />
    </div>
  )
}
