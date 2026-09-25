import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import Graph3D from './components/Graph3D.jsx'
import TopBar from './components/TopBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import Breadcrumb from './components/Breadcrumb.jsx'
import ZoomControls from './components/ZoomControls.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import {
  fetchLinkedArticles,
  fetchPageviews,
  fetchArticleMeta,
  getMoreLinks,
  countMoreLinks,
  moreBudget,
} from './api/wikipedia.js'
import { fetchSummary } from './api/summary.js'
import { PRESETS, coerceConfig } from './config/presets.ts'
import {
  readUrlState,
  writeTrailToUrl,
  writeConfigToUrl,
} from './config/urlState.js'
import { seededRandom } from './utils/prng.js'
import { useLayoutMode } from './utils/layoutMode.js'
import {
  PREVIEW_DELAY_MS,
  MAX_NODES_WARN,
  TRAIL_KEEP,
  PACKET_COUNT,
  TRAVEL_MS,
  ZOOM_STEP,
  MORE_SHAKE_EMPTY_RATIO,
  MORE_LABEL_BOOST_MS,
  NOTICE_MS,
  MORE_HINT_MS,
} from './constants.js'

/**
 * 訪問した記事の列(trail)から、画面に出すグラフを組み立て直す。
 *
 * グラフを差分で足し引きするのではなく、毎回 trail から作り直している。
 * こうすると「戻る」が trail を短く切るだけで実現でき、
 * 進む/戻るのどちらでも同じ結果になることが保証される。
 *
 * 表示の方針(散歩の軌跡モデル):
 *   - 訪問した記事そのものは消さない … 歩いた軌跡になる
 *   - 直近 TRAIL_KEEP 件の訪問記事は、その子(リンク先)も出す … この先の選択肢
 *   - それより古い訪問記事の子は畳む … 選び終わった選択肢はもう要らない
 */
function buildGraph(trail, expansions, viewsOf, config) {
  const nodeMap = new Map()
  const links = []
  const linkKeys = new Set()
  const trailSet = new Set(trail)

  const addNode = (id) => {
    if (nodeMap.has(id)) return
    nodeMap.set(id, {
      id,
      name: id,
      views: viewsOf.get(id) || 0,
      expanded: trailSet.has(id),
    })
  }

  const addLink = (source, target) => {
    if (source === target) return
    if (linkKeys.has(`${source}->${target}`)) return
    if (linkKeys.has(`${target}->${source}`)) return
    linkKeys.add(`${source}->${target}`)
    links.push({ source, target })
  }

  // trailEnabled=false なら軌跡を残さず、現在地とその子だけを出す
  const shown = config.trailEnabled ? trail : trail.slice(-1)

  // 歩いた経路そのもの
  for (const id of shown) addNode(id)
  for (let i = 0; i + 1 < shown.length; i++) addLink(shown[i], shown[i + 1])

  // 直近の訪問記事については、その先の選択肢も出す
  for (const id of shown.slice(-TRAIL_KEEP)) {
    for (const child of expansions.get(id) || []) {
      addNode(child.title)
      addLink(id, child.title)
    }
  }

  return { nodes: Array.from(nodeMap.values()), links }
}

// URL は起動時に一度だけ読む(経路の復元と設定の初期値に使う)
const initialUrlState = readUrlState()

export default function App() {
  // 表示パラメータ(VizConfig)。URL → プリセット → 個別上書き の順で決まる
  const [presetName, setPresetName] = useState(initialUrlState.presetName)
  const [config, setConfig] = useState(initialUrlState.config)
  // 非同期処理の途中で最新の設定を参照するため
  const configRef = useRef(config)
  configRef.current = config

  const [graphData, setGraphData] = useState({ nodes: [], links: [] })
  const [trail, setTrail] = useState([])
  // 左下のパンくずに出す軌跡。カメラの到着(TRAVEL_MS 後)に合わせて遅れて更新する
  const [crumbTrail, setCrumbTrail] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  // 左上のステータス行に数秒だけ出す案内(追加表示の操作説明・上限の通知)
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  // 操作説明は初めてグラフを出したときだけ出す
  const hintShownRef = useRef(false)

  // 画面の形(SPEC 4章)。'short-landscape' | 'narrow' | 'wide'
  // 端末を回すと切り替わる
  const layoutMode = useLayoutMode()
  const isShortLandscape = layoutMode === 'short-landscape'

  // サイドバーを開いているか。低い横画面ではグラフを優先して初期状態を閉じる。
  // 状態は保存しない(リロードで初期値に戻る)
  const [sidebarOpen, setSidebarOpen] = useState(() => !isShortLandscape)
  // 画面の形が変わったら、その形の初期値に戻す
  // (横向きにした瞬間にドロワーが開いたままグラフを覆うのを避ける)
  const prevLayoutMode = useRef(layoutMode)
  useEffect(() => {
    if (prevLayoutMode.current === layoutMode) return
    prevLayoutMode.current = layoutMode
    setSidebarOpen(layoutMode !== 'short-landscape')
  }, [layoutMode])

  // ホバー中の記事id。サイドバーはホバー中はそのノード、外れたら現在地を出す
  const [hoveredId, setHoveredId] = useState(null)
  // サイドバーに出している記事の取得結果(summary/meta が undefined = 取得中)
  const [sidebar, setSidebar] = useState(null)

  const graphRef = useRef(null)
  // 記事id => その記事を展開したときに実際に出したリンク先
  // (抽選結果を覚えておかないと、戻ったときに違う道が現れてしまう)
  const expansions = useRef(new Map())
  // 記事id => 追加表示の状態 { weights: 展開時の重み, added: これまでに追加した件数 }。
  // 追加分は重みを展開時のもので並べる(重みの変更は次に展開する記事から効く、と揃える)。
  // 件数は expansions の長さからは逆算しない(neighborLimit は後から変えられるため)
  const moreState = useRef(new Map())
  // 記事id => 閲覧数。ノードの大きさに使う。
  // 閲覧数は表示後に少しずつ届くので、届くたびにここへ足してグラフを組み直す
  const viewsOf = useRef(new Map())
  // 非同期に届く閲覧数を、現在の軌跡に対して反映するための最新の trail
  const trailRef = useRef([])
  // 検索し直したあとに古い閲覧数が届いても捨てるための世代番号
  const viewsSession = useRef(0)
  const rebuildTimer = useRef(null)
  const crumbTimer = useRef(null)
  // クリック遷移中(カメラが飛んでいる間)の二重クリックを防ぐ
  const travelingRef = useRef(false)
  const travelTimer = useRef(null)

  // 記事id => プレビュー(REST summary) / メタ情報。同じノードに何度も乗るので都度取らない
  const previewCache = useRef(new Map())
  const metaCache = useRef(new Map())
  // 非同期で取得した結果が「まだ同じ記事をサイドバーに出しているか」を判定するため
  const sidebarIdRef = useRef(null)

  const currentId = trail.length > 0 ? trail[trail.length - 1] : null
  const sidebarId = hoveredId || currentId

  const rememberExpansion = (title, links, weights) => {
    expansions.current.set(title, links)
    moreState.current.set(title, { weights, added: 0 })
  }

  const showNotice = (text, ms = NOTICE_MS) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice(text)
    noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }

  // 初めてグラフを出したときだけ、中心クリックで増やせることを知らせる
  const showMoreHint = () => {
    if (hintShownRef.current) return
    hintShownRef.current = true
    showNotice('中心をクリックで関連記事を追加', MORE_HINT_MS)
  }

  // 抽選の乱数。(seed, 解決後の記事名) から作るので、同じ設定なら同じ顔ぶれになる
  const randomFor = (resolvedTitle) =>
    seededRandom(configRef.current.seed, resolvedTitle)

  // fetchLinkedArticles に渡す共通の設定。呼ぶ時点の最新の config から作るので、
  // 件数・種・重みの変更は「次に展開する記事から」効く(記憶済みの展開結果は変えない)
  const currentWeights = () => {
    const c = configRef.current
    return { wMorelike: c.wMorelike, wMutual: c.wMutual, wLead: c.wLead }
  }
  const linkOptions = (assumeCanonical) => ({
    limit: configRef.current.neighborLimit,
    onProgress: setProgress,
    assumeCanonical,
    randomFor,
    weights: currentWeights(),
    debug: initialUrlState.debug,
  })

  const rebuild = (nextTrail) =>
    buildGraph(nextTrail, expansions.current, viewsOf.current, configRef.current)

  // 軌跡を確定してグラフを組み直す。trailRef も同時に更新して、
  // あとから届く閲覧数が古い軌跡に対して反映されないようにする。
  // パンくずは「到着」に合わせて TRAVEL_MS 後に更新する(検索直後は即時)
  const commitTrail = (nextTrail, { immediateCrumb = false } = {}) => {
    trailRef.current = nextTrail
    setTrail(nextTrail)
    setGraphData(rebuild(nextTrail))
    // 同じ道を別の設定で開き直せるよう、経路を URL に残す
    writeTrailToUrl(nextTrail)

    if (crumbTimer.current) clearTimeout(crumbTimer.current)
    if (immediateCrumb) {
      setCrumbTrail(nextTrail)
    } else {
      crumbTimer.current = setTimeout(() => setCrumbTrail(nextTrail), TRAVEL_MS)
    }
  }

  // クリック遷移を始める: カメラを飛ばし、その間は次のクリックを受け付けない
  const travelTo = (title) => {
    travelingRef.current = true
    if (travelTimer.current) clearTimeout(travelTimer.current)
    travelTimer.current = setTimeout(() => {
      travelingRef.current = false
    }, TRAVEL_MS)
    // グラフへの反映(useEffect)を待ってから飛ぶ
    setTimeout(() => graphRef.current?.travelTo(title), 60)
  }

  // 閲覧数が届くたびに組み直すと重いので、少しまとめてから1回だけ組み直す
  const scheduleRebuild = () => {
    if (rebuildTimer.current) return
    rebuildTimer.current = setTimeout(() => {
      rebuildTimer.current = null
      setGraphData(rebuild(trailRef.current))
    }, 150)
  }

  // 表示中ノードの閲覧数を裏で取りにいく。届いた順に球が育つ。
  // 散歩は止めない(閲覧数は見た目の補助なので、待つ必要はない)。
  // 返す Promise は「表示分を取り終えた」合図で、追加表示の先読みの開始に使う
  const loadViews = (titles) => {
    const session = viewsSession.current
    const missing = titles.filter((t) => !viewsOf.current.has(t))
    if (missing.length === 0) return Promise.resolve()
    return fetchPageviews(missing, (title, views) => {
      if (viewsSession.current !== session) return
      viewsOf.current.set(title, views)
      scheduleRebuild()
    })
  }

  // --- 追加表示 (SPEC 5章・6.8) ---------------------------------------------

  // 今のグラフに出ている記事。追加分はこれらを除いて選ぶ
  // (別の枝に既に出ている記事を足しても、線が増えるだけでノードは増えないため)
  const shownTitles = (trailNow) => new Set(rebuild(trailNow).nodes.map((n) => n.id))

  // 次に追加するリンク(出す件数は上限 moreMax を考慮する)
  const nextMoreLinks = (title, trailNow) => {
    const st = moreState.current.get(title)
    if (!st) return []
    const c = configRef.current
    const budget = moreBudget(st.added, c.moreBatch, c.moreMax)
    return getMoreLinks(title, shownTitles(trailNow), budget, st.weights)
  }

  // 次に追加する分の閲覧数を裏で取っておく(追加したとき球の大きさがすぐ決まるように)。
  // 表示分の取得より優先度を下げる(fetchPageviews の low)。
  // 間に合わなくても追加は待たない。大きさは届いた時点で育つ
  const prefetchMore = (title) => {
    const trailNow = trailRef.current
    if (trailNow[trailNow.length - 1] !== title) return // もう別の記事へ進んでいる
    const titles = nextMoreLinks(title, trailNow).map((l) => l.title)
    if (titles.length > 0) fetchPageviews(titles, undefined, { priority: 'low' })
  }

  // 表示分の閲覧数を取り終えてから、次の追加分を先読みする
  const loadViewsThenPrefetch = (titles, current) => {
    loadViews(titles).then(() => prefetchMore(current))
  }

  // ======================================================================
  // 検索: すべてリセットして、その記事から歩き始める
  // ======================================================================
  const handleSearch = useCallback(async (title) => {
    setLoading(true)
    setProgress(0)
    setError(null)
    try {
      // ユーザー入力はリダイレクトや表記ゆれの可能性があるので正規化させる
      const options = linkOptions(false)
      const result = await fetchLinkedArticles(title, options)

      viewsSession.current += 1
      expansions.current = new Map()
      moreState.current = new Map()
      viewsOf.current = new Map()
      rememberExpansion(result.title, result.links, options.weights)

      setHoveredId(null)
      commitTrail([result.title], { immediateCrumb: true })
      loadViewsThenPrefetch([result.title, ...result.links.map((l) => l.title)], result.title)
      showMoreHint()

      // レイアウトがある程度落ち着いてから全体を収め、そのあと起点を追う
      setTimeout(() => graphRef.current?.zoomToFit(700), 900)
      setTimeout(() => graphRef.current?.followNode(result.title), 1700)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ======================================================================
  // リセット: グラフを空にして検索前の状態に戻す
  // ======================================================================
  const handleReset = useCallback(() => {
    viewsSession.current += 1
    expansions.current = new Map()
    moreState.current = new Map()
    viewsOf.current = new Map()
    setHoveredId(null)
    setError(null)
    commitTrail([], { immediateCrumb: true })
  }, [])

  // ======================================================================
  // 軌跡を遡る: その記事を現在地にして、そこから先の経路は捨てる
  // ======================================================================
  const jumpTo = useCallback(
    (title) => {
      if (loading || travelingRef.current || !title) return
      // 連続して呼ばれても古い trail を掴まないよう、state ではなく ref を見る
      const current = trailRef.current
      const index = current.indexOf(title)
      if (index < 0 || index === current.length - 1) return

      commitTrail(current.slice(0, index + 1))
      travelTo(title)
      prefetchMore(title)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  )

  // ======================================================================
  // ノードクリック: そのノードへ進む(訪問済みなら軌跡を遡る)
  // サイドバーの隣接記事リストからも同じ処理で進む
  // ======================================================================
  // ======================================================================
  // 追加表示: 現在地の関連リンクを、まだ出していない候補からスコア順に足す
  // (中心ノードのクリックとサイドバーの + MORE が同じ処理を呼ぶ。SPEC 5章・6.8)
  //
  // 候補も閲覧数(先読み)も手元にあるので、通信を待たずに即座に足す。
  // 結果は expansions に追記するので、戻る/進むでも消えない
  // ======================================================================
  const handleMore = useCallback(() => {
    if (loading || travelingRef.current) return
    const trailNow = trailRef.current
    const current = trailNow[trailNow.length - 1]
    const st = current && moreState.current.get(current)
    if (!st) return

    const links = nextMoreLinks(current, trailNow)
    if (links.length === 0) {
      graphRef.current?.shakeNode(current, MORE_SHAKE_EMPTY_RATIO)
      showNotice('これ以上の関連記事はありません')
      return
    }

    const titles = links.map((l) => l.title)
    expansions.current.set(current, [...(expansions.current.get(current) || []), ...links])
    st.added += links.length

    // 新しいノードは現在地から生やし、震わせ、しばらくラベルを優先して出す
    graphRef.current?.spawnFrom(current, titles)
    graphRef.current?.shakeNode(current, 1)
    setGraphData(rebuild(trailNow))
    // グラフに反映されてから(ノードができてから)ラベルの優先を付ける
    setTimeout(() => graphRef.current?.boostLabels(titles, MORE_LABEL_BOOST_MS), 0)

    // 先読み済みならキャッシュから即座に大きさが決まる。続けて次の分を先読みする
    loadViewsThenPrefetch(titles, current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ======================================================================
  // ノードクリック: そのノードへ進む(訪問済みなら軌跡を遡る)
  // サイドバーの隣接記事リストからも同じ処理で進む
  // ======================================================================
  const handleNodeClick = useCallback(
    async (node) => {
      if (loading || travelingRef.current) return

      // 現在地をクリックしたら関連記事を追加する
      const trailNow = trailRef.current
      if (trailNow.length > 0 && node.id === trailNow[trailNow.length - 1]) {
        handleMore()
        return
      }

      // 既に通った記事をクリックしたら、そこまで引き返す
      if (trailNow.includes(node.id)) {
        jumpTo(node.id)
        return
      }

      // 以前に展開した記事(戻ってから再び進んだ場合など)は、記憶した展開結果を使う。
      // 取り直すと追加表示した分が消えてしまうため(進む/戻るで顔ぶれを変えない)
      const stored = expansions.current.get(node.id)
      if (stored) {
        commitTrail([...trailNow, node.id])
        loadViewsThenPrefetch([node.id, ...stored.map((l) => l.title)], node.id)
        travelTo(node.id)
        return
      }

      setLoading(true)
      setLoadingId(node.id) // 取得中、このノードが脈打つ
      setProgress(0)
      setError(null)

      try {
        // グラフ上のノード名はAPIが返したものなので正規化済み。
        // 中心記事の解決を待たずにリンク取得を始められる(往復1回分の短縮)
        const options = linkOptions(true)
        const result = await fetchLinkedArticles(node.id, options)

        rememberExpansion(result.title, result.links, options.weights)

        // リダイレクトでタイトルが変わることがあるので、解決後の名前を使う。
        // 既に軌跡上にあるなら、そこを現在地として並べ直す
        commitTrail([
          ...trailRef.current.filter((id) => id !== result.title),
          result.title,
        ])
        loadViewsThenPrefetch([result.title, ...result.links.map((l) => l.title)], result.title)

        // 新しい現在地へカメラを飛ばす(到着後は追従に引き継がれる)
        travelTo(result.title)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
        setLoadingId(null)
      }
    },
    [loading, jumpTo, handleMore]
  )

  // ======================================================================
  // 設定の変更(デバッグパネル): 反映して URL にも書く
  // 設定を変えてもグラフは組み直すだけで、経路(trail)と取得済みデータは保持する
  // ======================================================================
  const applyConfig = useCallback((next, nextPresetName) => {
    configRef.current = next
    setConfig(next)
    if (nextPresetName) setPresetName(nextPresetName)
    writeConfigToUrl(nextPresetName || presetName, next)
    setGraphData(rebuild(trailRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName])

  const handleConfigChange = useCallback(
    (patch) => applyConfig(coerceConfig(configRef.current, { ...configRef.current, ...patch })),
    [applyConfig]
  )
  // window.__viz から最新のハンドラを呼べるようにしておく
  // (window.__viz は起動時に一度だけ作るので、関数を直接持たせると古いものを掴む)
  const configChangeRef = useRef(handleConfigChange)
  configChangeRef.current = handleConfigChange

  const handlePresetChange = useCallback(
    (name) => {
      if (!PRESETS[name]) return
      applyConfig(PRESETS[name], name)
    },
    [applyConfig]
  )

  // ======================================================================
  // URL からの経路復元(?start=…&path=a,b)
  //
  // 途中経過を描画せず、全部取り終えてから一度だけグラフを組む。
  // こうするとレイアウトが常に同じ初期状態から始まり、同じ URL なら同じ配置になる
  // (途中で描画すると、通信の待ち時間の分だけシミュレーションの進み方が変わる)
  // ======================================================================
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return // StrictMode の二重実行を防ぐ
    restoredRef.current = true

    // まだ効かない設定値を黙って無視しない(Phase 1/2/3 で実装する)
    const c = configRef.current
    if (c.edgeMode === 'induced') {
      console.warn('[config] edgeMode=induced は Phase 1 で実装予定。現状は radial と同じ描画です')
    }
    if (c.colorMode === 'category') {
      console.warn('[config] colorMode=category は Phase 3 で実装予定。現状は mono と同じ描画です')
    }
    console.info('[config] preset=%s %o', presetName, c)

    // ?debug=1 のとき、配置の照合用に座標を取れるようにしておく
    // (Console で JSON.stringify(window.__viz.positions()) を2つのタブで見比べる)
    if (initialUrlState.debug) {
      window.__viz = {
        positions: () => graphRef.current?.getPositions() || {},
        step: (n) => graphRef.current?.stepLayout(n),
        config: () => configRef.current,
        trail: () => trailRef.current,
        camera: () => graphRef.current?.getCamera() || null,
        // ノードの画面上の位置(canvas 内の px)。クリックの確認に使う
        screenOf: (id) => graphRef.current?.getScreenPosition(id) || null,
        // ラベルの状態(深さフェードの確認用)と、1フレーム分のラベル処理の時間(ms)
        labels: () => graphRef.current?.getLabelState() || [],
        labelWork: (n) => graphRef.current?.measureLabelWork(n),
        // 設定をその場で変える。leva を触らずに挙動を確かめたいときに使う
        // 例: window.__viz.set({ repulsion: 9000 })
        set: (patch) => {
          configChangeRef.current(patch)
          return configRef.current
        },
      }
    }
    const { start, path } = initialUrlState
    if (!start) return

    ;(async () => {
      setLoading(true)
      setProgress(0)
      setError(null)
      let nextTrail = []
      try {
        const firstOptions = linkOptions(false)
        const first = await fetchLinkedArticles(start, firstOptions)
        rememberExpansion(first.title, first.links, firstOptions.weights)
        nextTrail = [first.title]

        for (const step of path) {
          const stepOptions = linkOptions(true)
          const r = await fetchLinkedArticles(step, stepOptions)
          rememberExpansion(r.title, r.links, stepOptions.weights)
          nextTrail = [...nextTrail.filter((id) => id !== r.title), r.title]
        }
      } catch (e) {
        setError(`経路の復元に失敗: ${e.message}`)
      } finally {
        setLoading(false)
      }
      if (nextTrail.length === 0) return

      commitTrail(nextTrail, { immediateCrumb: true })
      const shown = new Set()
      for (const id of nextTrail) {
        shown.add(id)
        for (const l of expansions.current.get(id) || []) shown.add(l.title)
      }
      const last = nextTrail[nextTrail.length - 1]
      loadViewsThenPrefetch(Array.from(shown), last)
      showMoreHint()
      setTimeout(() => graphRef.current?.zoomToFit(700), 900)
      setTimeout(() => graphRef.current?.followNode(last), 1700)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSidebarSelect = useCallback(
    (title) => handleNodeClick({ id: title, name: title }),
    [handleNodeClick]
  )

  // ======================================================================
  // ホバー: サイドバーの表示対象を切り替える
  // ======================================================================
  const handleNodeHover = useCallback((node) => {
    setHoveredId(node ? node.id : null)
  }, [])

  // ======================================================================
  // サイドバーのデータ取得 (SPEC 6.2)
  // ホバー中は PREVIEW_DELAY_MS 待ってから取る(通過しただけのノードを取りに行かない)。
  // 現在地は即時。結果はキャッシュし、失敗してもエラーは出さない
  // ======================================================================
  useEffect(() => {
    sidebarIdRef.current = sidebarId
    if (!sidebarId) {
      setSidebar(null)
      return
    }
    const id = sidebarId
    const summary = previewCache.current.get(id)
    const meta = metaCache.current.get(id)
    setSidebar({ id, summary, meta })
    if (summary !== undefined && meta !== undefined) return

    const isHover = id !== currentId
    const timer = setTimeout(async () => {
      const [s, m] = await Promise.all([
        summary !== undefined ? summary : fetchSummary(id),
        meta !== undefined ? meta : fetchArticleMeta(id),
      ])
      previewCache.current.set(id, s)
      metaCache.current.set(id, m)
      // 待っている間に別の記事へ移っていたら、この結果は捨てる(キャッシュには残す)
      if (sidebarIdRef.current !== id) return
      setSidebar({ id, summary: s, meta: m })
    }, isHover ? PREVIEW_DELAY_MS : 0)

    return () => clearTimeout(timer)
  }, [sidebarId, currentId])

  // ======================================================================
  // Backspace で一手戻る
  // ======================================================================
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Backspace') return
      // 検索欄に文字を打っている最中は邪魔しない
      const tag = e.target && e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (trail.length < 2) return
      e.preventDefault()
      jumpTo(trail[trail.length - 2])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [trail, jumpTo])

  // アンマウント時にタイマーを片付ける
  useEffect(() => {
    return () => {
      if (rebuildTimer.current) clearTimeout(rebuildTimer.current)
      if (crumbTimer.current) clearTimeout(crumbTimer.current)
      if (travelTimer.current) clearTimeout(travelTimer.current)
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [])

  // データパケットを流すエッジ: 現在地の展開結果のうち関連度上位 PACKET_COUNT 件
  // (expansions は確定枠→抽選枠の順に並んでいるので、先頭が関連度上位)
  const packetIds = useMemo(() => {
    if (!currentId) return []
    return (expansions.current.get(currentId) || [])
      .slice(0, PACKET_COUNT)
      .map((l) => l.title)
    // graphData が変わるたびに(=trail が確定するたびに)取り直す
  }, [currentId, graphData])

  // サイドバーの隣接記事 = そのノードの展開結果(未展開なら null)
  const sidebarAdjacent = useMemo(() => {
    if (!sidebarId) return null
    const links = expansions.current.get(sidebarId)
    return links ? links.map((l) => l.title) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarId, graphData])

  // サイドバーの + MORE に出す件数: 次に足す件数と、上限までの残り
  const moreInfo = useMemo(() => {
    if (!currentId) return null
    const st = moreState.current.get(currentId)
    if (!st) return null
    const available = countMoreLinks(
      currentId,
      new Set(graphData.nodes.map((n) => n.id)),
      st.weights
    )
    const rest = Math.min(available, Math.max(0, config.moreMax - st.added))
    return { next: Math.min(config.moreBatch, rest), rest }
  }, [currentId, graphData, config.moreBatch, config.moreMax])

  const tooManyNodes = graphData.nodes.length > MAX_NODES_WARN
  const isEmpty = trail.length === 0 && !loading
  // グラフが空のときのエラーは左上の小さな行ではなく画面中央に出す
  // (URL の start が間違っていた場合など、真っ黒な画面で小さな文字だけでは気づけない)
  const showErrorInCenter = !!error && isEmpty
  const status = loading
    ? `FETCHING${progress > 0 ? ` ${progress}` : ''}`
    : error && !showErrorInCenter
      ? `ERROR ${error}`
      : notice
        ? notice
        : tooManyNodes
          ? 'WARN ノードが増えすぎています。検索し直すと整理できます'
          : null

  return (
    <div
      className={`app layout-${layoutMode} ${sidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}`}
    >
      <TopBar
        onSearch={handleSearch}
        onReset={handleReset}
        loading={loading}
        stats={{
          nodes: graphData.nodes.length,
          edges: graphData.links.length,
          depth: trail.length,
        }}
      />

      <div className="main">
        <div className="graph-area">
          <Graph3D
            ref={graphRef}
            graphData={graphData}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            currentId={currentId}
            loadingId={loadingId}
            packetIds={packetIds}
            seed={config.seed}
            config={config}
          />

          {status && (
            <p
              className={`status-line${error ? ' is-error' : ''}`}
              role={error ? 'alert' : 'status'}
            >
              {status}
            </p>
          )}

          {isEmpty && (
            <div className="empty-hint" role={showErrorInCenter ? 'alert' : undefined}>
              {showErrorInCenter && <p className="empty-error">ERROR {error}</p>}
              <p className="empty-text">記事名を検索すると、ここに3Dグラフが出ます</p>
            </div>
          )}

          <Breadcrumb
            trail={crumbTrail}
            onJump={jumpTo}
            onBack={() => jumpTo(trail[trail.length - 2])}
            disabled={loading || trail.length < 2}
          />

          <ZoomControls
            onZoomIn={() => graphRef.current?.zoomBy(1 / ZOOM_STEP)}
            onZoomOut={() => graphRef.current?.zoomBy(ZOOM_STEP)}
            disabled={graphData.nodes.length === 0}
          />
        </div>

        <Sidebar
          id={sidebar ? sidebar.id : null}
          summary={sidebar ? sidebar.summary : undefined}
          meta={sidebar ? sidebar.meta : undefined}
          adjacent={sidebarAdjacent}
          isCurrent={!!sidebarId && sidebarId === currentId}
          onSelect={handleSidebarSelect}
          disabled={loading}
          more={moreInfo}
          onMore={handleMore}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(false)}
          overlay={isShortLandscape}
        />

        {/* 閉じているときの開くボタン。サイドバーの外に出しておかないと
            自分ごと消えてしまうので、グラフ側に置く */}
        {!sidebarOpen && (
          <button
            type="button"
            className="icon-button sidebar-open"
            aria-label="記事パネルを開く"
            title="記事パネルを開く"
            onClick={() => setSidebarOpen(true)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        )}
      </div>

      {/* スキャンライン(装飾)。操作を邪魔しないよう pointer-events は切る */}
      <div className="scanlines" aria-hidden="true" />

      {initialUrlState.debug && (
        <DebugPanel
          presetName={presetName}
          config={config}
          onChange={handleConfigChange}
          onPreset={handlePresetChange}
        />
      )}
    </div>
  )
}
