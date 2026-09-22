import React from 'react'
import { BREADCRUMB_COUNT } from '../constants.js'

/**
 * 左下の履歴パンくず。SPEC.md 6.6 に対応。
 *
 * 古い枝を畳む仕様にした結果、畳んだ道へ戻る手段が画面上に無くなった。
 * ここが「戻る」の入口になる。直近 BREADCRUMB_COUNT 件だけ出し、
 * 末尾(現在地)だけ白、それ以前は灰色にする。
 *
 * 項目をクリックすると、その記事を現在地にして、そこから先の経路は捨てる
 * (来た道を引き返して、別の道へ行き直す操作)。
 */
export default function Breadcrumb({ trail, onJump, onBack, disabled }) {
  if (trail.length === 0) return null

  const recent = trail.slice(-BREADCRUMB_COUNT)
  const hiddenCount = trail.length - recent.length
  const lastIndex = recent.length - 1

  return (
    <nav className="breadcrumb" aria-label="履歴">
      <button
        type="button"
        className="icon-button breadcrumb-back"
        aria-label="ひとつ戻る"
        title="ひとつ前の記事に戻る (Backspace)"
        onClick={onBack}
        disabled={disabled}
      >
        ←
      </button>
      <span className="breadcrumb-head">履歴:</span>
      {hiddenCount > 0 && (
        <>
          <span className="breadcrumb-more" title={`ほか ${hiddenCount} 件`}>
            …
          </span>
          <span className="breadcrumb-sep" aria-hidden="true">
            /
          </span>
        </>
      )}
      {recent.map((title, i) => (
        <React.Fragment key={title}>
          {i > 0 && (
            <span className="breadcrumb-sep" aria-hidden="true">
              /
            </span>
          )}
          {i === lastIndex ? (
            <span className="breadcrumb-item is-current" aria-current="page" title={title}>
              {title}
            </span>
          ) : (
            <button
              type="button"
              className="breadcrumb-item"
              onClick={() => onJump(title)}
              disabled={disabled}
              title={title}
            >
              {title}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}
