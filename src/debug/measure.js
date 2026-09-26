/**
 * 画面上の見え方を測る道具(SPEC 12.5。タスク06)。?debug=1 の window.__viz.measure() から呼ぶ。
 *
 * rev2 と rev3 を「同じ展開結果・同じ仮想画面・同じ視点」で比べ、
 * 利用者が実際に見ている画面上の数字(px)を出す。3D 座標の数字だけでは、
 * ノードとラベルを画面上の px で固定している(sizeAttenuation:false)この表示の見え方は分からないため。
 *
 * 決定論(同じ経路・同じ設定なら、何度測っても同じ数字)のための決まり:
 *   - 展開は URL からの復元と同じ expandRoute で1回だけ行い、全プリセットで共有する
 *   - 配置は (seed, 記事名) の初期位置から、表示と同じ stepForces で落ち着くまで進める
 *   - ドリフト・震え・ラベルの出入りのフェードは使わない。位置はレイアウト座標、
 *     ラベルは「まっさらな状態で選び直したら」の結果、深さフェードは目標値で判定する
 *   - 例外は M8(回転中の点滅)。表示と同じ優遇(LABEL_KEEP_BIAS)と選び直しの間隔を使う
 *   - 画面に出ているグラフには触れない(ここで作るのは別の配置・別のカメラ)
 *
 * 力学・ラベルの選び方・投影・大きさの決め方は、表示と同じ関数(src/utils/)を呼ぶ。ここで写して作り直さないこと。
 */
import * as THREE from 'three'
import { expandRoute, fetchPageviews } from '../api/wikipedia.js'
import { buildGraph } from '../utils/buildGraph.js'
import { seededRandom } from '../utils/prng.js'
import { computeEdgeSpringLength, arrivalHighlightSet, trailTier } from '../utils/relation.js'
import { initialPosition, stepForces, fitCamera } from '../utils/forceLayout.js'
import {
  projectToScreen,
  isOnScreen,
  viewDepth,
  makeViewCamera,
  aimCamera,
  orbitDirections,
  cameraUpFor,
} from '../utils/screenProjection.js'
import {
  selectLabels,
  focusForArrival,
  labelDisplayText,
  labelTextureSize,
  labelHeightPx,
  LABEL_TEXTURE_SCALE,
} from '../utils/labelSelect.js'
import { depthFadeOf } from '../utils/depthFade.js'
import { nodeTierStyle } from '../utils/nodeStyle.js'
import {
  assertSameRanking,
  median,
  pearson,
  ratio,
  countWithin,
  closePairs,
  createFlickerCounter,
  shouldReselect,
  summarizeViews,
  round,
} from '../utils/screenMetrics.js'
import { PRESETS, LAYOUT_KEYS } from '../config/presets.ts'
import { BENCH_ROUTES } from './benchRoutes.js'
import {
  ALPHA_MIN,
  SIM_STEPS_PER_SEC,
  CAMERA_FOV,
  FIT_PADDING,
  FIT_MIN_RADIUS,
  INITIAL_FIT_DELAY_MS,
  HIT_RADIUS_PX,
  LABEL_KEEP_BIAS,
  LABEL_UPDATE_INTERVAL_MS,
  LABEL_PX,
  LABEL_CURRENT_PX,
  MEASURE_VIEWS,
  MEASURE_MAX_STEPS,
  MEASURE_CROWD_RADIUS_PX,
  MEASURE_TOUCH_PAIR_PX,
  MEASURE_ROTATE_STEP_DEG,
  MEASURE_VIEWPORTS,
} from '../constants.js'

// rev2・rev3・rev4 は順位付けの重みが同じなので、同じ展開結果のまま比べられる
const DEFAULT_PRESETS = ['rev2', 'rev3', 'rev4']
const DEFAULT_VIEWPORTS = ['pc', 'phone']
// 上位・下位として比べる件数(M1・M3)
const TOP_N = 10
// 点滅とみなす「消えてから再表示まで」の時間(タスク03 の確認と同じ)
const FLICKER_WINDOW_MS = 1000
// M8 で時間を進める刻み(60 ステップ/秒)
const FRAME_MS = 1000 / 60

// 周回視点の平均・最悪値を出す項目と、どちらが悪いか
const WORST_OF = {
  m1Ratio: 'max', // 上位が下位より(画面上で)中心に近いほど小さい
  m1TopMedianPx: 'max',
  m1BottomMedianPx: 'min',
  m1Offscreen: 'max',
  m2Screen: 'max', // 負で絶対値が大きいほど「関連が強いほど近い」
  m3Readable: 'min',
  m5Crowd: 'max',
  m6Pairs: 'max',
  m6CenterPairs: 'max',
  m6TouchPairs: 'max',
  m6TouchCenterPairs: 'max',
  m9Readable: 'min',
}

/**
 * 測る。options はすべて省略可(省略時は全部を測る)。
 * overrides はプリセットごとの値の上書き(値の調整を試すとき用。例: { rev4: { trailLenFew: 150 } })。
 * 上書きした値も結果の条件(conditions.config)に残る
 * @param {{routes?:string[], presets?:string[], viewports?:string[], overrides?:Record<string, object>}} [options]
 * @param {{onProgress?:(text:string|null)=>void}} [hooks] 進み具合(ステータス行に出す文言)
 */
export async function runMeasure(options = {}, { onProgress = () => {} } = {}) {
  const routeKeys = options.routes ?? BENCH_ROUTES.map((r) => r.key)
  const presetNames = options.presets ?? DEFAULT_PRESETS
  const viewportKeys = options.viewports ?? DEFAULT_VIEWPORTS

  const routes = routeKeys.map((key) => {
    const route = BENCH_ROUTES.find((r) => r.key === key)
    if (!route) throw new Error(`[measure] 経路 ${key} がありません(src/debug/benchRoutes.js)`)
    return route
  })
  for (const name of presetNames) {
    if (!PRESETS[name]) throw new Error(`[measure] プリセット ${name} がありません`)
  }
  for (const key of viewportKeys) {
    if (!MEASURE_VIEWPORTS[key]) throw new Error(`[measure] 仮想画面 ${key} がありません(MEASURE_VIEWPORTS)`)
  }

  // ラベルの幅は文字の幅で決まる。Web フォントが読めていないと代替書体の幅になり、数字が変わる
  await loadLabelFonts()
  const measureCanvas = document.createElement('canvas').getContext('2d')
  const aspectCache = new Map()
  const labelAspect = (display, bold) => {
    const key = `${bold ? 'b' : 'r'}:${display}`
    if (!aspectCache.has(key)) {
      const { width, height } = labelTextureSize(display, bold, measureCanvas)
      aspectCache.set(key, width / height)
    }
    return aspectCache.get(key)
  }

  const runs = []
  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri]
    const head = `MEASURE ${ri + 1}/${routes.length} ${route.key}`
    // 種は経路のもの。プリセットの seed が違っても同じ展開結果・同じ初期配置で比べる
    const named = presetNames.map((name) => ({
      name,
      config: { ...PRESETS[name], ...(options.overrides?.[name] || {}), seed: route.seed },
    }))
    assertSameRanking(named)
    const base = named[0].config

    // --- 1. 展開(1回だけ。全プリセットで共有する) ---
    onProgress(`${head} 展開中`)
    const expansions = new Map()
    const trail = await expandRoute(
      route.start,
      route.path,
      (assumeCanonical) => ({
        limit: base.neighborLimit,
        assumeCanonical,
        randomFor: (title) => seededRandom(base.seed, title),
        weights: { wMorelike: base.wMorelike, wMutual: base.wMutual, wLead: base.wLead },
        debug: false,
      }),
      (r) => expansions.set(r.title, r.links)
    )

    // 閲覧数は一次ノードの大きさ(= ラベルの置き場所・当たり判定)に効く。表示と同じく取りに行く。
    // 日によって変わるので、使った値を条件に残す
    onProgress(`${head} 閲覧数`)
    const views = new Map()
    const titles = buildGraph(trail, expansions, new Map(), base).nodes.map((n) => n.id)
    await fetchPageviews(titles, (title, v) => views.set(title, v))
    // 取得に失敗した記事はキャッシュされず、次に測ったときに取り直される(= 数字が変わる)。
    // 1回だけ取り直し、それでも欠けたら結果に残して警告する(その回の数字は比べられない)
    let missing = titles.filter((t) => !views.has(t))
    if (missing.length > 0) {
      await fetchPageviews(missing, (title, v) => views.set(title, v))
      missing = titles.filter((t) => !views.has(t))
    }
    if (missing.length > 0) {
      console.warn(
        '[measure] %s: 閲覧数を取れなかった記事が%d件あります。球の大きさが変わるので、もう一度測ると数字が変わることがあります: %o',
        route.key,
        missing.length,
        missing
      )
    }

    for (let pi = 0; pi < named.length; pi++) {
      const { name, config } = named[pi]
      onProgress(`${head} ${name}`)
      // ステータス行を描き直す機会を作る(配置の計算は同期で数百ミリ秒かかる)
      await new Promise((resolve) => setTimeout(resolve, 0))

      const graph = buildGraph(trail, expansions, views, config)
      const layout = settleLayout(graph, config)
      const scene = describeScene(graph, layout, trail, expansions, labelAspect)
      // 到着時の共通ワード強調の対象(M9)。強調が off のプリセットでも、同じ件数の枠で数える
      scene.arrival = arrivalHighlightSet(trail, expansions, config.arrivalSharedMax, config)

      for (let vi = 0; vi < viewportKeys.length; vi++) {
        const vpKey = viewportKeys[vi]
        runs.push({
          order: [ri, vi, pi],
          result: measureViewport({ route, trail, views, missing, name, config, layout, scene, vpKey }),
        })
      }
    }
  }
  onProgress(null)

  // rev2 と rev3 が上下に並ぶよう、経路 → 仮想画面 → プリセット の順にする
  runs.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2])
  return {
    date: new Date().toISOString(),
    options: { routes: routeKeys, presets: presetNames, viewports: viewportKeys, overrides: options.overrides || null },
    rules: {
      views: MEASURE_VIEWS,
      maxSteps: MEASURE_MAX_STEPS,
      crowdRadiusPx: MEASURE_CROWD_RADIUS_PX,
      hitPairPx: 2 * HIT_RADIUS_PX,
      touchPairPx: MEASURE_TOUCH_PAIR_PX,
      rotateStepDeg: MEASURE_ROTATE_STEP_DEG,
      topN: TOP_N,
    },
    results: runs.map((r) => r.result),
  }
}

async function loadLabelFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load(`500 ${LABEL_PX * LABEL_TEXTURE_SCALE}px "JetBrains Mono"`),
      document.fonts.load(`700 ${LABEL_CURRENT_PX * LABEL_TEXTURE_SCALE}px "JetBrains Mono"`),
    ])
    await document.fonts.ready
  } catch {
    // 読めなくても測れる(代替書体の幅になる)。表示も同じ代替書体になるので、比べる上では揃っている
  }
}

/**
 * 表示と同じ力学で、初期位置から落ち着くまで進める。
 * URL から復元したときと同じく「一度に組んで落ち着かせる」形になる
 * (実際の散歩はクリックのたびに前の配置を引き継ぐので、そこは違う)。
 * 途中の INITIAL_FIT_DELAY_MS 相当のステップで、アプリが最初に全体を収めるときの距離を求める
 */
function settleLayout(graph, config) {
  const layout = {}
  for (const k of LAYOUT_KEYS) layout[k] = config[k]

  // Graph3D の syncGraph と同じ順(graphData.nodes の順)に並べる。反発の計算順が配置に効く
  const nodes = new Map()
  for (const g of graph.nodes) {
    const node = { id: g.id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    initialPosition(config.seed, g.id, node)
    nodes.set(g.id, node)
  }
  const links = graph.links
    .map((l) => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      type: l.type,
      relScore: l.relScore || 0,
      mutual: l.mutual ? 1 : 0,
      sharedCount: l.sharedCount || 0,
    }))
    .filter((l) => nodes.has(l.source) && nodes.has(l.target))
  for (const link of links) link.springLength = computeEdgeSpringLength(link, layout)

  const sim = { nodes, links, layout, alpha: 1, jitter: seededRandom(config.seed, 'jitter') }
  const fitStep = Math.round((INITIAL_FIT_DELAY_MS / 1000) * SIM_STEPS_PER_SEC)
  let steps = 0
  let fit = null
  while (steps < MEASURE_MAX_STEPS && stepForces(sim)) {
    steps += 1
    if (steps === fitStep) fit = fitCamera(nodes.values(), CAMERA_FOV, FIT_PADDING, FIT_MIN_RADIUS)
  }
  // fitStep より前に落ち着いた場合は、落ち着いた配置で収める
  if (!fit) fit = fitCamera(nodes.values(), CAMERA_FOV, FIT_PADDING, FIT_MIN_RADIUS)
  return { nodes, links, steps, capped: sim.alpha >= ALPHA_MIN, fitStep, fit }
}

/** 各ノードの階層・大きさ・ラベルの寸法と、中心の子(関連スコア順)をまとめる */
function describeScene(graph, layout, trail, expansions, labelAspect) {
  const currentId = trail[trail.length - 1]
  const prevCenter = trail.length > 1 ? trail[trail.length - 2] : null
  const adjacency = new Map()
  for (const id of layout.nodes.keys()) adjacency.set(id, new Set())
  for (const l of layout.links) {
    adjacency.get(l.source).add(l.target)
    adjacency.get(l.target).add(l.source)
  }
  const currentNeighbors = adjacency.get(currentId) || new Set()

  const info = graph.nodes.map((g) => {
    const isCurrent = g.id === currentId
    const style = nodeTierStyle({
      isCurrent,
      isPrimary: currentNeighbors.has(g.id),
      expanded: !!g.expanded,
      views: g.views,
    })
    const display = labelDisplayText(g.name || g.id)
    return {
      id: g.id,
      isCurrent,
      tier: style.tier,
      basePx: style.basePx,
      labelPx: labelHeightPx(isCurrent),
      labelAspect: labelAspect(display, isCurrent),
    }
  })

  // 子 = 中心の展開結果のうち、画面に出ている記事。1つ前の中心は含めない
  const shown = new Set(layout.nodes.keys())
  const children = (expansions.get(currentId) || [])
    .filter((l) => shown.has(l.title) && l.title !== prevCenter && l.title !== currentId)
    .map((l) => ({ id: l.title, relScore: l.relScore || 0 }))
    // 同じスコアのときは展開結果の順(安定ソート)
    .sort((a, b) => b.relScore - a.relScore)

  return { currentId, info, children }
}

/** 1つの仮想画面で、初期視点・周回視点・回転(M8)を測る */
function measureViewport({ route, trail, views, missing, name, config, layout, scene, vpKey }) {
  const vp = MEASURE_VIEWPORTS[vpKey]
  const current = layout.nodes.get(scene.currentId)
  const target = { x: current.x, y: current.y, z: current.z }
  const distance = layout.fit.distance

  // アプリが最初に置く向き: 起動時のカメラ(+z から原点)のまま全体を収め、注視点だけ中心へ移す
  const initialDir = { x: 0, y: 0, z: 1 }
  const at = (dir) => ({
    x: target.x + dir.x * distance,
    y: target.y + dir.y * distance,
    z: target.z + dir.z * distance,
  })
  const camera = makeViewCamera(vp.width, vp.height, at(initialDir), target)
  const initial = evaluateView(camera, vp, vpKey, config, layout, scene)

  const initialCenters = centerPairs(camera, vp, layout, scene)
  const perView = orbitDirections(MEASURE_VIEWS).map((dir) => {
    aimCamera(camera, at(dir), target, cameraUpFor(dir))
    return evaluateView(camera, vp, vpKey, config, layout, scene)
  })
  const { mean, worst } = summarizeViews(perView.map((v) => v.flat), WORST_OF)

  return {
    route: route.key,
    viewport: vpKey,
    preset: name,
    conditions: {
      route: { key: route.key, start: route.start, path: route.path, seed: route.seed },
      trail,
      config: { ...config },
      viewport: { key: vpKey, width: vp.width, height: vp.height, label: vp.label },
      camera: {
        fov: CAMERA_FOV,
        distance: round(distance),
        // 距離を求めた配置(INITIAL_FIT_DELAY_MS を 60 ステップ/秒で換算したステップ目)
        fitStep: layout.fitStep,
        target: { x: round(target.x), y: round(target.y), z: round(target.z) },
      },
      views: MEASURE_VIEWS,
      steps: layout.steps,
      pageviews: Object.fromEntries(views),
      // 閲覧数を取れなかった記事(空でなければ、この回の数字は再現しないことがある)
      pageviewsMissing: missing,
    },
    M7: { steps: layout.steps, capped: layout.capped },
    // 中心同士の組ごとの共通ワードの件数・段階・狙いの長さ・実際の距離(3D と、初期視点の画面 px)
    centers: roundAll(initialCenters),
    initial: initial.detail,
    orbit: {
      perView: perView.map((v) => v.detail),
      mean: roundAll(mean),
      worst: roundAll(worst),
    },
    M8: measureFlicker(vp, config, layout, scene, target, at(initialDir)),
  }
}

/**
 * 投影とラベルの選び直しを、今のカメラで1回行う(まっさらな状態・優遇なし)。
 * focus を渡すと注目状態(到着時の共通ワード強調など)で選ぶ。対象は深さフェードを受けない
 */
function viewState(camera, vp, config, layout, scene, previous = null, keepBias = 1, focus = null) {
  const screen = new Map()
  for (const [id, n] of layout.nodes) {
    const s = projectToScreen(n, camera, vp.width, vp.height)
    s.on = isOnScreen(s, vp.width, vp.height)
    screen.set(id, s)
  }

  // 深さフェードの目標値(補間後ではなく目標値。SPEC 6.3)。ホバーは無いものとする
  const fadeOn = config.labelDepthFade
  const fade = new Map()
  if (fadeOn) {
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const baseDepth = viewDepth(layout.nodes.get(scene.currentId), camera, forward)
    for (const item of scene.info) {
      fade.set(
        item.id,
        item.isCurrent || (focus && focus.exempt.has(item.id))
          ? 1
          : depthFadeOf(viewDepth(layout.nodes.get(item.id), camera, forward) - baseDepth, config.fadeStart, config.fadeEnd)
      )
    }
  }

  const items = scene.info.map((item) => ({
    id: item.id,
    isCurrent: item.isCurrent,
    tier: item.tier,
    boosted: false,
    fadeTarget: fadeOn ? fade.get(item.id) : 1,
    wasSelected: previous ? previous.has(item.id) : false,
    pos: layout.nodes.get(item.id),
    radiusPx: item.basePx,
    labelPx: item.labelPx,
    labelAspect: item.labelAspect,
  }))
  const labels = selectLabels(items, {
    camera,
    width: vp.width,
    height: vp.height,
    focus,
    fadeOn,
    visibleLabels: config.visibleLabels,
    keepBias,
  })
  const reasonOf = new Map(scene.info.map((item, i) => [item.id, labels[i].reason]))
  const selected = new Set(scene.info.filter((_, i) => labels[i].selected).map((item) => item.id))
  return { screen, reasonOf, selected }
}

/** M1〜M6 を1つの視点で測る */
function evaluateView(camera, vp, vpKey, config, layout, scene) {
  const { screen, reasonOf } = viewState(camera, vp, config, layout, scene)
  const cs = screen.get(scene.currentId)
  const cur = layout.nodes.get(scene.currentId)

  // --- M1・M2: 関連スコアと、中心からの距離(画面 px と 3D) ---
  const children = scene.children.map((c) => {
    const s = screen.get(c.id)
    const p = layout.nodes.get(c.id)
    return {
      ...c,
      on: s.on,
      screenDist: Math.hypot(s.x - cs.x, s.y - cs.y),
      dist3d: Math.hypot(p.x - cur.x, p.y - cur.y, p.z - cur.z),
    }
  })
  const top = children.slice(0, TOP_N)
  const bottom = children.slice(-TOP_N)
  const onScreenDist = (list) => list.filter((c) => c.on).map((c) => c.screenDist)
  const topMedianPx = median(onScreenDist(top))
  const bottomMedianPx = median(onScreenDist(bottom))
  const top3d = median(top.map((c) => c.dist3d))
  const bottom3d = median(bottom.map((c) => c.dist3d))
  const M1 = {
    children: children.length,
    topMedianPx,
    bottomMedianPx,
    ratio: ratio(topMedianPx, bottomMedianPx),
    topMedian3d: top3d,
    bottomMedian3d: bottom3d,
    ratio3d: ratio(top3d, bottom3d),
    topOffscreen: top.filter((c) => !c.on).length,
    bottomOffscreen: bottom.filter((c) => !c.on).length,
  }
  const onChildren = children.filter((c) => c.on)
  const M2 = {
    screen: pearson(onChildren.map((c) => c.relScore), onChildren.map((c) => c.screenDist)),
    dist3d: pearson(children.map((c) => c.relScore), children.map((c) => c.dist3d)),
  }

  // --- M3: 上位の読める件数(選ばれていて、faint でない = reason が shown) ---
  const notReadable = { overlap: 0, depth: 0, offscreen: 0, rank: 0, faint: 0 }
  let readable = 0
  for (const c of top) {
    const reason = reasonOf.get(c.id)
    if (reason === 'shown') readable += 1
    else notReadable[reason] = (notReadable[reason] || 0) + 1
  }
  const M3 = { readable, of: top.length, notReadable }

  // --- M4: 全ノードのラベルの内訳(window.__viz.labels() の reason と同じ分け方) ---
  const M4 = {}
  for (const reason of reasonOf.values()) M4[reason] = (M4[reason] || 0) + 1

  // --- M5: 中心付近の混み具合(一次ノード) ---
  const primaryPoints = scene.info
    .filter((item) => item.tier === 1 && screen.get(item.id).on)
    .map((item) => screen.get(item.id))
  const M5 = { crowd: countWithin(cs, primaryPoints, MEASURE_CROWD_RADIUS_PX) }

  // --- M6: 押し間違いの起きやすさ(画面内のノード同士の間隔) ---
  const points = scene.info
    .filter((item) => screen.get(item.id).on)
    .map((item) => ({ id: item.id, ...screen.get(item.id) }))
  const hit = closePairs(points, 2 * HIT_RADIUS_PX, scene.currentId)
  const touch = vpKey === 'phone' ? closePairs(points, MEASURE_TOUCH_PAIR_PX, scene.currentId) : null
  const M6 = {
    onScreen: points.length,
    pairs: hit.pairs,
    centerPairs: hit.centerPairs,
    touchPairs: touch ? touch.pairs : null,
    touchCenterPairs: touch ? touch.centerPairs : null,
  }

  // --- M9: 共通ワードの読める件数(上位 arrivalSharedMax 件) ---
  // 強調が on のプリセットは「強調が最も効いている時点」(減光しきって対象のラベルを選び直した状態)、
  // off のプリセットは通常の状態で数える
  let M9 = null
  if (scene.arrival) {
    const focus = config.arrivalShared ? focusForArrival(scene.arrival) : null
    const state = focus ? viewState(camera, vp, config, layout, scene, null, 1, focus) : { reasonOf }
    const notReadable = {}
    let readable = 0
    for (const id of scene.arrival.shared) {
      const reason = state.reasonOf.get(id)
      if (reason === 'shown') readable += 1
      else notReadable[reason] = (notReadable[reason] || 0) + 1
    }
    M9 = { readable, of: scene.arrival.shared.length, notReadable, highlighted: !!focus }
  }

  const flat = {
    m1Ratio: M1.ratio,
    m1TopMedianPx: M1.topMedianPx,
    m1BottomMedianPx: M1.bottomMedianPx,
    m1Offscreen: M1.topOffscreen + M1.bottomOffscreen,
    m2Screen: M2.screen,
    m3Readable: M3.readable,
    m5Crowd: M5.crowd,
    m6Pairs: M6.pairs,
    m6CenterPairs: M6.centerPairs,
    m6TouchPairs: M6.touchPairs,
    m6TouchCenterPairs: M6.touchCenterPairs,
    m9Readable: M9 ? M9.readable : null,
  }
  return { flat, detail: roundAll({ M1, M2, M3, M4, M5, M6, M9 }) }
}

/** 経路の隣り合う中心の組ごとに、共通ワードの件数・段階・狙いの長さ・実際の距離(3D と画面 px) */
function centerPairs(camera, vp, layout, scene) {
  const out = []
  for (const link of layout.links) {
    if (link.type !== 'trail') continue
    const a = layout.nodes.get(link.source)
    const b = layout.nodes.get(link.target)
    const sa = projectToScreen(a, camera, vp.width, vp.height)
    const sb = projectToScreen(b, camera, vp.width, vp.height)
    out.push({
      from: link.source,
      to: link.target,
      shared: link.sharedCount,
      tier: trailTier(link.sharedCount),
      springLength: link.springLength,
      dist3d: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
      screenPx: Math.hypot(sa.x - sb.x, sa.y - sb.y),
      onScreen: isOnScreen(sa, vp.width, vp.height) && isOnScreen(sb, vp.width, vp.height),
    })
  }
  return out
}

/**
 * M8: 落ち着いた配置で、初期視点から縦軸回りにカメラを 360° 回し、
 * 「消えてから1秒以内に再表示」の回数を数える。
 * ラベルの選び直しは表示と同じ間隔・同じ優遇(LABEL_KEEP_BIAS)で行う。配置は動かさない
 */
function measureFlicker(vp, config, layout, scene, target, start) {
  const camera = makeViewCamera(vp.width, vp.height, start, target)
  const offset = new THREE.Vector3(start.x - target.x, start.y - target.y, start.z - target.z)
  const axis = new THREE.Vector3(0, 1, 0)
  const frames = Math.round(360 / MEASURE_ROTATE_STEP_DEG)
  const counter = createFlickerCounter(FLICKER_WINDOW_MS)
  let selected = null
  let last = 0
  for (let k = 0; k <= frames; k++) {
    const now = k * FRAME_MS
    if (k > 0 && !shouldReselect(now, last, LABEL_UPDATE_INTERVAL_MS)) continue
    const o = offset.clone().applyAxisAngle(axis, ((k * MEASURE_ROTATE_STEP_DEG) * Math.PI) / 180)
    aimCamera(camera, { x: target.x + o.x, y: target.y + o.y, z: target.z + o.z }, target)
    last = now
    selected = viewState(camera, vp, config, layout, scene, selected || new Set(), LABEL_KEEP_BIAS).selected
    counter.update(now, selected)
  }
  return { flickers: counter.flickers, labelUpdates: counter.updates, frames }
}

/** 入れ子のオブジェクトの数値を丸める(出力を読みやすくするため) */
function roundAll(obj) {
  if (obj === null || typeof obj !== 'object') return typeof obj === 'number' ? round(obj) : obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) out[k] = roundAll(v)
  return out
}

// ==========================================================================
// 要約(console.table)と Markdown
// ==========================================================================

const fmt = (v, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits))

/** console.table の要約。1行 = 経路 × 仮想画面 × プリセット */
export function summaryRows(result) {
  return result.results.map((r) => ({
    route: r.route,
    viewport: r.viewport,
    preset: r.preset,
    'M1比 初期': r.initial.M1.ratio,
    'M1比 周回平均': r.orbit.mean.m1Ratio,
    'M1比 最悪': r.orbit.worst.m1Ratio,
    'M2画面 初期': r.initial.M2.screen,
    'M2画面 周回平均': r.orbit.mean.m2Screen,
    'M2 3D': r.initial.M2.dist3d,
    'M3 初期': r.initial.M3.readable,
    'M3 周回平均': r.orbit.mean.m3Readable,
    'M3 最悪': r.orbit.worst.m3Readable,
    'M5 初期': r.initial.M5.crowd,
    'M6 初期': r.initial.M6.pairs,
    'M6中心 初期': r.initial.M6.centerPairs,
    M7: r.M7.capped ? `${r.M7.steps}(上限)` : r.M7.steps,
    M8: r.M8.flickers,
    'M9 初期': r.initial.M9 ? r.initial.M9.readable : '—',
    'M9 周回平均': r.orbit.mean.m9Readable,
    'M9 最悪': r.orbit.worst.m9Readable,
  }))
}

/** 直前の結果を、レポートに貼れる Markdown の表にする */
export function toMarkdown(result) {
  if (!result) return ''
  const rows = result.results
  const lines = []
  const table = (head, body) => {
    lines.push(`| ${head.join(' | ')} |`)
    lines.push(`|${head.map(() => '---').join('|')}|`)
    for (const b of body) lines.push(`| ${b.join(' | ')} |`)
    lines.push('')
  }
  const key = (r) => [r.route, r.viewport, r.preset]

  lines.push(`測定日時: ${result.date} / 周回視点 ${result.rules.views} / 上位・下位 ${result.rules.topN} 件`)
  lines.push('')
  lines.push('### 要約(初期視点 / 周回の平均 / 周回の最悪)')
  lines.push('')
  table(
    ['経路', '画面', 'プリセット', 'M1 比', 'M2 画面', 'M2 3D', 'M3 読める(/10)', 'M5 混み', 'M6 近い組(中心)', 'M7', 'M8', 'M9 共通ワード読める'],
    rows.map((r) => [
      ...key(r),
      `${fmt(r.initial.M1.ratio)} / ${fmt(r.orbit.mean.m1Ratio)} / ${fmt(r.orbit.worst.m1Ratio)}`,
      `${fmt(r.initial.M2.screen)} / ${fmt(r.orbit.mean.m2Screen)} / ${fmt(r.orbit.worst.m2Screen)}`,
      fmt(r.initial.M2.dist3d),
      `${r.initial.M3.readable} / ${fmt(r.orbit.mean.m3Readable, 1)} / ${fmt(r.orbit.worst.m3Readable, 0)}`,
      `${r.initial.M5.crowd} / ${fmt(r.orbit.mean.m5Crowd, 1)} / ${fmt(r.orbit.worst.m5Crowd, 0)}`,
      `${r.initial.M6.pairs}(${r.initial.M6.centerPairs}) / ${fmt(r.orbit.mean.m6Pairs, 1)}(${fmt(r.orbit.mean.m6CenterPairs, 1)}) / ${fmt(r.orbit.worst.m6Pairs, 0)}(${fmt(r.orbit.worst.m6CenterPairs, 0)})`,
      r.M7.capped ? `${r.M7.steps}(上限)` : String(r.M7.steps),
      String(r.M8.flickers),
      r.initial.M9
        ? `${r.initial.M9.readable} / ${fmt(r.orbit.mean.m9Readable, 1)} / ${fmt(r.orbit.worst.m9Readable, 0)}(/${r.initial.M9.of})`
        : '—',
    ])
  )

  lines.push('### 中心同士の距離(段階。3D と初期視点の画面 px)')
  lines.push('')
  table(
    ['経路', '画面', 'プリセット', '組', '共通ワード', '段階', '狙いの長さ', '3D 距離', '画面 px', '両方画面内'],
    rows.flatMap((r) =>
      r.centers.map((c) => [
        ...key(r),
        `${c.from} → ${c.to}`,
        String(c.shared),
        c.tier,
        fmt(c.springLength, 1),
        fmt(c.dist3d, 1),
        fmt(c.screenPx, 1),
        c.onScreen ? '○' : '×',
      ])
    )
  )

  lines.push('### M1 上位と下位の中心からの距離(初期視点。中央値。画面 px と 3D)')
  lines.push('')
  table(
    ['経路', '画面', 'プリセット', '子', '上位 px', '下位 px', '比 px', '上位 3D', '下位 3D', '比 3D', '画面外(上位/下位)'],
    rows.map((r) => {
      const m = r.initial.M1
      return [
        ...key(r),
        String(m.children),
        fmt(m.topMedianPx, 1),
        fmt(m.bottomMedianPx, 1),
        fmt(m.ratio),
        fmt(m.topMedian3d, 1),
        fmt(m.bottomMedian3d, 1),
        fmt(m.ratio3d),
        `${m.topOffscreen}/${m.bottomOffscreen}`,
      ]
    })
  )

  lines.push('### M3・M4 ラベル(初期視点)')
  lines.push('')
  const reasons = ['shown', 'faint', 'overlap', 'depth', 'offscreen', 'rank', 'hover']
  table(
    ['経路', '画面', 'プリセット', 'M3 読めない理由(上位10件)', ...reasons.map((x) => `M4 ${x}`)],
    rows.map((r) => [
      ...key(r),
      Object.entries(r.initial.M3.notReadable)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || '—',
      ...reasons.map((x) => String(r.initial.M4[x] || 0)),
    ])
  )

  lines.push(`### M6 押し間違いの起きやすさ(初期視点。間隔 ${result.rules.hitPairPx}px 未満 / 指 ${result.rules.touchPairPx}px 未満は phone のみ)`)
  lines.push('')
  table(
    ['経路', '画面', 'プリセット', '画面内のノード', `${result.rules.hitPairPx}px 未満`, 'うち中心を含む', `${result.rules.touchPairPx}px 未満`, 'うち中心を含む'],
    rows.map((r) => {
      const m = r.initial.M6
      return [
        ...key(r),
        String(m.onScreen),
        String(m.pairs),
        String(m.centerPairs),
        m.touchPairs === null ? '—' : String(m.touchPairs),
        m.touchCenterPairs === null ? '—' : String(m.touchCenterPairs),
      ]
    })
  )

  lines.push('### 条件')
  lines.push('')
  table(
    ['経路', '画面', 'プリセット', '経路(trail)', '仮想画面', 'カメラ距離', '画角', '距離を求めたステップ', 'M8 選び直し回数', '閲覧数の欠け'],
    rows.map((r) => [
      ...key(r),
      r.conditions.trail.join(' → '),
      `${r.conditions.viewport.width}×${r.conditions.viewport.height}`,
      fmt(r.conditions.camera.distance, 1),
      `${r.conditions.camera.fov}°`,
      String(r.conditions.camera.fitStep),
      String(r.M8.labelUpdates),
      String(r.conditions.pageviewsMissing.length),
    ])
  )
  return lines.join('\n')
}
