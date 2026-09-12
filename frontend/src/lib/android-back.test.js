import { describe, expect, it, vi } from 'vitest'
import { handleAndroidBack } from './android-back.js'

const effects = () => ({
  closeSheet: vi.fn(),
  historyBack: vi.fn(),
  exitApp: vi.fn(),
})

describe('Android hardware back handling', () => {
  it('closes only the top unlocked sheet', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'android',
      sheets: [{ id: 'exercise-picker' }, { id: 'routine-picker' }],
      canGoBack: false,
      ...fx,
    })).toBe('sheet')

    expect(fx.closeSheet).toHaveBeenCalledOnce()
    expect(fx.closeSheet).toHaveBeenCalledWith('routine-picker')
    expect(fx.historyBack).not.toHaveBeenCalled()
    expect(fx.exitApp).not.toHaveBeenCalled()
  })

  it('keeps a locked top sheet open and does not exit', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'android',
      sheets: [{ id: 'locked-sheet', locked: true }],
      canGoBack: false,
      ...fx,
    })).toBe('locked')

    expect(fx.closeSheet).not.toHaveBeenCalled()
    expect(fx.historyBack).not.toHaveBeenCalled()
    expect(fx.exitApp).not.toHaveBeenCalled()
  })

  it('closes an unlocked sheet before browser history even when history is available', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'android',
      sheets: [{ id: 'routine-picker' }],
      canGoBack: true,
      ...fx,
    })).toBe('sheet')

    expect(fx.closeSheet).toHaveBeenCalledOnce()
    expect(fx.closeSheet).toHaveBeenCalledWith('routine-picker')
    expect(fx.historyBack).not.toHaveBeenCalled()
    expect(fx.exitApp).not.toHaveBeenCalled()
  })

  it('goes back through browser history when Android reports history', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'android', sheets: [], canGoBack: true, ...fx,
    })).toBe('history')

    expect(fx.historyBack).toHaveBeenCalledOnce()
    expect(fx.exitApp).not.toHaveBeenCalled()
  })

  it('exits the app only when Android reports no history and no sheet is open', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'android', sheets: [], canGoBack: false, ...fx,
    })).toBe('exit')

    expect(fx.exitApp).toHaveBeenCalledOnce()
    expect(fx.historyBack).not.toHaveBeenCalled()
  })

  it('does nothing on ordinary browser platforms', () => {
    const fx = effects()

    expect(handleAndroidBack({
      platform: 'web',
      sheets: [{ id: 'sheet' }],
      canGoBack: false,
      ...fx,
    })).toBe('noop')

    expect(fx.closeSheet).not.toHaveBeenCalled()
    expect(fx.historyBack).not.toHaveBeenCalled()
    expect(fx.exitApp).not.toHaveBeenCalled()
  })
})
