/**
 * 画面上の見え方の測定(SPEC 12.5。タスク06)の計算のテスト。
 *   src/utils/screenProjection.js … 投影・周回視点・上方向
 *   src/utils/screenMetrics.js    … 中央値・相関・混み具合・近すぎる組・点滅の数え方・プリセットの照合
 *   src/utils/forceLayout.js      … 全体を収める距離(zoomToFit の式)
 *   src/constants.js              … 仮想画面の大きさが App.css と揃っているか
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  projectToScreen,
  isOnScreen,
  viewDepth,
  makeViewCamera,
  orbitDirections,
  cameraUpFor,
} from '../src/utils/screenProjection.js'
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
} from '../src/utils/screenMetrics.js'
import { fitCamera, initialPosition } from '../src/utils/forceLayout.js'
import { nodeTierStyle, primaryPxFromViews } from '../src/utils/nodeStyle.js'
import { PRESETS } from '../src/config/presets.ts'
import {
  MEASURE_VIEWS,
  MEASURE_VIEWPORTS,
  MEASURE_CROWD_RADIUS_PX,
  GRID_RING_RADII_PX,
  CAMERA_FOV,
  NODE_PX_CURRENT,
  NODE_PX_VISITED,
  NODE_PX_SECONDARY,
  NODE_PX_PRIMARY_MIN,
  NODE_PX_PRIMARY_MAX,
} from '../src/constants.js'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

describe('投影(projectToScreen)', () => {
  // 原点から +z に 100 離れて原点を見る。描画領域 800×600
  const camera = makeViewCamera(800, 600, { x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 0 })

  test('注視点は描画領域の中央に来る', () => {
    const s = projectToScreen({ x: 0, y: 0, z: 0 }, camera, 800, 600)
    close(s.x, 400)
    close(s.y, 300)
    assert.equal(s.inFront, true)
    assert.equal(isOnScreen(s, 800, 600), true)
  })

  test('決まった点は決まった画面座標になる(縦の画角 60° で、上端までの距離は 100·tan30°)', () => {
    const top = 100 * Math.tan(Math.PI / 6)
    const s = projectToScreen({ x: 0, y: top, z: 0 }, camera, 800, 600)
    close(s.x, 400)
    close(s.y, 0, 1e-6) // 上端
    // 右へ半分 = 画面の中央から右へ 150px(縦 600px が 2·top に当たるので、1 単位 = 300/top px)
    const r = projectToScreen({ x: top / 2, y: 0, z: 0 }, camera, 800, 600)
    close(r.x, 400 + 150, 1e-6)
  })

  test('画面の外に出る点は inFront でも isOnScreen が false', () => {
    const s = projectToScreen({ x: 1000, y: 0, z: 0 }, camera, 800, 600)
    assert.equal(s.inFront, true)
    assert.equal(isOnScreen(s, 800, 600), false)
  })

  test('カメラの後ろにある点は inFront が false', () => {
    const s = projectToScreen({ x: 0, y: 0, z: 200 }, camera, 800, 600)
    assert.equal(s.inFront, false)
    assert.equal(isOnScreen(s, 800, 600), false)
  })

  test('視線方向の深さ(viewDepth)', () => {
    close(viewDepth({ x: 0, y: 0, z: 0 }, camera), 100)
    close(viewDepth({ x: 50, y: -20, z: -30 }, camera), 130)
  })

  test('縦の画角はアプリと同じ(CAMERA_FOV)', () => {
    assert.equal(camera.fov, CAMERA_FOV)
    assert.equal(camera.aspect, 800 / 600)
  })
})

describe('周回視点(orbitDirections)', () => {
  test('数が MEASURE_VIEWS どおりで、各方向が単位長さ', () => {
    const dirs = orbitDirections(MEASURE_VIEWS)
    assert.equal(dirs.length, MEASURE_VIEWS)
    for (const d of dirs) close(Math.hypot(d.x, d.y, d.z), 1, 1e-12)
  })

  test('毎回同じ並びになる', () => {
    assert.deepEqual(orbitDirections(MEASURE_VIEWS), orbitDirections(MEASURE_VIEWS))
  })

  test('上下に偏らない(y の合計がほぼ 0)', () => {
    const sum = orbitDirections(MEASURE_VIEWS).reduce((a, d) => a + d.y, 0)
    close(sum, 0, 1e-12)
  })

  test('上方向は (0,1,0)。視線が縦とほぼ平行なときだけ (0,0,1)', () => {
    assert.deepEqual(cameraUpFor({ x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 })
    assert.deepEqual(cameraUpFor({ x: 0.5, y: 0.8, z: 0 }), { x: 0, y: 1, z: 0 })
    assert.deepEqual(cameraUpFor({ x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 })
    assert.deepEqual(cameraUpFor({ x: 0.01, y: -1, z: 0 }), { x: 0, y: 0, z: 1 })
  })

  test('真上から見ても投影が壊れない(上方向の切り替えが効いている)', () => {
    const camera = makeViewCamera(800, 600, { x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, cameraUpFor({ x: 0, y: 1, z: 0 }))
    const s = projectToScreen({ x: 0, y: 0, z: 0 }, camera, 800, 600)
    close(s.x, 400, 1e-6)
    close(s.y, 300, 1e-6)
  })
})

describe('各項目の計算', () => {
  test('中央値(奇数・偶数・空)', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(median([]), null)
  })

  test('比(0 や null を含むときは null)', () => {
    assert.equal(ratio(1, 2), 0.5)
    assert.equal(ratio(null, 2), null)
    assert.equal(ratio(1, 0), null)
  })

  test('ピアソンの相関係数', () => {
    close(pearson([1, 2, 3], [2, 4, 6]), 1)
    close(pearson([1, 2, 3], [3, 2, 1]), -1)
    close(pearson([1, 2, 3, 4], [1, 3, 2, 4]), 0.8)
    assert.equal(pearson([1], [1]), null)
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null) // ばらつきが無い
  })

  test('混み具合: 半径以内(境界を含む)の点の数', () => {
    const pts = [{ x: 60, y: 0 }, { x: 0, y: 59 }, { x: 61, y: 0 }, { x: 43, y: 43 }]
    assert.equal(countWithin({ x: 0, y: 0 }, pts, 60), 2)
  })

  test('混み具合の半径は背景グリッドの一番内側の円と同じ', () => {
    assert.equal(MEASURE_CROWD_RADIUS_PX, GRID_RING_RADII_PX[0])
  })

  test('近すぎる組: 間隔が閾値未満の組を数え、中心を含む組は別に数える', () => {
    const pts = [
      { id: 'c', x: 0, y: 0 },
      { id: 'a', x: 10, y: 0 }, // c と 10
      { id: 'b', x: 20, y: 0 }, // a と 10、c と 20
      { id: 'd', x: 100, y: 0 },
    ]
    assert.deepEqual(closePairs(pts, 15, 'c'), { pairs: 1, centerPairs: 1 })
    assert.deepEqual(closePairs(pts, 32, 'c'), { pairs: 1, centerPairs: 2 })
    // ちょうど閾値は「未満」に入らない
    assert.deepEqual(closePairs(pts, 10, 'c'), { pairs: 0, centerPairs: 0 })
  })

  test('点滅: 消えてから 1 秒以内に再表示された回数を数える', () => {
    const f = createFlickerCounter(1000)
    f.update(0, ['a', 'b'])
    f.update(200, ['a']) // b が消える
    f.update(400, ['a', 'b']) // b が 200ms で戻る → 1回
    f.update(600, ['b']) // a が消える
    f.update(1700, ['a', 'b']) // a は 1100ms 後に戻る → 数えない
    f.update(1900, ['a', 'b', 'c']) // c は初めて出る → 数えない
    assert.equal(f.flickers, 1)
    assert.equal(f.updates, 6)
  })

  test('選び直しの間隔は表示と同じ「超えたら」(60fps で 13 フレームごと)', () => {
    const frame = 1000 / 60
    assert.equal(shouldReselect(12 * frame, 0, 200), false) // ちょうど 200ms
    assert.equal(shouldReselect(13 * frame, 0, 200), true)
  })

  test('周回視点の平均と最悪値(null は除く。悪い向きは項目ごと)', () => {
    const { mean, worst } = summarizeViews(
      [{ r: 0.5, n: 3 }, { r: 0.7, n: 1 }, { r: null, n: 2 }],
      { r: 'max', n: 'min' }
    )
    close(mean.r, 0.6)
    assert.equal(worst.r, 0.7)
    assert.equal(mean.n, 2)
    assert.equal(worst.n, 1)
  })

  test('丸め', () => {
    assert.equal(round(1.23456), 1.235)
    assert.equal(round(null), null)
  })
})

describe('プリセットの照合', () => {
  test('rev2 と rev3 は順位付けに効く値が同じなので通る', () => {
    assert.doesNotThrow(() =>
      assertSameRanking([
        { name: 'rev2', config: PRESETS.rev2 },
        { name: 'rev3', config: PRESETS.rev3 },
      ])
    )
  })

  test('順位付けに効く値が違うプリセットを渡すとエラーになる', () => {
    // current は加点なし(wMutual・wLead が 0)なので顔ぶれが変わる
    assert.throws(
      () =>
        assertSameRanking([
          { name: 'rev2', config: PRESETS.rev2 },
          { name: 'current', config: PRESETS.current },
        ]),
      /順位付けに効く値が違う/
    )
    assert.throws(
      () =>
        assertSameRanking([
          { name: 'rev2', config: PRESETS.rev2 },
          { name: 'x', config: { ...PRESETS.rev2, neighborLimit: 20 } },
        ]),
      /neighborLimit/
    )
  })
})

describe('配置・大きさ(表示と共有する関数)', () => {
  test('全体を収める距離: 外接箱の対角線の半分 ÷ sin(画角/2) × 余白。小さいときは下限の半径', () => {
    // 外接箱 60×80×0 → 対角線 100 → 半径 50
    const fit = fitCamera([{ x: 0, y: 0, z: 0 }, { x: 60, y: 80, z: 0 }, { x: 10, y: 5, z: 0 }], 60, 1.4, 10)
    assert.deepEqual(fit.center, { x: 30, y: 40, z: 0 })
    close(fit.distance, (50 / Math.sin(Math.PI / 6)) * 1.4)
    const small = fitCamera([{ x: 0, y: 0, z: 0 }], 60, 1.4, 40)
    close(small.distance, (40 / 0.5) * 1.4, 1e-9)
    assert.equal(fitCamera([], 60, 1.4, 40), null)
  })

  test('初期位置は (seed, 記事名) で決まる', () => {
    const a = initialPosition(1, '初音ミク', {})
    const b = initialPosition(1, '初音ミク', {})
    const c = initialPosition(2, '初音ミク', {})
    assert.deepEqual(a, b)
    assert.notDeepEqual(a, c)
  })

  test('球の大きさ: 現在地・訪問済みの一次・一次(閲覧数)・二次', () => {
    assert.equal(nodeTierStyle({ isCurrent: true, isPrimary: false, expanded: true, views: 0 }).basePx, NODE_PX_CURRENT)
    assert.deepEqual(nodeTierStyle({ isCurrent: false, isPrimary: true, expanded: true, views: 5 }), {
      tier: 1,
      visited: true,
      basePx: NODE_PX_VISITED,
    })
    assert.equal(nodeTierStyle({ isCurrent: false, isPrimary: false, expanded: false, views: 1e6 }).basePx, NODE_PX_SECONDARY)
    assert.equal(primaryPxFromViews(0), NODE_PX_PRIMARY_MIN)
    assert.equal(primaryPxFromViews(1e12), NODE_PX_PRIMARY_MAX)
  })
})

describe('仮想画面(MEASURE_VIEWPORTS)', () => {
  // App.css の値を変えたのに constants.js を直し忘れると、測る画面が実際と違ってしまう
  const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  const px = (re) => Number(css.match(re)[1])

  test('pc: 1280×800 からトップバーとサイドバーを引いた大きさ', () => {
    const topbar = px(/--topbar-height:\s*(\d+)px/)
    const sidebar = px(/--sidebar-width:\s*(\d+)px/)
    assert.deepEqual(
      { width: MEASURE_VIEWPORTS.pc.width, height: MEASURE_VIEWPORTS.pc.height },
      { width: 1280 - sidebar, height: 800 - topbar }
    )
  })

  test('phone: 844×390 から低い横画面のトップバーを引いた大きさ(ドロワーは重ねるので幅は減らない)', () => {
    const block = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 500px)'))
    const topbar = Number(block.match(/\.topbar\s*\{[^}]*height:\s*(\d+)px/)[1])
    assert.match(block, /\.sidebar\.is-overlay\s*\{[^}]*position:\s*absolute/)
    assert.deepEqual(
      { width: MEASURE_VIEWPORTS.phone.width, height: MEASURE_VIEWPORTS.phone.height },
      { width: 844, height: 390 - topbar }
    )
  })
})
