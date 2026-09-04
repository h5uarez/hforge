import { useRef } from 'react'
import { useUI } from '../store/useUI.js'

// One toast on screen, max one queued (store). Variants ride on kind; an action
// (Undo) renders as a real button. Swipe down/side dismisses without firing the
// action — transform/opacity only, and instant under prefers-reduced-motion.
export default function Toast() {
  const msg = useUI(s => s.toastMsg)
  const kind = useUI(s => s.toastKind)
  const action = useUI(s => s.toastAction)
  const tkey = useUI(s => s.toastKey)
  const { dismissToast, runToastAction } = useUI()
  const ref = useRef(null)
  const drag = useRef({ x: null, y: null, dx: 0, dy: 0 })

  const onTouchStart = e => {
    const t = e.touches[0]
    drag.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 }
  }
  const onTouchMove = e => {
    const d = drag.current
    if (d.x === null) return
    const t = e.touches[0]
    d.dx = t.clientX - d.x
    d.dy = t.clientY - d.y
    if (Math.abs(d.dx) > 8 || d.dy > 8) {
      if (ref.current) {
        ref.current.style.transition = 'none'
        ref.current.style.transform = `translateX(calc(-50% + ${d.dx}px)) translateY(${Math.max(0, d.dy)}px)`
        ref.current.style.opacity = String(Math.max(0, 1 - (Math.abs(d.dx) + Math.abs(Math.min(0, d.dy)) + Math.max(0, d.dy)) / 120))
      }
    }
  }
  const onTouchEnd = () => {
    const d = drag.current
    if (d.x === null) return
    d.x = null
    const el = ref.current
    if (el) { el.style.transition = ''; el.style.transform = ''; el.style.opacity = '' }
    if (Math.abs(d.dx) > 60 || d.dy > 50) dismissToast()
  }

  return (
    <div id="toast" ref={ref} key={tkey} className={(msg ? 'show' : '') + (kind && kind !== 'neutral' ? ' toast-' + kind : '') + (action ? ' has-action' : '')}
      role="status" aria-live="polite"
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <span className="toast-msg">{msg}</span>
      {msg && action && <button className="toast-act" onClick={runToastAction}>{action.label}</button>}
    </div>
  )
}
