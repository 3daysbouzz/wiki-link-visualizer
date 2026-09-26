import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
// 太い線(相互リンクの強調。SPEC 6.9)。three 本体に同梱のもので、依存は増えない
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { seededRandom } from '../utils/prng.js'
import { depthFadeOf, approach, smoothstep } from '../utils/depthFade.js'
import { stepForces, spawnScatter, fitCamera } from '../utils/forceLayout.js'
import { projectToScreen, viewDepth } from '../utils/screenProjection.js'
import {
  selectLabels,
  labelDisplayText,
  labelFont,
  labelTextureSize,
  labelHeightPx,
  LABEL_TEXTURE_SCALE,
} from '../utils/labelSelect.js'
import { nodeTierStyle } from '../utils/nodeStyle.js'
import {
  NODE_PX_CURRENT,
  NODE_PX_CURRENT_MAX,
  NODE_PX_SECONDARY,
  NODE_SECONDARY_OPACITY,
  BREATH_PERIOD_S,
  RING_PX_MIN,
  RING_PX_MAX,
  RING_OPACITY_MAX,
  RING_OPACITY_MIN,
  HIT_RADIUS_PX,
  EDGE_HOVER_OPACITY,
  EDGE_DASH_SIZE,
  EDGE_GAP_SIZE,
  HOVER_DIM_RATIO,
  HOVER_SCALE,
  HOVER_TRANSITION_S,
  LABEL_PX,
  LABEL_CURRENT_PX,
  LABEL_COLOR,
  LABEL_HOVER_COLOR,
  LABEL_UPDATE_INTERVAL_MS,
  GRID_RING_RADII_PX,
  GRID_RING_OPACITIES,
  GRID_RADIAL_COUNT,
  GRID_RADIAL_LENGTH_PX,
  GRID_RADIAL_OPACITY,
  GRID_ROTATION_PERIOD_S,
  PACKET_COUNT,
  PACKET_PERIOD_S,
  PACKET_STAGGER_S,
  PACKET_PX,
  DRIFT_BACK,
  DRIFT_FRONT,
  TRAVEL_MS,
  TRAVEL_EASE,
  TRAVEL_DIM_OPACITY,
  ZOOM_STEP,
  ZOOM_TWEEN_MS,
  MOBILE_MAX_PIXEL_RATIO,
  SIM_STEPS_PER_SEC,
  SIM_MAX_STEPS_PER_FRAME,
  MORE_SHAKE_MS,
  MORE_SHAKE_PX,
  MORE_SHAKE_CYCLES,
  MORE_SPAWN_JITTER,
  LABEL_KEEP_BIAS,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_START_DISTANCE,
  FIT_PADDING,
  FIT_MIN_RADIUS,
  LABEL_SWAP_S,
  LABEL_SWAP_RISE_PX,
} from '../constants.js'
import { PRESETS, LAYOUT_KEYS, VISUAL_KEYS } from '../config/presets.ts'
import { isMobileViewport } from '../utils/layoutMode.js'
import {
  computeEdgeSpringLength,
  isEmphasizedEdge,
  mutualPulseFactor,
} from '../utils/relation.js'

/**
 * Three.js本体のみで実装した3Dグラフ描画コンポーネント。
 *
 * react-force-graph-3d を使わない理由:
 *   同ライブラリの内部依存(3d-force-graph -> three-render-objects)が
 *   WebGPU関連の実験的エクスポートを要求しており、three本体との
 *   バージョン整合が取れず描画が壊れる既知の不具合があるため。
 *   overrides でのバージョン固定は下位依存の緩い指定(^1.29等)により
 *   効かず、根本対応として依存そのものを撤廃した。
 *
 * 表示の約束事(色は使わず、白の大きさ・線種・不透明度だけで表す):
 *   大きさ   = 現在地からの距離(起点 > 一次 > 二次)。一次の中だけ閲覧数で幅を持たせる
 *   塗り/中空 = 未訪問は白塗り、訪問済み(軌跡上)は白い輪郭だけ
 *   線種     = 起点につながる線は実線、それ以外は破線
 *   不透明度 = 奥のもの(二次)ほど薄い
 *   脈動     = 中心同士の相互リンクの線(rev3 の mutualEmphasis。SPEC 6.9)
 *
 * ノードとラベルは Sprite(sizeAttenuation:false)で描く。
 * こうするとカメラ距離に関係なく画面上のピクセル数で大きさを決められるので、
 * 「近づくとラベルが巨大化する」「遠いと点が見えない」が起きない。
 */

const BACKGROUND = 0x000000

// 力学シミュレーションと見た目のパラメータは VizConfig から受け取る(SPEC 12.2)。
// 値そのものと調整の目安は src/constants.js / src/config/presets.ts にある。
// config プロパティが渡らない場合に備えて current プリセットを既定値にする
const FALLBACK_CONFIG = PRESETS.current

/** config から力学に使う値だけを取り出す */
function layoutOf(config) {
  const c = config || FALLBACK_CONFIG
  const out = {}
  for (const k of LAYOUT_KEYS) out[k] = c[k] ?? FALLBACK_CONFIG[k]
  return out
}

/** config から描画に使う値だけを取り出す */
function visualOf(config) {
  const c = config || FALLBACK_CONFIG
  const out = {}
  for (const k of VISUAL_KEYS) out[k] = c[k] ?? FALLBACK_CONFIG[k]
  return out
}

// 使い回す一時ベクトル(毎フレームのnewを避ける)
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _screen = {}
const _color = new THREE.Color()
const _resolution = new THREE.Vector2()
const LABEL_BASE_COLOR = new THREE.Color(LABEL_COLOR)
const LABEL_HOVER_COLOR_OBJ = new THREE.Color(LABEL_HOVER_COLOR)

/**
 * CSS の cubic-bezier(x1,y1,x2,y2) と同じイージング関数を作る。
 * x(t) を Newton 法で逆算して y を返す。
 */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t) => ((ay * t + by) * t + cy) * t
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-5) break
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    return sampleY(Math.min(Math.max(t, 0), 1))
  }
}
const easeTravel = cubicBezier(...TRAVEL_EASE)
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// ==========================================================================
// テクスチャ(白い円・白い輪)。全ノードで共有する
// ==========================================================================
function makeCircleTexture(size, hollow, strokeRatio) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const c = canvas.getContext('2d')
  const half = size / 2
  // 端でアンチエイリアスが切れないように少し内側に描く
  const radius = half * 0.875
  c.beginPath()
  if (hollow) {
    const stroke = radius * strokeRatio
    c.arc(half, half, radius - stroke / 2, 0, Math.PI * 2)
    c.lineWidth = stroke
    c.strokeStyle = '#fff'
    c.stroke()
  } else {
    c.arc(half, half, radius, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  // 円の直径 / キャンバスの一辺。Sprite の大きさを「円の半径 px」から決めるのに使う
  texture.userData.circleRatio = (radius * 2) / size
  return texture
}

// ==========================================================================
// px → Sprite スケール
//
// sizeAttenuation:false の Sprite は、scale をカメラ距離1における view 空間の
// 大きさとして扱う。画面上の高さ(px) = scale / tan(fov/2) * (viewport高さ/2)
// なので、逆算すると scale = px * 2 * tan(fov/2) / viewport高さ になる。
// ==========================================================================
function spriteScaleFromPx(ctx, px) {
  return px * ctx.pxToSprite
}

/** カメラから depth だけ奥にある位置で、画面1px がワールド座標で何単位か */
function worldPerPx(ctx, depth) {
  return depth * ctx.pxToSprite
}

/**
 * ノードの描画位置(レイアウト座標 + レイヤーごとのドリフト)。
 * 震えている最中のノード(追加表示の演出)はその揺れも足す。
 * レイアウト座標そのものは動かさない(揺らすと力学の計算が乱れるため)
 */
function displayPosition(ctx, node, out) {
  const drift = node.layer === 'back' ? ctx.driftBack : ctx.driftFront
  out.set(node.x + drift.x, node.y + drift.y, node.z + drift.z)
  if (ctx.shake && ctx.shake.id === node.id) out.add(ctx.shakeOffset)
  return out
}

const Graph3D = forwardRef(function Graph3D(
  { graphData, onNodeClick, onNodeHover, currentId, loadingId, packetRoutes, seed = 1, config },
  ref
) {
  const containerRef = useRef(null)
  const ctxRef = useRef(null)
  const clickHandlerRef = useRef(onNodeClick)
  const hoverHandlerRef = useRef(onNodeHover)

  // 最新のハンドラを常に参照できるようにしておく
  // (イベントリスナから呼ぶため、クロージャに古い関数を閉じ込めない)
  clickHandlerRef.current = onNodeClick
  hoverHandlerRef.current = onNodeHover

  // ======================================================================
  // 1. マウント時: シーン・カメラ・レンダラーの構築
  // ======================================================================
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BACKGROUND)

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      container.clientWidth / container.clientHeight || 1,
      CAMERA_NEAR,
      CAMERA_FAR
    )
    camera.position.set(0, 0, CAMERA_START_DISTANCE)

    // WebGLが使えない環境だと、何も言わず真っ暗になってしまうので
    // 初期化失敗を必ず画面に出す(不具合の切り分けを楽にするため)
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (e) {
      // innerHTML に文字列を流し込まず要素として組む
      // (例外メッセージは外部由来の文字列なので、HTML として解釈させない)
      const message = document.createElement('p')
      message.className = 'graph-fallback'
      message.setAttribute('role', 'alert')
      message.textContent =
        'WebGLの初期化に失敗しました。ブラウザのハードウェアアクセラレーションが無効になっていないか確認してください。'
      const detail = document.createElement('span')
      detail.className = 'graph-fallback-detail'
      detail.textContent = String((e && e.message) || e)
      message.appendChild(detail)
      container.replaceChildren(message)
      return
    }
    // スマートフォン(狭幅 or 低い横画面)では描画解像度を抑える。
    // DPR 3 の端末でそのまま描くと毎フレームの画素数がデスクトップの数倍になり、動きがもたつく。
    // 横向きにすると幅が 900px を超える端末があるので、幅だけで判定しない(SPEC 4章・8章)
    const initialPixelRatio = Math.min(
      window.devicePixelRatio,
      isMobileViewport() ? MOBILE_MAX_PIXEL_RATIO : 2
    )
    renderer.setPixelRatio(initialPixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    console.info(
      '[Graph3D] Three.js r%s / WebGL context: %s',
      THREE.REVISION,
      renderer.getContext() ? 'OK' : 'NG'
    )

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.rotateSpeed = 0.7

    // ---- 共有テクスチャ ----
    const discTexture = makeCircleTexture(128, false, 0)
    const hollowTexture = makeCircleTexture(128, true, 0.2)
    const ringTexture = makeCircleTexture(256, true, 0.045)

    // ---- エッジ ----
    // 実線(起点↔一次)と破線(それ以外)で LineSegments を分ける。
    // 線ごとに明るさを変えるため、材質の色ではなく頂点カラーを使う。
    // 黒背景なので「白を暗くする」=「不透明度を下げる」と見た目が同じになり、
    // 半透明オブジェクトの描画順の問題を避けられる。
    const makeEdgeMesh = (material) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(0), 3)
      )
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(0), 3)
      )
      const mesh = new THREE.LineSegments(geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = -5
      scene.add(mesh)
      return mesh
    }
    const solidMaterial = new THREE.LineBasicMaterial({ vertexColors: true })
    const dashedMaterial = new THREE.LineDashedMaterial({
      vertexColors: true,
      dashSize: EDGE_DASH_SIZE,
      gapSize: EDGE_GAP_SIZE,
    })
    const edgeSolid = makeEdgeMesh(solidMaterial)
    const edgeDashed = makeEdgeMesh(dashedMaterial)

    // 相互リンクを強調するときだけ使う太い線(SPEC 6.9)。実線・破線の区別はそのまま保つ。
    // WebGL の通常の線は常に 1 デバイスピクセルで太さを変えられないので、
    // 線を細長い四角形として描く LineSegments2 を使う。
    // resolution に描画バッファの大きさ(デバイスピクセル)を渡すので、linewidth は
    // 「通常の線(1 デバイスピクセル)の何倍か」がそのまま入る(resize で更新する)
    const wideSolidMaterial = new LineMaterial({ vertexColors: true, linewidth: 1 })
    const wideDashedMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: 1,
      dashed: true,
      dashSize: EDGE_DASH_SIZE,
      gapSize: EDGE_GAP_SIZE,
    })
    const makeWideEdgeMesh = (material) => {
      const mesh = new LineSegments2(new LineSegmentsGeometry(), material)
      // 座標は毎フレーム配列へ直接書くので、境界球が古いまま画面外と判定されないようにする
      mesh.frustumCulled = false
      mesh.renderOrder = -5
      mesh.visible = false
      scene.add(mesh)
      return mesh
    }
    const wideSolid = makeWideEdgeMesh(wideSolidMaterial)
    const wideDashed = makeWideEdgeMesh(wideDashedMaterial)

    // ---- 起点の外周リング ----
    const ringMaterial = new THREE.SpriteMaterial({
      map: ringTexture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: false,
      opacity: RING_OPACITY_MAX,
    })
    const ring = new THREE.Sprite(ringMaterial)
    ring.visible = false
    scene.add(ring)

    // ---- データパケット ----
    const packets = []
    for (let i = 0; i < PACKET_COUNT; i++) {
      const material = new THREE.SpriteMaterial({
        map: discTexture,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: false,
        opacity: 0,
      })
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      sprite.renderOrder = 1
      scene.add(sprite)
      packets.push(sprite)
    }

    // ---- 背景グリッド(同心円 + 放射状ガイド線) ----
    // 起点に追従し、常にカメラに正対させる。インタラクション対象外で最奥に置く
    // (depthTest を切って先に描くので、他の何にも重ならない)
    const grid = new THREE.Group()
    grid.visible = false
    grid.renderOrder = -10
    const gridMaterials = []
    const ringSegments = 96
    GRID_RING_RADII_PX.forEach((radiusPx, i) => {
      const points = []
      for (let s = 0; s < ringSegments; s++) {
        const a = (s / ringSegments) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(a) * radiusPx, Math.sin(a) * radiusPx, 0))
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: GRID_RING_OPACITIES[i] ?? GRID_RING_OPACITIES[GRID_RING_OPACITIES.length - 1],
        depthTest: false,
        depthWrite: false,
      })
      gridMaterials.push(material)
      const loop = new THREE.LineLoop(geometry, material)
      loop.renderOrder = -10
      grid.add(loop)
    })
    const radials = new THREE.Group()
    const radialMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: GRID_RADIAL_OPACITY,
      depthTest: false,
      depthWrite: false,
    })
    gridMaterials.push(radialMaterial)
    const radialPoints = []
    for (let i = 0; i < GRID_RADIAL_COUNT; i++) {
      const a = (i / GRID_RADIAL_COUNT) * Math.PI * 2
      radialPoints.push(new THREE.Vector3(0, 0, 0))
      radialPoints.push(
        new THREE.Vector3(Math.cos(a) * GRID_RADIAL_LENGTH_PX, Math.sin(a) * GRID_RADIAL_LENGTH_PX, 0)
      )
    }
    const radialGeometry = new THREE.BufferGeometry().setFromPoints(radialPoints)
    const radialMesh = new THREE.LineSegments(radialGeometry, radialMaterial)
    radialMesh.renderOrder = -10
    radials.add(radialMesh)
    grid.add(radials)
    scene.add(grid)

    const ctx = {
      scene,
      camera,
      renderer,
      controls,
      discTexture,
      hollowTexture,
      ringTexture,
      edgeSolid,
      edgeDashed,
      solidMaterial,
      dashedMaterial,
      wideSolid,
      wideDashed,
      wideSolidMaterial,
      wideDashedMaterial,
      // 相互リンクの線の明るさに掛ける値(脈動)。updateVisuals が毎フレーム決める
      mutualPulse: 1,
      ring,
      ringMaterial,
      packets,
      // データパケットを流す経路(記事名の列)。App の packetRoutesFor が決める(SPEC 6.7)
      packetRoutes: [],
      grid,
      radials,
      gridMaterials,
      nodes: new Map(),
      links: [],
      linkByKey: new Map(),
      adjacency: new Map(),
      labelTextures: new Map(),
      fontReady: false,
      currentId: null,
      hoveredId: null,
      loadingId: null,
      pulsePrev: null,
      followId: null,
      travel: null,
      alpha: 1,
      // 固定刻みのシミュレーションに使う、まだ消化していない時間(秒)
      simAccumulator: 0,
      // これまでに進めたステップ数(デバッグ用。配置の照合時に「同じ回数進んだか」を見る)
      simSteps: 0,
      // レイアウトの乱数の種。初期配置は (seed, 記事名) で決まり、
      // 同一座標のずらしには seed から作った乱数列を使う
      seed,
      jitter: seededRandom(seed, 'jitter'),
      // 力学・見た目のパラメータ(VizConfig 由来)。leva や URL で変わると差し替える
      layout: layoutOf(config),
      visual: visualOf(config),
      tween: null,
      lastLabelUpdate: 0,
      lastFrame: performance.now(),
      pxToSprite: 1,
      // 今設定している描画解像度。リサイズのたびに作り直さないための記録
      pixelRatio: initialPixelRatio,
      // 直前の描画領域の高さ。高さが変わったときに縮尺を保つために使う
      viewportHeight: 0,
      driftBack: new THREE.Vector3(),
      driftFront: new THREE.Vector3(),
      // 追加表示の演出(SPEC 6.8)
      // shake: 震わせているノード { id, start, amp } / shakeOffset: 今フレームの揺れ
      shake: null,
      shakeOffset: new THREE.Vector3(),
      // 記事名 => 出現させる元のノードid。次の syncGraph で新規ノードをそこから生やす
      pendingSpawn: new Map(),
      // 記事名 => ラベルの優先表示を終える時刻(performance.now)
      labelBoost: new Map(),
      pointer: new THREE.Vector2(),
    }
    ctxRef.current = ctx

    // 手動でカメラを操作したら追従をやめる(勝手に動くと操作を奪われて不快)
    const onControlsStart = () => {
      ctx.followId = null
    }
    controls.addEventListener('start', onControlsStart)

    // ---- リサイズ対応 ----
    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      // 端末を回すと縦横比だけでなく「低い横画面かどうか」も変わるので、
      // 解像度の上限もここで取り直す。
      // ただしサイドバーの開閉アニメーション中は resize が毎フレーム呼ばれるので、
      // 値が変わったときだけ設定する(setPixelRatio は描画バッファを作り直すため)
      const nextRatio = Math.min(
        window.devicePixelRatio,
        isMobileViewport() ? MOBILE_MAX_PIXEL_RATIO : 2
      )
      if (nextRatio !== ctx.pixelRatio) {
        ctx.pixelRatio = nextRatio
        renderer.setPixelRatio(nextRatio)
      }
      renderer.setSize(container.clientWidth, container.clientHeight)
      // 太い線の太さの基準。描画バッファ(デバイスピクセル)の大きさにしておくと、
      // linewidth が通常の線(1 デバイスピクセル)に対する倍率になる
      renderer.getDrawingBufferSize(_resolution)
      wideSolidMaterial.resolution.copy(_resolution)
      wideDashedMaterial.resolution.copy(_resolution)

      // --- 高さが変わったら、見た目の縮尺を保つようカメラを前後させる ---
      // カメラの画角は「縦」で決まっているので、描画領域の高さが変われば
      // 同じワールド距離が占める画素数が変わる = グラフが拡大・縮小して見える。
      // 幅だけが変わる場合(PC でサイドバーを畳むとき)は縦の画角が変わらないので
      // 「同じ大きさのまま横に広く見える」= 自然。高さのときだけこれが崩れる。
      //
      // 1px あたりのワールド距離は (注視点までの距離 / 高さ) に比例するので、
      // 高さの変化と同じ比率で距離を変えれば縮尺が保たれ、
      // 「広がった分だけ広く見える」ようになる
      const prevHeight = ctx.viewportHeight
      const nextHeight = container.clientHeight
      if (prevHeight && nextHeight !== prevHeight && !ctx.tween) {
        _v1.copy(camera.position)
          .sub(controls.target)
          .multiplyScalar(nextHeight / prevHeight)
        camera.position.copy(controls.target).add(_v1)
      }
      ctx.viewportHeight = nextHeight

      ctx.pxToSprite =
        (2 * Math.tan(((camera.fov * Math.PI) / 180) / 2)) / container.clientHeight
      // サイズを変えた直後にその場で描き直す。
      // ResizeObserver は「rAF の後・画面に出す前」に呼ばれるので、
      // ここで canvas を作り直したまま返すと、中身が空のフレームがそのまま表示される。
      // サイドバーの開閉アニメーション中は毎フレーム resize が走るため、
      // これをしないと動いている間ずっとグラフが消えたように見える
      if (ctx.nodes.size > 0) renderNow(ctx, performance.now() / 1000)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // ---- Web フォントが読めたらラベルを描き直す ----
    // ラベルは Canvas に描いたテクスチャなので、フォント読込前に作ると代替書体になる
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load(`500 ${LABEL_PX * LABEL_TEXTURE_SCALE}px "JetBrains Mono"`),
        document.fonts.load(`700 ${LABEL_CURRENT_PX * LABEL_TEXTURE_SCALE}px "JetBrains Mono"`),
      ])
        .then(() => {
          if (ctxRef.current !== ctx) return
          ctx.fontReady = true
          rebuildLabels(ctx)
        })
        .catch(() => {})
    }

    // ---- ポインタ位置からノードを1つ拾う ----
    // レイキャストではなく、各ノードを画面に投影して距離で判定する。
    // 見た目より広い当たり判定(HIT_RADIUS_PX)を素直に px で表現できるため
    const pickNode = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      let best = null
      let bestDist = Infinity
      let bestDepth = Infinity
      for (const node of ctx.nodes.values()) {
        if (!node.sprite.visible) continue
        displayPosition(ctx, node, _v1)
        const depth = camera.position.distanceTo(_v1)
        const s = projectToScreen(_v1, camera, rect.width, rect.height, _screen)
        if (!s.inFront) continue
        const d = Math.hypot(s.x - px, s.y - py)
        const hitRadius = Math.max(HIT_RADIUS_PX, node.basePx * node.vis.scale)
        if (d > hitRadius) continue
        // 現在地の球そのもの(描画半径の内側)を押したときは現在地を優先する。
        // 追加表示(SPEC 6.8)の直後は新しいノードが現在地の位置から生えて重なっているので、
        // 近さだけで選ぶと、続けて中心を押したつもりが新しいノードへ進んでしまう
        if (node.isCurrent && d <= node.basePx * node.vis.scale) return node
        // より近い(重なっているときは手前の)ノードを優先する
        if (d < bestDist - 2 || (Math.abs(d - bestDist) <= 2 && depth < bestDepth)) {
          best = node
          bestDist = d
          bestDepth = depth
        }
      }
      return best
    }

    // ---- クリック判定 ----
    // ドラッグ(回転操作)とクリックを区別するため、押した位置と離した位置の
    // 差分が小さいときだけクリックとみなす
    let downX = 0
    let downY = 0
    let downTime = 0

    const onPointerDown = (e) => {
      downX = e.clientX
      downY = e.clientY
      downTime = performance.now()
    }

    const onPointerUp = (e) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      if (moved > 5 || performance.now() - downTime > 600) return

      const node = pickNode(e.clientX, e.clientY)
      if (node && clickHandlerRef.current) {
        clickHandlerRef.current({ id: node.id, name: node.name })
      }
    }

    // ---- ホバー: 隣接ハイライト + 上位への通知 ----
    let hoverRaf = null
    const onPointerMove = (e) => {
      // ボタンを押している間(ドラッグで回している間・タッチ中)はホバーを更新しない。
      // 更新すると、回している最中にカーソルの下を球が通るたびにホバー表示
      // (隣接以外のラベルを隠す)が入って、画面全体のラベルが点滅する
      if (e.buttons) return
      if (hoverRaf) return
      const clientX = e.clientX
      const clientY = e.clientY
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = null
        const node = pickNode(clientX, clientY)
        const id = node ? node.id : null
        renderer.domElement.style.cursor = node ? 'pointer' : 'grab'

        if (id === ctx.hoveredId) return
        ctx.hoveredId = id
        applyHighlight(ctx)
        updateLabelVisibility(ctx) // ホバー変化時は即座に反映する
        if (hoverHandlerRef.current) {
          hoverHandlerRef.current(node ? { id: node.id, name: node.name } : null)
        }
      })
    }

    const onPointerLeave = () => {
      if (ctx.hoveredId === null) return
      ctx.hoveredId = null
      applyHighlight(ctx)
      updateLabelVisibility(ctx)
      if (hoverHandlerRef.current) hoverHandlerRef.current(null)
    }

    const el = renderer.domElement
    el.style.cursor = 'grab'
    el.style.display = 'block'
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)

    // ---- アニメーションループ ----
    let rafId = null
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const now = performance.now()
      // タブが非表示だった直後などに巨大な dt が来ても補間が飛ばないよう上限を付ける
      const dt = Math.min((now - ctx.lastFrame) / 1000, 0.1)
      ctx.lastFrame = now
      const t = now / 1000

      // 固定刻みで進める。溜まった時間を刻みごとに消化する(遅いフレームでは数回、速ければ0回)
      ctx.simAccumulator += dt
      const stepDt = 1 / SIM_STEPS_PER_SEC
      let steps = 0
      while (ctx.simAccumulator >= stepDt && steps < SIM_MAX_STEPS_PER_FRAME) {
        stepSimulation(ctx)
        ctx.simAccumulator -= stepDt
        steps += 1
        ctx.simSteps += 1
      }
      // 上限で打ち切った分は捨てる(タブ復帰直後に一気に進んで飛ぶのを防ぐ)
      if (ctx.simAccumulator >= stepDt) ctx.simAccumulator = 0
      updateDrift(ctx, t)
      updateShake(ctx, now)
      updateVisuals(ctx, t, dt)
      updatePositions(ctx)
      updateGrid(ctx, t)
      updatePackets(ctx, t)
      updateTween(ctx)
      updateFollow(ctx)
      controls.update()

      // ラベルの表示判定は毎フレームやると重いので間隔を空ける
      if (now - ctx.lastLabelUpdate > LABEL_UPDATE_INTERVAL_MS) {
        ctx.lastLabelUpdate = now
        updateLabelVisibility(ctx)
      }

      renderer.render(scene, camera)
    }
    animate()

    // ---- クリーンアップ ----
    // React 18 の StrictMode では開発時にマウント->アンマウント->マウントが
    // 走るため、ここで確実に後片付けしないとcanvasが2枚出る
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (hoverRaf) cancelAnimationFrame(hoverRaf)
      resizeObserver.disconnect()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerleave', onPointerLeave)
      controls.removeEventListener('start', onControlsStart)
      controls.dispose()

      for (const node of ctx.nodes.values()) {
        node.sprite.material.dispose()
        if (node.label) node.label.material.dispose()
      }
      for (const tex of ctx.labelTextures.values()) tex.dispose()
      for (const p of packets) p.material.dispose()
      for (const m of gridMaterials) m.dispose()
      grid.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
      })
      discTexture.dispose()
      hollowTexture.dispose()
      ringTexture.dispose()
      ringMaterial.dispose()
      edgeSolid.geometry.dispose()
      edgeDashed.geometry.dispose()
      solidMaterial.dispose()
      dashedMaterial.dispose()
      wideSolid.geometry.dispose()
      wideDashed.geometry.dispose()
      wideSolidMaterial.dispose()
      wideDashedMaterial.dispose()
      renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)

      ctx.nodes.clear()
      ctxRef.current = null
    }
  }, [])

  // ======================================================================
  // 2. graphData / currentId が変わったらシーンに反映
  // ======================================================================
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    syncGraph(ctx, graphData, currentId)
  }, [graphData, currentId])

  // ======================================================================
  // 3. 取得中のノードを脈打たせる / パケットを流すエッジ
  // ======================================================================
  useEffect(() => {
    const ctx = ctxRef.current
    if (ctx) ctx.loadingId = loadingId || null
  }, [loadingId])

  useEffect(() => {
    const ctx = ctxRef.current
    if (ctx) ctx.packetRoutes = packetRoutes || []
  }, [packetRoutes])

  // 種が変わったら全ノードを配置し直す(比較のために「同じ配置」を作り直せるように)
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || ctx.seed === seed) return
    ctx.seed = seed
    ctx.jitter = seededRandom(seed, 'jitter')
    for (const node of ctx.nodes.values()) {
      spawnPosition(ctx, node)
      node.vx = node.vy = node.vz = 0
    }
    ctx.alpha = 1
  }, [seed])

  // ======================================================================
  // 3b. VizConfig の変更を反映する
  //
  // 種の変更(上)は「配置の作り直し」= 初期位置に戻して最初からやり直す。
  // 力学パラメータの変更はそれとは区別し、**今の位置を残したまま**
  // alpha を 1 に戻して動きを再開させる。
  // こうするとパラメータを動かしたときに、今の形からどう変形するかが見えて
  // 比較しやすい(作り直すと毎回ゼロからの再生になって差が分かりにくい)。
  //
  // 依存配列にはオブジェクトではなく値を連結した文字列を渡す。
  // config は毎回新しいオブジェクトなので、そのままだと中身が同じでも毎回発火する
  // ======================================================================
  const layoutSignature = LAYOUT_KEYS.map((k) => (config ? config[k] : '')).join(',')
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.layout = layoutOf(config)
    // 線ごとの自然長は距離の設定(SPEC 6.9)で変わるので、ここで計算し直す
    for (const link of ctx.links) link.springLength = computeEdgeSpringLength(link, ctx.layout)
    ctx.alpha = 1 // 位置はそのまま。止まっていた計算を動かし直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSignature])

  // 見た目だけの値。配置には触れず、線の明るさとラベルの出し方を作り直す
  const visualSignature = VISUAL_KEYS.map((k) => (config ? config[k] : '')).join(',')
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const wasEmphasis = ctx.visual.mutualEmphasis
    ctx.visual = visualOf(config)
    // 相互リンクの強調を切り替えたら、線をどのメッシュで描くかを振り分け直す
    if (ctx.visual.mutualEmphasis !== wasEmphasis) rebuildEdgeBuffers(ctx)
    applyWideLineWidth(ctx)
    applyHighlight(ctx)
    updateLabelVisibility(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualSignature])

  // ======================================================================
  // 4. App側から呼べる命令的API
  // ======================================================================
  useImperativeHandle(ref, () => ({
    /** 線ごとの種類・関連の強さ・自然長・今の長さ(デバッグ用。SPEC 6.9) */
    getEdgeState() {
      const ctx = ctxRef.current
      if (!ctx) return []
      return ctx.links.map((l) => {
        const a = ctx.nodes.get(l.source)
        const b = ctx.nodes.get(l.target)
        return {
          source: l.source,
          target: l.target,
          type: l.type,
          relScore: l.relScore,
          mutual: l.mutual,
          sharedCount: l.sharedCount,
          springLength: l.springLength,
          wide: !!l.wide,
          dist: Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 10) / 10,
        }
      })
    },

    /**
     * 全ノードの現在座標を返す(デバッグ用)。
     * 「同じ URL を2回開いて同じ配置になるか」を機械的に照合するために使う
     */
    getPositions() {
      const ctx = ctxRef.current
      if (!ctx) return {}
      const out = { __sim: { steps: ctx.simSteps, alpha: ctx.alpha } }
      for (const n of ctx.nodes.values()) {
        out[n.id] = [n.x, n.y, n.z].map((v) => Math.round(v * 1000) / 1000)
      }
      return out
    },

    /**
     * カメラの状態を返す(デバッグ用)。
     * 「描画領域の高さが変わっても見た目の縮尺が保たれているか」を
     * distance / viewportHeight が一定かどうかで確認できる
     */
    getCamera() {
      const ctx = ctxRef.current
      if (!ctx) return null
      return {
        distance: Math.round(ctx.camera.position.distanceTo(ctx.controls.target) * 1000) / 1000,
        viewportHeight: ctx.viewportHeight,
        fov: ctx.camera.fov,
        aspect: Math.round(ctx.camera.aspect * 10000) / 10000,
      }
    },

    /**
     * ノードの画面上の位置(canvas 内の px)を返す(デバッグ用)。
     * クリック操作を機械的に確かめるときに、狙うノードの座標を得るために使う
     */
    getScreenPosition(id) {
      const ctx = ctxRef.current
      const node = ctx && ctx.nodes.get(id)
      if (!node) return null
      const el = ctx.renderer.domElement
      const s = projectToScreen(displayPosition(ctx, node, _v1), ctx.camera, el.clientWidth, el.clientHeight)
      return { x: Math.round(s.x), y: Math.round(s.y) }
    },

    /**
     * ラベルの状態を返す(デバッグ用。深さフェードの確認に使う)。
     * delta は現在地との深さの差(正ほど奥)、fade は補間後の深さフェード
     */
    getLabelState() {
      const ctx = ctxRef.current
      if (!ctx) return []
      const current = ctx.currentId ? ctx.nodes.get(ctx.currentId) : null
      ctx.camera.getWorldDirection(_forward)
      const depthOf = (n) => viewDepth(displayPosition(ctx, n, _v1), ctx.camera, _forward)
      const base = current ? depthOf(current) : 0
      return Array.from(ctx.nodes.values()).map((n) => ({
        id: n.id,
        tier: n.tier,
        // selected = 今回選ばれた(表示の目標)。visible は出入りのフェード中も true
        selected: n.labelShowTarget > 0,
        visible: !!(n.label && n.label.visible),
        delta: Math.round((depthOf(n) - base) * 10) / 10,
        fade: Math.round(n.labelFade * 1000) / 1000,
        opacity: n.label ? Math.round(n.label.material.opacity * 1000) / 1000 : 0,
        reason: n._labelReason,
      }))
    },

    /**
     * 1フレーム分のラベル処理(深さフェードの目標・補間・間引き)を n 回まわして
     * かかった時間(ms)を返す(デバッグ用。ノードが多いときの負荷の確認に使う)
     */
    measureLabelWork(n = 100) {
      const ctx = ctxRef.current
      if (!ctx) return null
      const started = performance.now()
      for (let i = 0; i < n; i++) {
        updateVisuals(ctx, performance.now() / 1000, 1 / 60)
        updateLabelVisibility(ctx)
      }
      return (performance.now() - started) / n
    },

    /**
     * レイアウト計算を同期的に n ステップ進める(デバッグ用)。
     * 描画のフレームに関係なく決まった回数だけ進められるので、
     * 環境が違っても「同じ回数進めた結果」を比較できる
     */
    stepLayout(n = 1) {
      const ctx = ctxRef.current
      if (!ctx) return
      for (let i = 0; i < n; i++) {
        stepSimulation(ctx)
        ctx.simSteps += 1
      }
    },

    /** グラフ全体が収まるようカメラを引く */
    zoomToFit(duration = 700, padding = FIT_PADDING) {
      const ctx = ctxRef.current
      if (!ctx || ctx.nodes.size === 0) return
      ctx.followId = null

      // 距離の式は画面上の見え方の測定(SPEC 12.5)と共有する
      const fit = fitCamera(ctx.nodes.values(), ctx.camera.fov, padding, FIT_MIN_RADIUS)
      const center = new THREE.Vector3(fit.center.x, fit.center.y, fit.center.z)
      const distance = fit.distance

      const dir = ctx.camera.position.clone().sub(ctx.controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
      dir.normalize()

      startTween(ctx, {
        endPosition: center.clone().add(dir.multiplyScalar(distance)),
        endTarget: center,
        duration,
        ease: easeInOut,
      })
    },

    /**
     * クリックしたノードへカメラを飛ばす(TRAVEL_MS)。
     * 見る角度と距離は保ったまま注視点だけを移す。移動中は目的地以外を減光する。
     * 到着後は followNode に引き継ぎ、レイアウトで動く目的地を追い続ける。
     */
    travelTo(id) {
      const ctx = ctxRef.current
      if (!ctx || !ctx.nodes.has(id)) return
      ctx.followId = null
      const dir = ctx.camera.position.clone().sub(ctx.controls.target)
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
      startTween(ctx, {
        nodeId: id, // 目的地はレイアウトで動くので毎フレーム追い直す
        offset: dir,
        duration: TRAVEL_MS,
        ease: easeTravel,
        onDone: () => {
          ctx.travel = null
          ctx.followId = id
          applyHighlight(ctx)
        },
      })
      ctx.travel = { id }
      applyHighlight(ctx)
    },

    /**
     * 指定ノードを追い続ける。
     * 展開直後のノードはレイアウトが落ち着くまで動き回るので、
     * 一度きりのカメラ移動だと着いた頃には対象がずれている。
     * 手動でカメラを操作した時点で追従はやめる。
     */
    followNode(id) {
      const ctx = ctxRef.current
      if (!ctx || !ctx.nodes.has(id)) return
      ctx.tween = null
      ctx.followId = id
    },

    /** 注視点に向かってカメラを寄せる(factor<1)/引く(factor>1) */
    zoomBy(factor) {
      const ctx = ctxRef.current
      if (!ctx || ctx.tween) return
      const target = ctx.controls.target.clone()
      const offset = ctx.camera.position.clone().sub(target).multiplyScalar(factor)
      startTween(ctx, {
        endPosition: target.clone().add(offset),
        endTarget: target,
        duration: ZOOM_TWEEN_MS,
        ease: easeInOut,
      })
    },

    /**
     * ノードを短く震わせる(追加表示の瞬間。SPEC 6.8)。
     * ratio は振幅の倍率(上限に達して追加できないときは小さく震わせる)
     */
    shakeNode(id, ratio = 1) {
      const ctx = ctxRef.current
      if (!ctx || !ctx.nodes.has(id)) return
      ctx.shake = { id, start: performance.now(), amp: MORE_SHAKE_PX * ratio }
    },

    /**
     * 次のグラフ更新で新しく現れるノード ids を、originId の位置から出現させる。
     * graphData を更新する前に呼ぶこと。合わせてシミュレーションを再加熱し、外へ広がらせる
     */
    spawnFrom(originId, ids) {
      const ctx = ctxRef.current
      if (!ctx) return
      for (const id of ids) ctx.pendingSpawn.set(id, originId)
    },

    /** ラベルを ms の間、優先して表示する(何が増えたか読めるように) */
    boostLabels(ids, ms) {
      const ctx = ctxRef.current
      if (!ctx) return
      const until = performance.now() + ms
      for (const id of ids) ctx.labelBoost.set(id, until)
      updateLabelVisibility(ctx)
    },

    zoomIn() {
      this.zoomBy(1 / ZOOM_STEP)
    },
    zoomOut() {
      this.zoomBy(ZOOM_STEP)
    },
  }))

  return <div className="graph-canvas" ref={containerRef} />
})

// ==========================================================================
// グラフデータをシーンに同期する
// 既存ノードの位置は保持し、新規ノードだけを追加する
// ==========================================================================
/** ノードの初期位置を (seed, 記事名) から決める */
function spawnPosition(ctx, node) {
  const random = seededRandom(ctx.seed, node.id)
  // 追加表示で足したノードは現在地から生やす(SPEC 6.8)。
  // 現在地の位置はその時点のレイアウト次第なので、この場合の配置は URL から再現できない
  // (追加分は URL に保存しない仕様なので、経路の復元には影響しない)
  const origin = ctx.nodes.get(ctx.pendingSpawn.get(node.id))
  if (origin) {
    node.x = origin.x + (random() - 0.5) * MORE_SPAWN_JITTER
    node.y = origin.y + (random() - 0.5) * MORE_SPAWN_JITTER
    node.z = origin.z + (random() - 0.5) * MORE_SPAWN_JITTER
    return
  }
  // 初期位置の決め方は画面上の見え方の測定(SPEC 12.5)と共有する
  spawnScatter(random, node)
}

function syncGraph(ctx, graphData, currentId) {
  const { scene } = ctx
  const incomingIds = new Set(graphData.nodes.map((n) => n.id))
  ctx.currentId = currentId

  // 顔ぶれ(ノード・リンクの集合)が変わったかどうか。
  // 閲覧数が届いて大きさだけ変わる更新では、レイアウト計算を再開しない
  // (再開すると球が育つたびに全体が揺れ直してしまう)
  let structureChanged = false

  // --- 消えたノードを削除(古い枝を畳んだとき / 再検索したとき) ---
  for (const [id, node] of ctx.nodes) {
    if (!incomingIds.has(id)) {
      structureChanged = true
      scene.remove(node.sprite)
      node.sprite.material.dispose()
      if (node.label) {
        scene.remove(node.label)
        node.label.material.dispose()
      }
      ctx.nodes.delete(id)
    }
  }

  // --- 新規ノードを追加 ---
  for (const data of graphData.nodes) {
    let node = ctx.nodes.get(data.id)
    if (!node) {
      structureChanged = true
      // 初期位置は原点付近にばらまく(完全に同一座標だと反発力が発散する)。
      // 位置は (seed, 記事名) から決めるので、同じ種なら同じ場所に生まれる
      node = {
        id: data.id,
        name: data.name || data.id,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        layer: 'front',
        basePx: NODE_PX_SECONDARY,
        baseOpacity: 1,
        // 見た目の現在値と目標値。毎フレーム目標へ補間する(ホバーの 0.2 秒遷移)
        vis: { scale: 1, opacity: 1, labelBright: 0 },
        target: { scale: 1, opacity: 1, labelBright: 0 },
        // ラベルの深さフェード(SPEC 6.3)。labelFade は補間後、labelFadeTarget は毎フレームの目標
        labelFade: 1,
        labelFadeTarget: 1,
        // ラベルの出入り(選ばれた / 選ばれなくなった)のフェード。labelShowTarget は選ばれていれば 1
        labelShow: 0,
        labelShowTarget: 0,
        // 出入りの進み具合(等速で 0〜1)。labelShow はこれを smoothstep にかけたもの
        labelShowLinear: 0,
      }
      spawnPosition(ctx, node)
      const material = new THREE.SpriteMaterial({
        map: ctx.discTexture,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: false,
      })
      node.sprite = new THREE.Sprite(material)
      node.sprite.userData.node = node
      scene.add(node.sprite)

      node.label = makeLabel(ctx, node.name, false)
      scene.add(node.label)

      ctx.nodes.set(node.id, node)
    }
    node.views = data.views || 0
    node.expanded = !!data.expanded
    node.isCurrent = data.id === currentId
  }

  // --- リンクをidの組として保持 ---
  const prevLinkCount = ctx.links.length
  ctx.links = graphData.links
    .map((l) => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      primary: false,
      bright: 0,
      brightTarget: 0,
      // 線の種類と関連の強さ(SPEC 6.9)。buildGraph が付ける
      type: l.type,
      relScore: l.relScore || 0,
      mutual: l.mutual ? 1 : 0,
      sharedCount: l.sharedCount || 0,
      springLength: 0,
    }))
    .filter((l) => ctx.nodes.has(l.source) && ctx.nodes.has(l.target))
  // 線ごとのバネの自然長。毎ステップ計算せず、ここと力学の設定の変更時にだけ決める
  // (stepSimulation の内側のループを重くしないため)
  for (const link of ctx.links) link.springLength = computeEdgeSpringLength(link, ctx.layout)
  if (ctx.links.length !== prevLinkCount) structureChanged = true

  // --- 隣接表を作る(ハイライトのたびにリンク配列を走査しないため) ---
  ctx.adjacency = new Map()
  for (const id of ctx.nodes.keys()) ctx.adjacency.set(id, new Set())
  for (const link of ctx.links) {
    ctx.adjacency.get(link.source).add(link.target)
    ctx.adjacency.get(link.target).add(link.source)
  }

  // --- 階層(起点/一次/二次)と見た目を決める ---
  const currentNeighbors = currentId ? ctx.adjacency.get(currentId) : null
  for (const node of ctx.nodes.values()) {
    const isCurrent = node.isCurrent
    const isPrimary = !!(currentNeighbors && currentNeighbors.has(node.id))
    // 大きさの決め方は画面上の見え方の測定(SPEC 12.5)と共有する
    const style = nodeTierStyle({ isCurrent, isPrimary, expanded: node.expanded, views: node.views })
    node.tier = style.tier
    node.visited = style.visited
    node.basePx = style.basePx
    // 前景 = 起点+一次、背景 = 二次。パララックスの揺れ方が変わる
    node.layer = node.tier <= 1 ? 'front' : 'back'
    node.baseOpacity = node.tier === 2 ? NODE_SECONDARY_OPACITY : 1

    // 訪問済みは中空、未訪問は塗り。現在地は塗り
    const map = node.visited ? ctx.hollowTexture : ctx.discTexture
    if (node.sprite.material.map !== map) node.sprite.material.map = map

    // 起点のラベルだけ太字・大きめ・真下に置く
    const wantBold = isCurrent
    if (node.label.userData.bold !== wantBold) {
      scene.remove(node.label)
      node.label.material.dispose()
      node.label = makeLabel(ctx, node.name, wantBold)
      scene.add(node.label)
    }
  }

  for (const link of ctx.links) {
    link.primary = link.source === currentId || link.target === currentId
    link.bright = link.primary
      ? ctx.visual.edgePrimaryOpacity
      : ctx.visual.edgeWeakOpacity
  }
  ctx.linkByKey = new Map()
  for (const link of ctx.links) {
    ctx.linkByKey.set(`${link.source}->${link.target}`, link)
    ctx.linkByKey.set(`${link.target}->${link.source}`, link)
  }

  rebuildEdgeBuffers(ctx)

  // 出現位置の指定は今回の同期で使い切る(残すと後の再表示まで現在地から生えてしまう)
  ctx.pendingSpawn.clear()

  // 遷移中に目的地が消えた(再検索など)ら遷移状態を捨てる
  if (ctx.travel && !ctx.nodes.has(ctx.travel.id)) ctx.travel = null

  applyHighlight(ctx)
  updateLabelVisibility(ctx)

  if (structureChanged) {
    ctx.alpha = 1
    console.info(
      '[Graph3D] scene updated: nodes=%d, links=%d',
      ctx.nodes.size,
      ctx.links.length
    )
  }
}

// ==========================================================================
// 線分用のバッファを張り直す
//
// 線は 実線/破線 × 通常/太線 の4つのメッシュに振り分ける。
// 太線は相互リンクの強調(mutualEmphasis。SPEC 6.9)が on のときの、中心同士(trail)の相互リンクだけ。
// 子への線は相互リンクでも対象にしない(表示される子はほぼ全部が相互リンクで、全部が脈打ってしまうため)。
// off のときは太線を使わず、従来とまったく同じ描き方になる(current・rev2 の見た目を保つ)
// ==========================================================================
function rebuildEdgeBuffers(ctx) {
  let solid = 0
  let dashed = 0
  let wideSolid = 0
  let wideDashed = 0
  for (const link of ctx.links) {
    link.wide = isEmphasizedEdge(link, ctx.visual)
    if (link.wide && link.primary) wideSolid++
    else if (link.wide) wideDashed++
    else if (link.primary) solid++
    else dashed++
  }

  const rebuildBasic = (mesh, count) => {
    mesh.geometry.dispose()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(count * 6), 3)
    )
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(count * 6), 3)
    )
    mesh.geometry = geometry
  }
  rebuildBasic(ctx.edgeSolid, solid)
  rebuildBasic(ctx.edgeDashed, dashed)

  // 太線は配列を1回だけ確保し、毎フレームはその中身を書き換える
  // (setPositions は呼ぶたびにバッファを作り直すので、毎フレームは呼ばない)
  const rebuildWide = (mesh, count, withDistances) => {
    mesh.geometry.dispose()
    const geometry = new LineSegmentsGeometry()
    mesh.visible = count > 0
    if (count > 0) {
      geometry.setPositions(new Float32Array(count * 6))
      geometry.setColors(new Float32Array(count * 6))
      if (withDistances) {
        // 破線の模様の起点。通常の破線(LineSegments)と同じく、線ごとに 0 から数える
        const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(count * 2), 2, 1)
        geometry.setAttribute(
          'instanceDistanceStart',
          new THREE.InterleavedBufferAttribute(buffer, 1, 0)
        )
        geometry.setAttribute(
          'instanceDistanceEnd',
          new THREE.InterleavedBufferAttribute(buffer, 1, 1)
        )
      }
    }
    mesh.geometry = geometry
  }
  rebuildWide(ctx.wideSolid, wideSolid, false)
  rebuildWide(ctx.wideDashed, wideDashed, true)
  applyWideLineWidth(ctx)
}

/** 太線の太さ。linewidth は通常の線(1 デバイスピクセル)に対する倍率(resize の resolution を参照) */
function applyWideLineWidth(ctx) {
  ctx.wideSolidMaterial.linewidth = ctx.visual.mutualWidthMultiplier
  ctx.wideDashedMaterial.linewidth = ctx.visual.mutualWidthMultiplier
}

// ==========================================================================
// ホバー時の隣接ハイライト (SPEC 6.1) と遷移中の減光
//
// ここでは「目標値」だけを決める。実際の見た目は updateVisuals が
// 毎フレーム目標へ補間する(HOVER_TRANSITION_S で滑らかに切り替わる)。
// ==========================================================================
function applyHighlight(ctx) {
  // グラフが変わってホバー中のノードが消えている場合はホバーなしとして扱う
  const hoveredId =
    ctx.hoveredId && ctx.adjacency.has(ctx.hoveredId) ? ctx.hoveredId : null
  const neighbors = hoveredId ? ctx.adjacency.get(hoveredId) : null
  const travelId = ctx.travel ? ctx.travel.id : null

  for (const node of ctx.nodes.values()) {
    const t = node.target
    t.scale = 1
    t.labelBright = 0
    t.opacity = node.baseOpacity

    if (hoveredId) {
      if (node.id === hoveredId) {
        t.scale = HOVER_SCALE
        t.labelBright = 1
      } else if (!(neighbors && neighbors.has(node.id))) {
        t.opacity = node.baseOpacity * HOVER_DIM_RATIO
      }
    }
    // 遷移中は目的地だけを主役にする
    if (travelId && node.id !== travelId) {
      t.opacity = Math.min(t.opacity, TRAVEL_DIM_OPACITY)
    }
  }

  for (const link of ctx.links) {
    const base = link.primary
      ? ctx.visual.edgePrimaryOpacity
      : ctx.visual.edgeWeakOpacity
    let bright = base
    if (hoveredId) {
      if (link.source === hoveredId || link.target === hoveredId) {
        bright = EDGE_HOVER_OPACITY
      } else {
        bright = base * HOVER_DIM_RATIO
      }
    }
    if (travelId && link.source !== travelId && link.target !== travelId) {
      bright = Math.min(bright, TRAVEL_DIM_OPACITY)
    }
    link.brightTarget = bright
  }
}

// ==========================================================================
// ラベルの深さフェード (SPEC 6.3)
//
// 現在地より奥にあるラベルほど薄くし、fadeEnd より奥では消す。
// 深さ = カメラの視線方向に沿った距離(表示位置 displayPosition で測る)。
//   delta = depth(ノード) − depth(現在地)   正の値ほど現在地より奥
// 現在地とホバー中のノードは常に 1(どの角度でも読めるように)。
// ここでは目標値だけを決める。実際の不透明度は updateVisuals がホバーと同じ方式で補間する
// (ラベルの選び直しは 200ms 間隔なので、それに合わせるとカクつくため)
// ==========================================================================
function updateDepthFadeTargets(ctx) {
  const { labelDepthFade, fadeStart, fadeEnd } = ctx.visual
  const current = ctx.currentId ? ctx.nodes.get(ctx.currentId) : null
  if (!labelDepthFade || !current) {
    for (const node of ctx.nodes.values()) node.labelFadeTarget = 1
    return
  }
  const camera = ctx.camera
  camera.getWorldDirection(_forward)
  const depthOf = (node) => viewDepth(displayPosition(ctx, node, _v1), camera, _forward)
  const baseDepth = depthOf(current)
  for (const node of ctx.nodes.values()) {
    if (node.isCurrent || node.id === ctx.hoveredId) {
      node.labelFadeTarget = 1
    } else {
      node.labelFadeTarget = depthFadeOf(depthOf(node) - baseDepth, fadeStart, fadeEnd)
    }
  }
}

// ==========================================================================
// 見た目の補間(ホバー・遷移の 0.2 秒トランジション、起点の呼吸、取得中の脈動)
// ==========================================================================
function updateVisuals(ctx, t, dt) {
  // 指数補間: HOVER_TRANSITION_S でおおむね目標に達する
  const k = 1 - Math.exp(-dt / (HOVER_TRANSITION_S / 3))

  updateDepthFadeTargets(ctx)
  const swapFade = ctx.visual.labelDepthFade
  // 出入りは等速で進め、見た目は smoothstep で「ゆっくり始まってゆっくり終わる」にする
  const swapStep = dt / LABEL_SWAP_S

  // 取得中のノードの脈動。関連記事の取得には数秒かかることがあるので、
  // クリックしたノード自身を動かして「今これを取りに行っている」ことを示す
  if (ctx.pulsePrev && ctx.pulsePrev !== ctx.loadingId) ctx.pulsePrev = null
  const pulseScale = 1 + 0.3 * Math.sin(t * 7)
  if (ctx.loadingId) ctx.pulsePrev = ctx.loadingId

  // 起点の呼吸(ease-in-out のループ)
  const breath = (1 - Math.cos((t / BREATH_PERIOD_S) * Math.PI * 2)) / 2

  for (const node of ctx.nodes.values()) {
    const v = node.vis
    const g = node.target
    v.scale += (g.scale - v.scale) * k
    v.opacity += (g.opacity - v.opacity) * k
    v.labelBright += (g.labelBright - v.labelBright) * k
    node.labelFade += (node.labelFadeTarget - node.labelFade) * k
    // ラベルの出入り。深さフェードが有効なときは LABEL_SWAP_S をかけて出し入れし、
    // 無効なとき(current)は従来どおり即座に切り替える
    if (swapFade) {
      node.labelShowLinear = approach(node.labelShowLinear, node.labelShowTarget, swapStep)
      node.labelShow = smoothstep(node.labelShowLinear)
      if (node.label) node.label.visible = node.labelShowTarget > 0 || node.labelShowLinear > 0
    } else {
      node.labelShowLinear = node.labelShow = node.labelShowTarget
    }

    let px = node.basePx
    if (node.isCurrent) {
      px = NODE_PX_CURRENT + (NODE_PX_CURRENT_MAX - NODE_PX_CURRENT) * breath
    }
    let scale = v.scale
    if (node.id === ctx.loadingId) scale *= pulseScale

    const ratio = node.sprite.material.map.userData.circleRatio || 1
    const s = spriteScaleFromPx(ctx, (px * 2 * scale) / ratio)
    node.sprite.scale.set(s, s, 1)
    node.sprite.material.opacity = v.opacity

    if (node.label) {
      node.label.material.color.copy(LABEL_BASE_COLOR).lerp(LABEL_HOVER_COLOR_OBJ, v.labelBright)
      // ホバーの減光などの不透明度に、深さフェードを掛ける
      node.label.material.opacity = v.opacity * node.labelFade * node.labelShow
      // 出入りの途中は少し下にずらす(現れるときは浮かび上がり、消えるときは沈む)。
      // 置き場所(アンカー)は updateLabelVisibility が決め、ここではずらしだけを足す
      if (node._anchorX !== undefined) {
        const rise = swapFade ? ((1 - node.labelShow) * LABEL_SWAP_RISE_PX) / node.label.userData.px : 0
        node.label.center.set(node._anchorX, node._anchorY + rise)
      }
    }
  }

  // 起点の外周リング
  const current = ctx.currentId ? ctx.nodes.get(ctx.currentId) : null
  if (current) {
    const ringPx = RING_PX_MIN + (RING_PX_MAX - RING_PX_MIN) * breath
    const ratio = ctx.ringTexture.userData.circleRatio || 1
    const s = spriteScaleFromPx(ctx, (ringPx * 2) / ratio)
    ctx.ring.scale.set(s, s, 1)
    ctx.ringMaterial.opacity =
      (RING_OPACITY_MAX + (RING_OPACITY_MIN - RING_OPACITY_MAX) * breath) * current.vis.opacity
    ctx.ring.visible = true
  } else {
    ctx.ring.visible = false
  }

  for (const link of ctx.links) {
    link.bright += (link.brightTarget - link.bright) * k
  }

  // 相互リンクの脈動(SPEC 6.9)。ホバー・遷移の減光を補間した後の明るさに、
  // 描くときに最後に掛ける(暗くしてある線が脈動で急に目立たないように)
  const { mutualEmphasis, mutualPulseAmplitude, mutualPulseSpeed } = ctx.visual
  ctx.mutualPulse = mutualEmphasis
    ? mutualPulseFactor(t, mutualPulseAmplitude, mutualPulseSpeed)
    : 1
}

// ==========================================================================
// 今の状態を1回だけ描く(リサイズ直後の空フレームを防ぐ)
//
// 時間を進めない(dt=0)ので、補間中の値はそのままの見た目で描かれる。
// ラベルの再配置は重いので呼ばない(次の通常フレームで追いつく)
// ==========================================================================
function renderNow(ctx, t) {
  updateVisuals(ctx, t, 0)
  updatePositions(ctx)
  updateGrid(ctx, t)
  updatePackets(ctx, t)
  ctx.renderer.render(ctx.scene, ctx.camera)
}

// ==========================================================================
// パララックスドリフト
// 背景と前景を別の周期で往復させ、視差で奥行きを出す。振幅は px 相当なので
// カメラの注視点までの距離でワールド座標に換算する
// ==========================================================================
function updateDrift(ctx, t) {
  const depth = ctx.camera.position.distanceTo(ctx.controls.target)
  const unit = worldPerPx(ctx, depth)
  // カメラの右・上方向に揺らす(画面上で左右・上下に見えるように)
  _v2.setFromMatrixColumn(ctx.camera.matrixWorld, 0) // right
  _v3.setFromMatrixColumn(ctx.camera.matrixWorld, 1) // up

  const back = (1 - Math.cos((t / DRIFT_BACK.periodS) * Math.PI * 2)) / 2
  const front = (1 - Math.cos((t / DRIFT_FRONT.periodS) * Math.PI * 2)) / 2

  ctx.driftBack
    .copy(_v2)
    .multiplyScalar(DRIFT_BACK.x * back * unit)
    .addScaledVector(_v3, DRIFT_BACK.y * back * unit)
  ctx.driftFront
    .copy(_v2)
    .multiplyScalar(DRIFT_FRONT.x * front * unit)
    .addScaledVector(_v3, DRIFT_FRONT.y * front * unit)
}

// ==========================================================================
// 追加表示の震え (SPEC 6.8)
// 画面の左右方向に、減衰しながら MORE_SHAKE_CYCLES 回往復させる。
// 振幅は px 指定なので、ドリフトと同じく注視点までの距離でワールド座標に換算する
// ==========================================================================
function updateShake(ctx, now) {
  const shake = ctx.shake
  if (!shake) return
  const p = (now - shake.start) / MORE_SHAKE_MS
  if (p >= 1 || !ctx.nodes.has(shake.id)) {
    ctx.shake = null
    ctx.shakeOffset.set(0, 0, 0)
    return
  }
  const depth = ctx.camera.position.distanceTo(ctx.controls.target)
  const px = shake.amp * (1 - p) * Math.sin(p * MORE_SHAKE_CYCLES * Math.PI * 2)
  ctx.shakeOffset
    .setFromMatrixColumn(ctx.camera.matrixWorld, 0) // カメラの右方向
    .multiplyScalar(px * worldPerPx(ctx, depth))
}

// ==========================================================================
// 計算済みの座標をThree.jsのオブジェクトに反映する
// ==========================================================================
function updatePositions(ctx) {
  for (const node of ctx.nodes.values()) {
    displayPosition(ctx, node, _v1)
    node.sprite.position.copy(_v1)
    if (node.label) node.label.position.copy(_v1)
  }

  const current = ctx.currentId ? ctx.nodes.get(ctx.currentId) : null
  if (current) ctx.ring.position.copy(displayPosition(ctx, current, _v1))

  // 線分の座標と明るさ(実線・破線 × 通常・太線 それぞれのバッファに詰める)
  const solidPos = ctx.edgeSolid.geometry.getAttribute('position')
  const solidCol = ctx.edgeSolid.geometry.getAttribute('color')
  const dashPos = ctx.edgeDashed.geometry.getAttribute('position')
  const dashCol = ctx.edgeDashed.geometry.getAttribute('color')
  if (!solidPos || !dashPos) return
  // 太線(相互リンクの強調)。無いときは attribute も無い
  const wideSolidGeo = ctx.wideSolid.geometry
  const wideDashGeo = ctx.wideDashed.geometry
  const wsPos = wideSolidGeo.attributes.instanceStart?.data
  const wsCol = wideSolidGeo.attributes.instanceColorStart?.data
  const wdPos = wideDashGeo.attributes.instanceStart?.data
  const wdCol = wideDashGeo.attributes.instanceColorStart?.data
  const wdDist = wideDashGeo.attributes.instanceDistanceStart?.data
  let si = 0
  let di = 0
  let wsi = 0
  let wdi = 0
  for (const link of ctx.links) {
    const a = ctx.nodes.get(link.source)
    const b = ctx.nodes.get(link.target)
    if (!a || !b) continue
    let pos
    let col
    let i
    if (link.wide) {
      pos = link.primary ? wsPos.array : wdPos.array
      col = link.primary ? wsCol.array : wdCol.array
      i = link.primary ? wsi : wdi
    } else {
      pos = link.primary ? solidPos.array : dashPos.array
      col = link.primary ? solidCol.array : dashCol.array
      i = link.primary ? si : di
    }
    displayPosition(ctx, a, _v1)
    displayPosition(ctx, b, _v2)
    pos[i] = _v1.x
    pos[i + 1] = _v1.y
    pos[i + 2] = _v1.z
    pos[i + 3] = _v2.x
    pos[i + 4] = _v2.y
    pos[i + 5] = _v2.z
    // 脈動は太線(=強調中の相互リンク)にだけ掛ける
    const bright = link.wide ? link.bright * ctx.mutualPulse : link.bright
    for (let j = 0; j < 6; j++) col[i + j] = bright
    if (link.wide && !link.primary) {
      // 破線の模様は線ごとに 0 から数える
      const d = (wdi / 6) * 2
      wdDist.array[d] = 0
      wdDist.array[d + 1] = _v1.distanceTo(_v2)
    }
    if (link.wide) {
      if (link.primary) wsi += 6
      else wdi += 6
    } else if (link.primary) si += 6
    else di += 6
  }
  solidPos.needsUpdate = true
  solidCol.needsUpdate = true
  dashPos.needsUpdate = true
  dashCol.needsUpdate = true
  if (wsPos) {
    wsPos.needsUpdate = true
    wsCol.needsUpdate = true
  }
  if (wdPos) {
    wdPos.needsUpdate = true
    wdCol.needsUpdate = true
    wdDist.needsUpdate = true
  }
  // 破線は頂点ごとの累積距離が必要。座標が毎フレーム動くので毎回計算し直す
  if (dashPos.count > 0) ctx.edgeDashed.computeLineDistances()
}

// ==========================================================================
// 背景グリッド: 起点に追従し、カメラに正対させ、px 指定の半径をワールド座標に換算する
// ==========================================================================
function updateGrid(ctx, t) {
  const current = ctx.currentId ? ctx.nodes.get(ctx.currentId) : null
  if (!current) {
    ctx.grid.visible = false
    return
  }
  ctx.grid.visible = true
  // グリッドは背景レイヤーなので背景のドリフトに乗せる
  ctx.grid.position.set(
    current.x + ctx.driftBack.x,
    current.y + ctx.driftBack.y,
    current.z + ctx.driftBack.z
  )
  ctx.grid.quaternion.copy(ctx.camera.quaternion)
  const depth = ctx.camera.position.distanceTo(ctx.grid.position)
  const s = worldPerPx(ctx, depth)
  ctx.grid.scale.set(s, s, s)
  ctx.radials.rotation.z = ((t / GRID_ROTATION_PERIOD_S) % 1) * Math.PI * 2
}

// ==========================================================================
// データパケット (SPEC 6.7): 経路(記事名の列)に沿って流れる点
//   通常        … [現在地, 子]           1区間
//   共通ワード  … [1つ前の中心, 共通ワード, 現在地]  2区間(sharedPackets。SPEC 6.9)
// どの区間も同じ速さで進む(1周の時間 = PACKET_PERIOD_S × 区間数)。継ぎ目で止めない
// ==========================================================================
function updatePackets(ctx, t) {
  const ratio = ctx.discTexture.userData.circleRatio || 1
  const s = spriteScaleFromPx(ctx, (PACKET_PX * 2) / ratio)
  // 共通ワードを通るパケットは少し大きくする(前後の記事のつながりを示す点。SPEC 6.9)
  const sShared = spriteScaleFromPx(ctx, (ctx.visual.sharedPacketPx * 2) / ratio)

  for (let i = 0; i < ctx.packets.length; i++) {
    const sprite = ctx.packets[i]
    const route = ctx.currentId ? ctx.packetRoutes[i] : null
    const segments = route ? route.length - 1 : 0
    // 経路上のノードと線がすべて画面にあるときだけ流す
    let ok = segments >= 1
    for (let k = 0; ok && k < segments; k++) {
      ok =
        ctx.nodes.has(route[k]) &&
        ctx.nodes.has(route[k + 1]) &&
        ctx.linkByKey.has(`${route[k]}->${route[k + 1]}`)
    }
    if (!ok) {
      sprite.visible = false
      continue
    }
    // 開始タイミングを PACKET_STAGGER_S ずつずらす
    const period = PACKET_PERIOD_S * segments
    const local = t - i * PACKET_STAGGER_S
    const phase = ((local % period) + period) % period / period
    const seg = Math.min(Math.floor(phase * segments), segments - 1)
    const from = ctx.nodes.get(route[seg])
    const to = ctx.nodes.get(route[seg + 1])
    const link = ctx.linkByKey.get(`${from.id}->${to.id}`)

    displayPosition(ctx, from, _v1)
    displayPosition(ctx, to, _v2)
    sprite.position.lerpVectors(_v1, _v2, phase * segments - seg)
    const size = segments >= 2 ? sShared : s
    sprite.scale.set(size, size, 1)

    // 不透明度 0→1→1→0(端で唐突に消えないように)。経路全体に対して掛ける
    let opacity
    if (phase < 1 / 3) opacity = phase * 3
    else if (phase < 2 / 3) opacity = 1
    else opacity = (1 - phase) * 3
    // ホバー/遷移で線が減光しているときはパケットも一緒に落とす。
    // 基準はその線の普段の明るさ(共通ワードの経路は破線=薄い線も通るので、
    // 実線の明るさを基準にすると、破線の区間だけパケットが暗くなってしまう)
    const base = link.primary ? ctx.visual.edgePrimaryOpacity : ctx.visual.edgeWeakOpacity
    const linkFactor = Math.min(link.bright / (base || 1), 1)
    sprite.material.opacity = opacity * linkFactor
    sprite.visible = true
  }
}

// ==========================================================================
// ラベルの間引き (SPEC 6.3)
//
// 「カメラから近い順にN件」だけでは、近いもの同士が普通に重なって読めない。
// 実際に画面上の矩形を求めて、先に確定したラベルと重なるものは捨てる。
// ラベルはノードの右(画面外に出るなら左)、起点だけは真下に置く。
// ==========================================================================
function updateLabelVisibility(ctx) {
  const hoveredId =
    ctx.hoveredId && ctx.adjacency.has(ctx.hoveredId) ? ctx.hoveredId : null
  const neighbors = hoveredId ? ctx.adjacency.get(hoveredId) : null

  // 追加表示で足したノードは、しばらく一次ノードより先にラベルを出す(SPEC 6.8)
  const now = performance.now()
  for (const [id, until] of ctx.labelBoost) {
    if (until <= now || !ctx.nodes.has(id)) ctx.labelBoost.delete(id)
  }

  // どれを出すかの判断は labelSelect.js(画面上の見え方の測定と共有する。SPEC 12.5)。
  // ここでは入力を集めて、結果をスプライトに反映するだけにする
  const fadeOn = ctx.visual.labelDepthFade
  const labeled = []
  const items = []
  for (const node of ctx.nodes.values()) {
    if (!node.label) continue
    // 前回選ばれていたか(候補の基準を分けるのと、表示中のラベルを優遇するため)。
    // 出入りのフェード中は label.visible が true のまま薄れていくので、visible ではなく選ばれたかで見る
    const wasSelected = node.labelShowTarget > 0
    node.labelShowTarget = 0
    // 出入りのフェードが無効なら従来どおり即座に隠す(有効なら updateVisuals が薄れさせてから隠す)
    if (!fadeOn) node.label.visible = false
    labeled.push(node)
    items.push({
      id: node.id,
      isCurrent: node.isCurrent,
      tier: node.tier,
      boosted: ctx.labelBoost.has(node.id),
      fadeTarget: node.labelFadeTarget,
      wasSelected,
      pos: displayPosition(ctx, node, new THREE.Vector3()),
      radiusPx: node.basePx * node.vis.scale,
      labelPx: node.label.userData.px,
      labelAspect: node.label.userData.aspect,
    })
  }

  const el = ctx.renderer.domElement
  const results = selectLabels(items, {
    camera: ctx.camera,
    width: el.clientWidth,
    height: el.clientHeight,
    hoveredId,
    neighbors,
    fadeOn,
    visibleLabels: ctx.visual.visibleLabels,
    keepBias: LABEL_KEEP_BIAS,
  })

  for (let i = 0; i < labeled.length; i++) {
    const node = labeled[i]
    const res = results[i]
    // 表示しなかった理由(デバッグ用。window.__viz.labels() で見る)
    node._labelReason = res.reason
    if (res.center) node.label.center.set(res.center.x, res.center.y)
    if (!res.selected) continue
    node._anchorX = res.center.x
    node._anchorY = res.center.y
    // 新たに選ばれたラベルは labelShow が 0 付近から上がる(フェードが有効なとき)ので浮かび上がる
    node.labelShowTarget = 1
    node.label.visible = true
  }
}

// ==========================================================================
// 力学シミュレーションの1ステップ
// ==========================================================================
function stepSimulation(ctx) {
  // 計算は forceLayout.js(画面上の見え方の測定と共有する。SPEC 12.5)。
  // ctx は nodes / links / layout / alpha / jitter を持つので、そのまま渡せる
  stepForces(ctx)
}

// ==========================================================================
// カメラ追従
//
// 注視点を現在地へ少しずつ寄せ、カメラも同じだけ平行移動させる。
// 見る角度と距離は変えないので、ユーザーが作った視点を壊さずに
// 「ついていく」だけになる。
// ==========================================================================
function updateFollow(ctx) {
  if (!ctx.followId || ctx.tween) return
  const node = ctx.nodes.get(ctx.followId)
  if (!node) {
    ctx.followId = null
    return
  }

  _v1.set(node.x, node.y, node.z)
  _v2.copy(_v1).sub(ctx.controls.target).multiplyScalar(ctx.visual.followLerp)
  ctx.controls.target.add(_v2)
  ctx.camera.position.add(_v2)
}

// ==========================================================================
// 記事名ラベル(Canvasに描いたテクスチャをSpriteとして表示)
// 画面上の高さを LABEL_PX で固定する(sizeAttenuation:false)
// ==========================================================================
function makeLabel(ctx, text, bold) {
  const display = labelDisplayText(text)
  const key = `${bold ? 'b' : 'r'}:${display}`

  let texture = ctx.labelTextures.get(key)
  if (!texture) {
    const canvas = document.createElement('canvas')
    const c = canvas.getContext('2d')
    const font = labelFont(bold)
    // 大きさの測り方は画面上の見え方の測定(SPEC 12.5)と共有する(ラベルの幅が重なり判定に効くため)
    const { width, height } = labelTextureSize(display, bold, c)
    canvas.width = width
    canvas.height = height

    // canvasのサイズを変えるとコンテキストの状態がリセットされるので再設定
    c.font = font
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    // 白で描き、色は material.color で付ける(ホバーで #cfcfcf → #fff に補間するため)
    c.fillStyle = '#ffffff'
    c.fillText(display, width / 2, height / 2)

    texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.userData.aspect = width / height
    ctx.labelTextures.set(key, texture)
  }

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: false,
    color: LABEL_BASE_COLOR.clone(),
  })
  const sprite = new THREE.Sprite(material)
  // テクスチャの高さ(padding込み)が画面上で labelPx になるように
  const labelPx = labelHeightPx(bold)
  const s = spriteScaleFromPx(ctx, labelPx)
  sprite.scale.set(s * texture.userData.aspect, s, 1)
  sprite.userData.px = labelPx
  sprite.userData.aspect = texture.userData.aspect
  sprite.userData.bold = bold
  sprite.renderOrder = 2
  sprite.visible = false
  return sprite
}

/** フォント読込後などに、既存ノードのラベルを描き直す */
function rebuildLabels(ctx) {
  for (const tex of ctx.labelTextures.values()) tex.dispose()
  ctx.labelTextures.clear()
  for (const node of ctx.nodes.values()) {
    if (!node.label) continue
    const bold = !!node.label.userData.bold
    ctx.scene.remove(node.label)
    node.label.material.dispose()
    node.label = makeLabel(ctx, node.name, bold)
    ctx.scene.add(node.label)
  }
  updateLabelVisibility(ctx)
}

// ==========================================================================
// カメラ移動のトゥイーン
//
// endPosition/endTarget を固定で渡すか、nodeId + offset を渡して
// 「動いているノードを追いながら飛ぶ」かのどちらか。
// ==========================================================================
function startTween(ctx, { endPosition, endTarget, nodeId, offset, duration, ease, onDone }) {
  ctx.tween = {
    startPosition: ctx.camera.position.clone(),
    startTarget: ctx.controls.target.clone(),
    endPosition: endPosition || null,
    endTarget: endTarget || null,
    nodeId: nodeId || null,
    offset: offset || null,
    startTime: performance.now(),
    duration: Math.max(duration, 1),
    ease: ease || easeInOut,
    onDone: onDone || null,
  }
}

function updateTween(ctx) {
  const tween = ctx.tween
  if (!tween) return

  const elapsed = performance.now() - tween.startTime
  const t = Math.min(elapsed / tween.duration, 1)
  const eased = tween.ease(t)

  let endTarget = tween.endTarget
  let endPosition = tween.endPosition
  if (tween.nodeId) {
    const node = ctx.nodes.get(tween.nodeId)
    if (!node) {
      ctx.tween = null
      if (tween.onDone) tween.onDone()
      return
    }
    // 目的地はレイアウトで動き続けるので、毎フレーム現在位置を取り直す
    endTarget = _v3.set(node.x, node.y, node.z)
    endPosition = _v2.copy(endTarget).add(tween.offset)
  }

  ctx.camera.position.lerpVectors(tween.startPosition, endPosition, eased)
  ctx.controls.target.lerpVectors(tween.startTarget, endTarget, eased)

  if (t >= 1) {
    ctx.tween = null
    if (tween.onDone) tween.onDone()
  }
}

export default Graph3D
