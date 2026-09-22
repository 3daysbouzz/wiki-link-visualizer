import React from 'react'
import { Leva, useControls } from 'leva'
import { PRESETS } from '../config/presets.ts'

/**
 * 表示パラメータ(VizConfig)をその場で切り替えるデバッグパネル。
 * ?debug=1 のときだけ出す。
 *
 * leva の onChange は初期化時(initial)にも fromPanel=true で呼ばれるので、
 * 「初期化でなく、人がパネルを触った」ときだけ上位へ通知する。
 * そうしないと読み込んだだけで URL が書き換わり、設定の反映が循環する。
 */
export default function DebugPanel({ presetName, config, onChange, onPreset }) {
  const fromPanelOnly = (fn) => (value, _path, ctx) => {
    if (ctx && ctx.fromPanel && !ctx.initial) fn(value)
  }

  useControls(
    () => ({
      preset: {
        value: presetName,
        options: Object.keys(PRESETS),
        onChange: fromPanelOnly((v) => onPreset(v)),
        transient: false,
      },
      nodeLimit: {
        value: config.nodeLimit,
        min: 8,
        max: 300,
        step: 1,
        label: 'nodeLimit (Phase 2)',
        onChange: fromPanelOnly((v) => onChange({ nodeLimit: v })),
      },
      neighborLimit: {
        value: config.neighborLimit,
        min: 1,
        max: 150,
        step: 1,
        label: 'neighborLimit',
        hint: '次に展開する記事から効く',
        onChange: fromPanelOnly((v) => onChange({ neighborLimit: v })),
      },
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
        value: config.seed,
        min: 0,
        max: 9999,
        step: 1,
        label: 'seed',
        hint: '配置を作り直す。抽選は次に展開する記事から効く',
        onChange: fromPanelOnly((v) => onChange({ seed: v })),
      },
    }),
    // 外(URL・プリセット切替)から値が変わったらパネル側も作り直す
    [presetName, config]
  )

  return (
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
  )
}
