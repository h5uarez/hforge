import { useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  const closeRef = useRef(null)
  const drag = useRef({ startY: null, delta: 0 })
  const returnFocus = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  const restoreFocus = () => {
    const opener = sheet.opener
    const target = opener && typeof opener.focus === 'function' ? opener : returnFocus.current
    if (target?.isConnected && typeof target.focus === 'function') setTimeout(() => target.focus(), 0)
  }
  const close = () => {
    closeSheet(sheet.id)
    restoreFocus()
  }

  // Put keyboard users on the shared close action, then return them to the control that opened
  // the sheet. Locked surfaces intentionally have no shared close action or Escape listener.
  useEffect(() => {
    if (!sheet.locked) closeRef.current?.focus()
    const onKeyDown = e => {
      if (e.key === 'Escape' && !sheet.locked && useUI.getState().sheets.at(-1)?.id === sheet.id) {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocus.current?.isConnected && returnFocus.current !== document.activeElement) returnFocus.current.focus()
    }
  }, [sheet.id, sheet.locked])

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0 }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0 }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    d.delta = e.touches[0].clientY - d.startY
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => close(), 180) }
    else el.style.transform = ''
    d.startY = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center" role="dialog" aria-modal="true">
          {!sheet.locked && <button className="iconbtn modal-close" ref={closeRef} onClick={close} aria-label={t('Close')}><span aria-hidden="true">×</span></button>}
          {sheet.render(close)}
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div className={'sheet' + (sheet.tall ? ' sheet-tall' : '')} ref={ref} role="dialog" aria-modal="true" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {!sheet.locked && <button className="iconbtn modal-close" ref={closeRef} onClick={close} aria-label={t('Close')}><span aria-hidden="true">×</span></button>}
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
