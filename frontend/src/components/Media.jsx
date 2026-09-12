import { useEffect, useRef, useState } from 'react'
import { imgSrc, gifSrc, videoSrc, exerciseName } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles play/pause. `compact` shrinks it (superset cards).
// MP4 is preferred, with the legacy GIF as a fallback when an old row still has one.
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
// Shared error flag for media <img>s: when the backend asset server is absent
// (offline/demo) the <img> would render as a broken glyph on a white box.
// Both Media and Thumb collapse to the same styled placeholder instead.
function useMediaErr() {
  const [err, setErr] = useState(false)
  return [err, () => setErr(true)]
}
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [err, onErr] = useMediaErr()
  const [gifErr, onGifErr] = useMediaErr()
  const video = useRef(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  const hasVideo = !!ex.video
  useEffect(() => {
    if (!hasVideo || err || !video.current) return
    const node = video.current
    if (playing) {
      const promise = node.play()
      promise?.catch(() => {})
    } else node.pause()
  }, [err, hasVideo, playing])
  if (!ex.video && !ex.gif && !ex.img) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const cls = 'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')
  // Same pattern as Thumb: a failed asset collapses to the glyph placeholder
  // (same box, same sizes — see .exmedia-x), never a broken-image icon.
  if (err && !ex.gif) return (
    <div className={cls} id={id}>
      <div className="exmedia-x" role="img" aria-label={exerciseName(ex)}><Icon name="dumbbell" /></div>
    </div>
  )
  return (
    <div className={cls} id={id} onClick={() => setPlaying(p => !p)}>
      {hasVideo && !err ? <video ref={video} src={videoSrc(ex)} autoPlay loop muted playsInline preload={compact ? 'metadata' : 'auto'}
        poster={ex.img ? imgSrc(ex) : undefined} aria-label={exerciseName(ex)} onError={onErr} />
        : ex.gif && !gifErr ? <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseName(ex)} onError={onGifErr} />
          : <div className="exmedia-x" role="img" aria-label={exerciseName(ex)}><Icon name="dumbbell" /></div>}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (hasVideo || ex.gif) && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const [err, onErr] = useMediaErr()
  // No media entry, or the backend media failed to load (offline/demo without
  // the asset server): a styled glyph placeholder on surface-2, never a broken
  // white box.
  if (!ex.img || err) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" onError={onErr} />
}
