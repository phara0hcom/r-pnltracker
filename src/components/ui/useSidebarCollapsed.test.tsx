import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarCollapsed } from './useSidebarCollapsed'

const KEY = 'pnl.sidebar.collapsed'

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useSidebarCollapsed', () => {
  it('starts expanded when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarCollapsed())
    expect(result.current[0]).toBe(false)
  })

  it('adopts a stored preference after mount', () => {
    window.localStorage.setItem(KEY, 'true')
    const { result } = renderHook(() => useSidebarCollapsed())
    expect(result.current[0]).toBe(true)
  })

  it('toggles and persists', () => {
    const { result } = renderHook(() => useSidebarCollapsed())

    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('true')

    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('false')
  })

  it('treats any value other than "true" as expanded', () => {
    // A half-written or outgrown value must not collapse the sidebar.
    window.localStorage.setItem(KEY, 'yes')
    const { result } = renderHook(() => useSidebarCollapsed())
    expect(result.current[0]).toBe(false)
  })

  it('still toggles when storage throws', () => {
    // Private browsing. The preference should hold for the session rather than
    // the whole control breaking.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => useSidebarCollapsed())

    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)
  })

  it('survives a read that throws', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { result } = renderHook(() => useSidebarCollapsed())
    expect(result.current[0]).toBe(false)
  })
})
