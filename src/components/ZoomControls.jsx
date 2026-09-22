import React from 'react'

/**
 * 右下のズームボタン。カメラを注視点に向かって一定比率で寄せる/引く。
 * ホイールでも同じことができるが、トラックパッドのない環境や
 * 「どこを操作すればいいか」を示す意味で置いている。
 */
export default function ZoomControls({ onZoomIn, onZoomOut, disabled }) {
  return (
    <div className="zoom-controls">
      <button
        type="button"
        className="icon-button zoom-button"
        aria-label="拡大"
        title="拡大"
        onClick={onZoomIn}
        disabled={disabled}
      >
        +
      </button>
      <button
        type="button"
        className="icon-button zoom-button"
        aria-label="縮小"
        title="縮小"
        onClick={onZoomOut}
        disabled={disabled}
      >
        −
      </button>
    </div>
  )
}
