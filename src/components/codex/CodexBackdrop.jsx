import React, { memo, useState } from 'react';

/**
 * The game's key art behind the whole chat: a heavily blurred full-bleed copy
 * for colour, plus a sharper masthead that fades out under the top bar. A new
 * game fades in over the old one, which is dropped when the fade ends; no
 * game fades the art out to the theme ambience. Decorative only.
 *
 * Props are plain strings and the component is memoised, so a streamed token
 * (which re-renders the chat) never touches this layer. Low-power mode
 * shortens the animations to 1ms rather than removing them, so the
 * animationend clean-up below still runs.
 */
function CodexBackdrop({ src }) {
  const [layers, setLayers] = useState(() => (src ? [{ src, id: 1 }] : []));
  const [shown, setShown] = useState(src);

  // Adjust-state-during-render (no effect, no extra paint).
  if (src !== shown) {
    setShown(src);
    setLayers((prev) => (src
      ? [...prev.map((l) => ({ ...l, under: true })), { src, id: (prev.at(-1)?.id ?? 0) + 1 }]
      : prev.map((l) => ({ ...l, out: true }))));
  }

  const onEnd = (layer) => setLayers((prev) => (layer.out
    ? prev.filter((l) => l.id !== layer.id)
    : prev.filter((l) => !l.under || l.id > layer.id)));

  return (
    <div className="cx-backdrop" aria-hidden="true">
      <div className="cx-backdrop__ambient" />
      {layers.map((l) => (
        <div
          key={l.id}
          className={`cx-backdrop__layer${l.out ? ' is-out' : ''}`}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget) onEnd(l); }}
        >
          <img className="cx-backdrop__blur" src={l.src} alt="" decoding="async" />
          <img className="cx-backdrop__mast" src={l.src} alt="" decoding="async" />
        </div>
      ))}
      <div className="cx-backdrop__scrim" />
    </div>
  );
}

export default memo(CodexBackdrop);
