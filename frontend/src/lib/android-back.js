// Decide how the Android hardware back button should unwind Hforge's UI.
// The caller supplies the platform-specific effects so this remains easy to test and keeps
// browser behavior completely outside the decision itself.
export function handleAndroidBack({
  platform,
  sheets = [],
  canGoBack,
  closeSheet,
  historyBack,
  exitApp,
}) {
  if (platform !== 'android') return 'noop'

  const top = sheets.at(-1)
  if (top) {
    if (!top.locked) closeSheet(top.id)
    return top.locked ? 'locked' : 'sheet'
  }

  if (canGoBack) {
    historyBack()
    return 'history'
  }

  exitApp()
  return 'exit'
}
