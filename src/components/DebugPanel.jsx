import React from 'react'
import { Leva, useControls, folder } from 'leva'
import { PRESETS, RANGES } from '../config/presets.ts'
import { CAMERA_FIT_MODES } from '../constants.js'

/**
 * 表示パラメータ(VizConfig)をその場で切り替えるデバッグパネル。
 * ?debug=1 のときだけ出す。
 *
 * leva の onChange は初期化時(initial)にも fromPanel=true で呼ばれるので、
 * 「初期化でなく、人がパネルを触った」ときだけ上位へ通知する。
 * そうしないと読み込んだだけで URL が書き換わり、設定の反映が循環する。
 *
 * 項目は layout(力学)・visual(見た目)・ranking(関連リンクの順位付け)・
 * relation(関連の強さを配置と動きで見せる。SPEC 6.9)のフォルダに分けている。
 * layout を動かすと配置の計算が再開し、visual は描画だけが変わる(SPEC 12.2)。
 * ranking の重みは次に展開する記事から、moreBatch / moreMax は次に追加するときから効く。
 * relation の距離の項目は layout と同じく計算を再開し、強調・パケットは描画だけが変わる。
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

  /** on/off の項目 */
  const toggle = (key, hint) => ({
    value: config[key],
    label: key,
    hint,
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
          labelDepthFade: {
            value: config.labelDepthFade,
            label: 'labelDepthFade',
            hint: '現在地より奥のラベルを深さに応じて薄くする',
            onChange: fromPanelOnly((v) => onChange({ labelDepthFade: v })),
          },
          fadeStart: slider('fadeStart', 'fadeStart', '薄くし始める深さの差'),
          fadeEnd: slider('fadeEnd', 'fadeEnd', '見えなくなる深さの差'),
          // 最初のカメラ距離の決め方(SPEC 4章)。次に検索・URL から開き直したときに効く
          cameraFit: {
            value: config.cameraFit,
            options: CAMERA_FIT_MODES,
            label: 'cameraFit',
            hint: 'all=全体 / a=中心と子 / b=a+前の中心(上限あり) / c=a+前の中心(端に入るときだけ) / d=中心と上位の子',
            onChange: fromPanelOnly((v) => onChange({ cameraFit: v })),
          },
        },
        { collapsed: false }
      ),

      // 関連リンクの順位付け。次に展開する記事から効く。
      // 内訳は Console の console.table(スコアの内訳)で確かめながら調整する
      ranking: folder(
        {
          wMorelike: slider('wMorelike', 'wMorelike', 'morelike 順位の重み'),
          wMutual: slider('wMutual', 'wMutual', '相互リンクの加点。次の展開から効く'),
          wLead: slider('wLead', 'wLead', '冒頭リンクの加点。次の展開から効く'),
          moreBatch: slider('moreBatch', 'moreBatch', '追加1回で足す件数'),
          moreMax: slider('moreMax', 'moreMax', '1記事あたりの追加の上限'),
        },
        { collapsed: false }
      ),

      // 関連の強さ(SPEC 6.9)。rev3 ですべて on。
      // 距離の項目を動かすと今の位置から計算が再開し、強調・パケットは描画だけが変わる
      relation: folder(
        {
          distanceByScore: toggle('distanceByScore', '関連が強い記事ほど中心の近くに置く'),
          childSpringMin: slider('childSpringMin', 'childSpringMin', '関連が最も強い子の距離'),
          childSpringMax: slider('childSpringMax', 'childSpringMax', '関連が最も弱い子の距離'),
          trailSpringBase: slider('trailSpringBase', 'trailSpringBase', '中心同士の距離の基準'),
          trailMutualBonus: slider(
            'trailMutualBonus',
            'trailMutualBonus',
            '中心同士が相互リンクなら縮める量'
          ),
          trailSharedBonus: slider(
            'trailSharedBonus',
            'trailSharedBonus',
            '共通ワード1件あたりに縮める量'
          ),
          trailSharedCap: slider('trailSharedCap', 'trailSharedCap', '共通ワードを数える上限'),
          trailTiered: toggle('trailTiered', '中心同士の距離を共通ワードの件数の段階で決める(rev4)'),
          trailSpringK: slider('trailSpringK', 'trailSpringK', '段階で決めるときの中心同士の線の硬さ'),
          trailLenNone: slider('trailLenNone', 'trailLenNone', '共通ワード 0 件の中心同士の距離'),
          trailLenFew: slider('trailLenFew', 'trailLenFew', '1〜3件'),
          trailLenMid: slider('trailLenMid', 'trailLenMid', '4〜7件'),
          trailLenMany: slider('trailLenMany', 'trailLenMany', '8件以上'),
          arrivalShared: toggle('arrivalShared', '進んだ直後、前後の中心と共通ワードだけを残して減光する'),
          arrivalSharedMs: slider('arrivalSharedMs', 'arrivalSharedMs', '強調を続ける時間(ms)'),
          arrivalSharedFadeMs: slider('arrivalSharedFadeMs', 'arrivalSharedFadeMs', '通常に戻す時間(ms)'),
          arrivalSharedMax: slider('arrivalSharedMax', 'arrivalSharedMax', 'ラベルを保証する共通ワードの上限'),
          sharedPackets: toggle(
            'sharedPackets',
            '前の中心 → 共通ワード → 今の中心 にパケットを流す'
          ),
          sharedPacketPx: slider('sharedPacketPx', 'sharedPacketPx', '共通ワードを通るパケットの半径(px)'),
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
