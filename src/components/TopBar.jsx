import React, { useEffect, useRef, useState } from 'react'
import { fetchSuggestions } from '../api/wikipedia.js'
import { SUGGEST_DEBOUNCE_MS, SUGGEST_LIMIT } from '../constants.js'

/**
 * 画面上部のバー: ロゴ、検索欄(オートコンプリート付き)、統計値、リセット。
 *
 * 検索候補は action=opensearch で取る。存在する記事しか候補に出ないので、
 * 候補から選べば「記事が見つからない」は起きない。
 *   - 入力が止まって SUGGEST_DEBOUNCE_MS 経ってから取りに行く(1文字ごとに叩かない)
 *   - ↑↓ で選択、Enter で確定、Esc で閉じる。候補クリックでも確定
 */
export default function TopBar({ onSearch, onReset, loading, stats }) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
  // 候補を取りにいった結果が「該当なし」だったか。
  // 通信失敗(null)のときは true にしない(記事が無いと誤解させないため)
  const [noHits, setNoHits] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [focused, setFocused] = useState(false)

  const debounceTimer = useRef(null)
  // 古いリクエストの結果が後から届いて新しい候補を上書きしないための連番
  const requestSeq = useRef(0)
  const formRef = useRef(null)

  const fmt = (n) => n.toLocaleString('en-US')

  const submit = (title) => {
    const t = (title || '').trim()
    if (!t || loading) return
    // 確定後に、入力中に仕掛けた候補取得が遅れて届いてドロップダウンを開き直さないよう
    // タイマーを止め、進行中のリクエストも無効にする
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    requestSeq.current += 1
    setValue(t)
    setOpen(false)
    setSuggestions([])
    setNoHits(false)
    setActiveIndex(-1)
    onSearch(t)
  }

  const handleChange = (e) => {
    const next = e.target.value
    setValue(next)
    setActiveIndex(-1)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    if (!next.trim()) {
      setSuggestions([])
      setNoHits(false)
      setOpen(false)
      return
    }
    debounceTimer.current = setTimeout(async () => {
      const seq = ++requestSeq.current
      const list = await fetchSuggestions(next, SUGGEST_LIMIT)
      if (seq !== requestSeq.current) return
      // null = 取得失敗。候補を消して黙る(操作は続けられる)
      if (list === null) {
        setSuggestions([])
        setNoHits(false)
        setOpen(false)
        return
      }
      setSuggestions(list)
      setNoHits(list.length === 0)
      setOpen(true)
    }, SUGGEST_DEBOUNCE_MS)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      if (!open || suggestions.length === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      if (!open || suggestions.length === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        submit(suggestions[activeIndex])
      } else {
        submit(value)
      }
    }
  }

  // 検索欄の外をクリックしたら候補を閉じる
  useEffect(() => {
    const onPointerDown = (e) => {
      if (formRef.current && !formRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  // 未入力で入力欄にフォーカスが無いときだけ、点滅カーソルを見せる
  const showFakeCursor = !focused && !value

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="logo">WIKI://NODES</div>

        <form
          ref={formRef}
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            submit(value)
          }}
        >
          <span className="search-prompt" aria-hidden="true">
            &gt;
          </span>
          {/* 入力欄と点滅カーソルをまとめる枠。カーソルを入力欄の左端に重ねるため */}
          <span className="search-field">
            <input
              type="text"
              className={`search-input${showFakeCursor ? ' has-fake-cursor' : ''}`}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setFocused(true)
                if (suggestions.length > 0 || noHits) setOpen(true)
              }}
              onBlur={() => setFocused(false)}
              placeholder="記事を検索"
              aria-label="記事を検索"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls="search-suggestions"
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
            />
            {/* 点滅カーソル。フォーカス時に本物のキャレットが出るのと同じ左端に置く。
                入力中(フォーカス中)は本物のキャレットがあるので消す */}
            {showFakeCursor && (
              <span className="search-cursor" aria-hidden="true">
                _
              </span>
            )}
          </span>

          {/* 0件のときも黙らず「見つからない」と伝える(入力ミスにその場で気づけるように) */}
          {open && noHits && suggestions.length === 0 && (
            <p className="suggestions suggestions-empty" role="status">
              該当する記事がありません
            </p>
          )}

          {open && suggestions.length > 0 && (
            <ul id="search-suggestions" className="suggestions" role="listbox">
              {suggestions.map((s, i) => (
                <li key={s} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    className={`suggestion${i === activeIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => submit(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>

      <div className="topbar-right">
        <span className="stat">
          NODES <b>{fmt(stats.nodes)}</b>
        </span>
        <span className="stat">
          EDGES <b>{fmt(stats.edges)}</b>
        </span>
        <span className="stat">
          DEPTH <b>{fmt(stats.depth)}</b>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="表示をリセット"
          title="表示をリセット"
          onClick={onReset}
          disabled={loading || stats.nodes === 0}
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
            <path d="M3 12a9 9 0 1 1 3 6.7" />
            <path d="M3 4v6h6" />
          </svg>
        </button>
      </div>
    </header>
  )
}
