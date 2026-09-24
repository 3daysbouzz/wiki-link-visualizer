import React from 'react'

/** 外部データ由来の URL を href にしてよいか(https のみ許可。javascript: 等を弾く) */
function isHttpsUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url)
}

/**
 * 右サイドバー。ホバー中はそのノード、外れたら現在地の記事を出す。
 * SPEC.md 6.2 / 4章 に対応。
 *
 * 格納できる。低い横画面(横向きのスマートフォン)ではグラフの上に重なる
 * ドロワーになり、初期状態は閉じている。それ以外では初期状態は開いていて、
 * 閉じるとグラフ領域が広がる。開閉状態は保存しない(リロードで初期値に戻る)。
 *
 * - summary / meta が undefined のときは取得中。空パネルにせず記事名だけ先に出す
 * - 取得に失敗しても(null)エラーは出さず、取れなかった項目は「—」にする。
 *   サイドバーは補助機能なので、散歩を止めない
 * - 隣接記事はそのノードの展開結果(expansions)。未展開のノードなら一行案内を出す
 */
export default function Sidebar({
  id,
  summary,
  meta,
  adjacent,
  isCurrent,
  onSelect,
  disabled,
  open,
  onToggle,
  overlay,
}) {
  const dash = '—'
  const fmtNumber = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : dash)

  const className = [
    'sidebar',
    open ? 'is-open' : 'is-closed',
    overlay ? 'is-overlay' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // inert は「閉じている間は中の要素に触れない」ことをブラウザに伝える。
  // 幅を 0 にしただけだと Tab キーで中のボタンに入れてしまう
  return (
    <aside
      className={className}
      aria-label="選択中の記事"
      aria-hidden={!open}
      inert={open ? undefined : ''}
    >
      <div className="sidebar-head">
        {/* ラベルと記事名はひとまとまり。格納ボタンと横並びになるのはこの塊ごと
            (ばらばらに並べると記事名がボタンの横に回り込んでしまう) */}
        <div className="sidebar-head-text">
          <div className="sidebar-label">
            {isCurrent || !id ? 'SELECTED NODE' : 'HOVER NODE'}
          </div>
          <h2 className="sidebar-title">
            {id ? (summary && summary.title) || id : '記事を検索してください'}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button sidebar-close"
          aria-label="記事パネルを閉じる"
          title="記事パネルを閉じる"
          onClick={onToggle}
        >
          {/* 右向きの山括弧(パネルが右へ引っ込む向き)。絵文字は使わない */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <dl className="sidebar-meta">
        <div>
          <dt>カテゴリ</dt>
          <dd>{meta === undefined && id ? '…' : (meta && meta.category) || dash}</dd>
        </div>
        <div>
          <dt>被リンク数</dt>
          <dd>{meta === undefined && id ? '…' : fmtNumber(meta && meta.backlinks)}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{meta === undefined && id ? '…' : (meta && meta.updated) || dash}</dd>
        </div>
      </dl>

      <p className="sidebar-excerpt">
        {!id
          ? '記事名を入力すると、その記事と関連記事の3Dグラフが出ます。ノードにカーソルを乗せるとここに概要が出て、クリックするとその記事へ進みます。'
          : summary === undefined
            ? '読み込み中…'
            : (summary && summary.extract) || '概要を取得できませんでした。'}
      </p>

      {/* target="_blank" には必ず rel="noopener noreferrer" を付ける
          (開いた先のページから window.opener 経由でこの画面を操作されないため)。
          href は API から来た値なので、https の URL 以外はリンクにしない */}
      {id && summary && isHttpsUrl(summary.url) && (
        <a
          className="sidebar-link"
          href={summary.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          WIKIPEDIA で読む →
        </a>
      )}

      <div className="sidebar-adjacent">
        <div className="sidebar-label">
          隣接記事 {adjacent ? `(${adjacent.length})` : ''}
        </div>
        {adjacent ? (
          <ul className="adjacent-list">
            {adjacent.map((title) => (
              <li key={title}>
                <button
                  type="button"
                  className="adjacent-item"
                  onClick={() => onSelect(title)}
                  disabled={disabled}
                  title={title}
                >
                  <span className="adjacent-title">{title}</span>
                  <span className="adjacent-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adjacent-empty">
            {id ? 'クリックして展開すると表示されます' : dash}
          </p>
        )}
      </div>
    </aside>
  )
}
