import { useEffect, useRef, useState } from 'react'
import { EXIDX, imgSrc, gifSrc, videoSrc, exerciseName } from '../lib/exercises.js'
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

// True when the OS asks for reduced motion — video autoplay stays off then.
function reducedMotionPreferred() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// requestIdleCallback with a setTimeout fallback — prefetch must never block navigation.
function scheduleIdle(fn) {
  try {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 1500 })
      return
    }
  } catch { /* fall through to setTimeout */ }
  if (typeof window !== 'undefined') window.setTimeout(fn, 1)
  else { try { fn() } catch { /* never throw from prefetch */ } }
}

// Non-blocking intent prefetch for the current workout only (first N entries).
// Posters warm via `new Image()`; first video bytes warm via a deduped
// `<link rel="prefetch" as="video">`. Bounded (max 5), best-effort, never throws,
// never awaits — safe to call on hover/focus/confirm before navigating to /workout.
// Accepts workout entries ({ id }) or full exercise objects.
export function prefetchWorkoutMedia(entries, limit = 3) {
  try {
    const n = Math.min(Math.max(Number(limit) || 3, 1), 5)
    const list = (Array.isArray(entries) ? entries : []).slice(0, n)
    if (!list.length || typeof window === 'undefined' || typeof document === 'undefined') return
    scheduleIdle(() => {
      try {
        list.forEach(item => {
          const ex = item?.video || item?.img ? item : EXIDX[item?.id]
          if (!ex) return
          if (ex.img) {
            try {
              const im = new Image()
              im.decoding = 'async'
              im.src = imgSrc(ex)
            } catch { /* one failed warm must not cancel the rest */ }
          }
          if (ex.video) {
            try {
              const href = videoSrc(ex)
              if (!href || document.querySelector('link[data-wmprefetch="' + href + '"]')) return
              const link = document.createElement('link')
              link.rel = 'prefetch'
              link.as = 'video'
              link.href = href
              link.setAttribute('data-wmprefetch', href)
              document.head.appendChild(link)
            } catch { /* ignore */ }
          }
        })
      } catch { /* prefetch never blocks navigation */ }
    })
  } catch { /* prefetch never blocks navigation */ }
}
export default function Media({ ex, id, compact, minimizable, priority }) {
  // Reduced-motion users get a paused first frame; tap still plays manually.
  const [reduced] = useState(reducedMotionPreferred)
  const [playing, setPlaying] = useState(() => !reducedMotionPreferred())
  const [visible, setVisible] = useState(true)
  const [ready, setReady] = useState(false)
  const [err, onErr] = useMediaErr()
  const [gifErr, onGifErr] = useMediaErr()
  const video = useRef(null)
  const box = useRef(null)
  const gifSize = useStore(s => s.gifSize)
  const update = useStore(s => s.update)
  const hasVideo = !!ex.video
  // Offscreen videos pause; on-screen ones resume (unless the user paused them
  // or reduced motion is on). Keeps one autoplay visible instead of N at once.
  useEffect(() => {
    const node = box.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(items => {
      items.forEach(item => setVisible(item.isIntersecting))
    }, { threshold: 0.25 })
    io.observe(node)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!hasVideo || err || !video.current) return
    const node = video.current
    if (playing && visible && !reduced) {
      const promise = node.play()
      promise?.catch(() => {})
    } else node.pause()
  }, [err, hasVideo, playing, visible, reduced])
  useEffect(() => { setReady(false) }, [ex?.video, ex?.img])
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
    <div ref={box} className={cls + (ready ? ' is-ready' : ' is-loading')} id={id} onClick={() => setPlaying(p => !p)}>
      {hasVideo && !err ? <>
        {/* Poster-first: the eager poster (blurred until first frame) paints instantly
            while the deferred video loads underneath. It stays mounted so the
            blur-up fade runs on CSS; the video paints above it (see .exmedia
            CSS). fetchPriority degrades to a no-op on browsers without support. */}
        {ex.img && <img className="exmedia-poster" src={imgSrc(ex)} alt="" aria-hidden="true"
          loading={priority ? 'eager' : 'lazy'} decoding="async"
          fetchPriority={priority ? 'high' : undefined} />}
        <video ref={video} src={videoSrc(ex)} autoPlay={!reduced} loop muted playsInline
          preload={priority ? 'auto' : 'metadata'} fetchPriority={priority ? 'high' : undefined}
          poster={ex.img ? imgSrc(ex) : undefined} aria-label={exerciseName(ex)}
          onLoadedData={() => setReady(true)} onError={onErr} />
      </>
        : ex.gif && !gifErr ? <img decoding="async" loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          src={playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseName(ex)} onError={onGifErr} />
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
