import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { applyWaitingUpdate, describeUpdateState, onSwUpdate } from '../lib/pwa.js'

// Update banner: appears only after a new service worker is installed AND
// waiting. Never reloads on its own — the user picks the moment. During an
// active workout the banner says so explicitly and offers the reload as a
// secondary, clearly-marked action instead of the primary one.
export default function PwaUpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const workoutActive = useStore(s => !!s.S.active)

  useEffect(() => onSwUpdate(() => setHasUpdate(true)), [])

  if (!hasUpdate) return null
  const state = describeUpdateState({ hasUpdate, workoutActive })

  if (state === 'deferred') {
    return (
      <div className="pwa-banner" role="status" data-testid="pwa-update-banner" data-state="deferred">
        <div className="pwa-banner-t">
          {t('A new version is ready — finish your workout first, then reload to apply it.')}
        </div>
        <div className="pwa-banner-acts">
          <button className="btn sm tinted" onClick={() => applyWaitingUpdate()}>
            {t('Reload anyway')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="pwa-banner" role="status" data-testid="pwa-update-banner" data-state="ready">
      <div className="pwa-banner-t">{t('A new version of Hforge is ready.')}</div>
      <div className="pwa-banner-acts">
        <button className="btn sm primary" onClick={() => applyWaitingUpdate()}>
          {t('Update now')}
        </button>
      </div>
    </div>
  )
}
