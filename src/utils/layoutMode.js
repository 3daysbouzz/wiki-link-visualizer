/**
 * 画面の形からレイアウトの種類を決める。SPEC 4章。
 *
 * 幅だけで判定していると横向きのスマートフォンが救えない。
 *   844x390 … 幅900px未満なので縦積みになり、グラフが 100px 前後しか残らない
 *   932x430 … 幅900px以上なのでPCレイアウトになり、340px のサイドバーで狭くなる
 * どちらも「高さが足りない」ことが原因なので、高さを見る判定を足している。
 *
 * メディアクエリの条件は App.css と同じものを使うこと。
 * 片方だけ直すと、CSS の見た目と JS の判定がずれる。
 */
import { MOBILE_BREAKPOINT_PX, SHORT_LANDSCAPE_MAX_HEIGHT_PX } from '../constants.js'
import { useEffect, useState } from 'react'

/** 低い横画面(横向きのスマートフォンなど)。幅の条件より優先する */
export const SHORT_LANDSCAPE_QUERY =
  `(orientation: landscape) and (max-height: ${SHORT_LANDSCAPE_MAX_HEIGHT_PX}px)`

/** 狭い画面(サイドバーをグラフの下に畳む) */
export const NARROW_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`

/**
 * 今のレイアウトを返す。'short-landscape' | 'narrow' | 'wide'
 * 端末を回したときにも切り替わるよう、メディアクエリの変化を購読する
 */
export function useLayoutMode() {
  const [mode, setMode] = useState(() => readLayoutMode())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [window.matchMedia(SHORT_LANDSCAPE_QUERY), window.matchMedia(NARROW_QUERY)]
    const onChange = () => setMode(readLayoutMode())
    for (const q of queries) q.addEventListener('change', onChange)
    // 回転直後はまだ古い寸法が返ることがあるので、resize でも見直す
    window.addEventListener('resize', onChange)
    return () => {
      for (const q of queries) q.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])

  return mode
}

/** 今の画面から直接レイアウトを求める(フックを使えない場所から呼ぶ用) */
export function readLayoutMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide'
  if (window.matchMedia(SHORT_LANDSCAPE_QUERY).matches) return 'short-landscape'
  if (window.matchMedia(NARROW_QUERY).matches) return 'narrow'
  return 'wide'
}

/**
 * 描画解像度を抑えるべき画面か(SPEC 8章)。
 * 狭い画面と低い横画面のどちらもスマートフォンなので、同じ扱いにする
 */
export function isMobileViewport() {
  const mode = readLayoutMode()
  return mode === 'narrow' || mode === 'short-landscape'
}
