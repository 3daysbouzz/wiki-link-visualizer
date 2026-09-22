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
} from './api/wikipedia.js'
import { fetchSummary } from './api/summary.js'
import { PRESETS, coerceConfig } from './config/presets.ts'
import {
  readUrlState,
  writeTrailToUrl,
  writeConfigToUrl,
} from './config/urlState.js'
import { seededRandom } from './utils/prng.js'
import {
  PREVIEW_DELAY_MS,
  MAX_NODES_WARN,
  TRAIL_KEEP,
  PACKET_COUNT,
  TRAVEL_MS,
  ZOOM_STEP,
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

  // ホバー中の記事id。サイドバーはホバー中はそのノード、外れたら現在地を出す
  const [hoveredId, setHoveredId] = useState(null)
  // サイドバーに出している記事の取得結果(summary/meta が undefined = 取得中)
  const [sidebar, setSidebar] = useState(null)

  const graphRef = useRef(null)
  // 記事id => その記事を展開したときに実際に出したリンク先
  // (抽選結果を覚えておかないと、戻ったときに違う道が現れてしまう)
  const expansions = useRef(new Map())
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

  const rememberExpansion = (title, links) => {
    expansions.current.set(title, links)
  }

  // 抽選の乱数。(seed, 解決後の記事名) から作るので、同じ設定なら同じ顔ぶれになる
  const randomFor = (resolvedTitle) =>
    seededRandom(configRef.current.seed, resolvedTitle)

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
  // 取得は待たない(閲覧数は見た目の補助なので、散歩を止めてまで待つ必要はない)
  const loadViews = (titles) => {
    const session = viewsSession.current
    const missing = titles.filter((t) => !viewsOf.current.has(t))
    if (missing.length === 0) return
    fetchPageviews(missing, (title, views) => {
      if (viewsSession.current !== session) return
      viewsOf.current.set(title, views)
      scheduleRebuild()
    })
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
      const result = await fetchLinkedArticles(
        title,
        configRef.current.neighborLimit,
        setProgress,
        false,
        randomFor
      )

      viewsSession.current += 1
      expansions.current = new Map()
      viewsOf.current = new Map()
      rememberExpansion(result.title, result.links)

      setHoveredId(null)
      commitTrail([result.title], { immediateCrumb: true })
      loadViews([result.title, ...result.links.map((l) => l.title)])

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
    },
    [loading]
  )

  // ======================================================================
  // ノードクリック: そのノードへ進む(訪問済みなら軌跡を遡る)
  // サイドバーの隣接記事リストからも同じ処理で進む
  // ======================================================================
  const handleNodeClick = useCallback(
    async (node) => {
      if (loading || travelingRef.current) return

      // 既に通った記事をクリックしたら、そこまで引き返す
      if (trailRef.current.includes(node.id)) {
        jumpTo(node.id)
        return
      }

      setLoading(true)
      setLoadingId(node.id) // 取得中、このノードが脈打つ
      setProgress(0)
      setError(null)

      try {
        // グラフ上のノード名はAPIが返したものなので正規化済み。
        // 中心記事の解決を待たずにリンク取得を始められる(往復1回分の短縮)
        const result = await fetchLinkedArticles(
          node.id,
          configRef.current.neighborLimit,
          setProgress,
          true,
          randomFor
        )

        rememberExpansion(result.title, result.links)

        // リダイレクトでタイトルが変わることがあるので、解決後の名前を使う。
        // 既に軌跡上にあるなら、そこを現在地として並べ直す
        commitTrail([
          ...trailRef.current.filter((id) => id !== result.title),
          result.title,
        ])
        loadViews([result.title, ...result.links.map((l) => l.title)])

        // 新しい現在地へカメラを飛ばす(到着後は追従に引き継がれる)
        travelTo(result.title)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
        setLoadingId(null)
      }
    },
    [loading, jumpTo]
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
        const limit = configRef.current.neighborLimit
        const first = await fetchLinkedArticles(start, limit, setProgress, false, randomFor)
        rememberExpansion(first.title, first.links)
        nextTrail = [first.title]

        for (const step of path) {
          const r = await fetchLinkedArticles(step, limit, setProgress, true, randomFor)
          rememberExpansion(r.title, r.links)
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
      loadViews(Array.from(shown))
      const last = nextTrail[nextTrail.length - 1]
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

  const tooManyNodes = graphData.nodes.length > MAX_NODES_WARN
  const isEmpty = trail.length === 0 && !loading
  // グラフが空のときのエラーは左上の小さな行ではなく画面中央に出す
  // (URL の start が間違っていた場合など、真っ黒な画面で小さな文字だけでは気づけない)
  const showErrorInCenter = !!error && isEmpty
  const status = loading
    ? `FETCHING${progress > 0 ? ` ${progress}` : ''}`
    : error && !showErrorInCenter
      ? `ERROR ${error}`
      : tooManyNodes
        ? 'WARN ノードが増えすぎています。検索し直すと整理できます'
        : null

  return (
    <div className="app">
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
        />
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
