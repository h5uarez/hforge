import { useEffect, useRef, useState } from 'react'
import { EXIDX, imgSrc, gifSrc, videoSrc, exerciseName } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles play/pause. `compact` shrinks it (superset cards).
// MP4 is preferred, with the legacy GIF as a fallback when an old row still has one.
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds persistent minimize/expand and animation controls so the
// animation stops eating the screen; the chosen preferences carry across exercises and workouts.
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
  const workoutScoped = !!minimizable
  // Sheets, library cards, and exercise details keep their existing local playback behavior.
  // Only the active workout subscribes to the persisted animation preference.
  const workoutMediaEnabled = useStore(s => workoutScoped ? s.S.workoutMediaEnabled !== false : true)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  // Reduced-motion users get a paused first frame; tap still plays manually.
  const [reduced] = useState(reducedMotionPreferred)
  const [playing, setPlaying] = useState(() => !reduced && workoutMediaEnabled)
  const [visible, setVisible] = useState(true)
  const [ready, setReady] = useState(false)
  const [mediaRatio, setMediaRatio] = useState(null)
  const [err, onErr] = useMediaErr()
  const [gifErr, onGifErr] = useMediaErr()
  const video = useRef(null)
  const box = useRef(null)
  const hasVideo = !!ex.video
  const mediaPlaying = workoutScoped ? workoutMediaEnabled && playing : playing
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
    if (workoutScoped) setPlaying(workoutMediaEnabled && !reduced)
  }, [workoutScoped, workoutMediaEnabled, reduced])
  useEffect(() => {
    if (!hasVideo || err || !video.current) return
    const node = video.current
    if (mediaPlaying && visible && !reduced) {
      const promise = node.play()
      promise?.catch(() => {})
    } else node.pause()
  }, [err, hasVideo, mediaPlaying, visible, reduced])
  useEffect(() => {
    setReady(false)
    setMediaRatio(null)
  }, [ex?.video, ex?.gif, ex?.img])
  if (!ex.video && !ex.gif && !ex.img) return null
  const mini = minimizable && gifSize === 'mini'
  const setRatioFromMedia = node => {
    const width = node?.naturalWidth || node?.videoWidth
    const height = node?.naturalHeight || node?.videoHeight
    if (width > 0 && height > 0) setMediaRatio(width / height)
  }
  const togglePlaying = () => {
    const next = !mediaPlaying
    setPlaying(next)
    if (workoutScoped) update(s => { s.workoutMediaEnabled = next })
  }
  const toggleSize = e => {
    e.stopPropagation()
    const expanding = mini
    update(s => { s.gifSize = s.gifSize === 'mini' ? 'full' : 'mini' })
    // Expanding is an explicit request to see the exercise again, but it must
    // never override the workout-wide animation preference or reduced motion.
    if (expanding && workoutScoped && workoutMediaEnabled && !reduced) setPlaying(true)
  }
  const cls = 'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')
  const mediaStyle = mediaRatio ? { '--media-ratio': String(mediaRatio) } : undefined
  // Same pattern as Thumb: a failed asset collapses to the glyph placeholder
  // (same box, same sizes — see .exmedia-x), never a broken-image icon.
  if (err && !ex.gif) return (
    <div className={cls} id={id} style={mediaStyle}>
      <div className="exmedia-x" role="img" aria-label={exerciseName(ex)}><Icon name="dumbbell" /></div>
    </div>
  )
  return (
    <div ref={box} className={cls + (ready ? ' is-ready' : ' is-loading')} id={id} style={mediaStyle} onClick={togglePlaying}>
      {hasVideo && !err ? <>
        {/* Poster-first: the eager poster (blurred until first frame) paints instantly
            while the deferred video loads underneath. It stays mounted so the
            blur-up fade runs on CSS; the video paints above it (see .exmedia
            CSS). fetchPriority degrades to a no-op on browsers without support. */}
        {ex.img && <img className="exmedia-poster" src={imgSrc(ex)} alt="" aria-hidden="true"
          loading={priority ? 'eager' : 'lazy'} decoding="async"
          fetchPriority={priority ? 'high' : undefined} onLoad={e => setRatioFromMedia(e.currentTarget)} />}
        <video ref={video} src={videoSrc(ex)} autoPlay={!reduced && mediaPlaying} loop muted playsInline
          preload={priority ? 'auto' : 'metadata'} fetchPriority={priority ? 'high' : undefined}
          poster={ex.img ? imgSrc(ex) : undefined} aria-label={exerciseName(ex)}
          onLoadedMetadata={e => setRatioFromMedia(e.currentTarget)}
          onLoadedData={() => setReady(true)} onError={onErr} />
      </>
        : ex.gif && !gifErr ? <img decoding="async" loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          src={mediaPlaying ? gifSrc(ex) : imgSrc(ex)} alt={exerciseName(ex)} onLoad={e => setRatioFromMedia(e.currentTarget)} onError={onGifErr} />
          : <div className="exmedia-x" role="img" aria-label={exerciseName(ex)}><Icon name="dumbbell" /></div>}
      {minimizable && (
        <button type="button" className="giftoggle" aria-label={mini ? t('Expand') : t('Minimize')} aria-pressed={mini} onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {(hasVideo || ex.gif) && (
        <button type="button" className="gifhint" aria-label={mediaPlaying ? t('tap to pause') : t('tap to play')}
          aria-pressed={mediaPlaying} onClick={e => { e.stopPropagation(); togglePlaying() }}>
          <Icon name={mediaPlaying ? 'pause' : 'play'} />{mediaPlaying ? t('tap to pause') : t('tap to play')}
        </button>
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
