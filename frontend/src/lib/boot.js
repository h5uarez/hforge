// Keep the inline splash in place until the browser's next frame gives React
// a commit opportunity after createRoot().render().
export function removeSplashOnNextFrame() {
  const remove = () => document.getElementById('splash')?.remove()
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(remove)
      return
    }
  } catch { /* use the timer fallback */ }
  if (typeof setTimeout === 'function') setTimeout(remove, 0)
  else remove()
}
