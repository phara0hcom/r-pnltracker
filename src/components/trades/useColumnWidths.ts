/**
 * Persisted, drag-resizable column widths.
 *
 * Widths live in `localStorage` rather than the URL: they are a personal display
 * preference, not part of what a shared link should carry — a colleague opening
 * your filtered view should not inherit your column sizes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'pnl.trades.columnWidths'
const MIN_WIDTH = 56

export type ColumnWidths = Record<string, number>

function load(defaults: ColumnWidths): ColumnWidths {
  if (typeof window === 'undefined') return defaults
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaults
    // Merge over defaults so a newly added column still gets a sensible width.
    return { ...defaults, ...(parsed as ColumnWidths) }
  } catch {
    return defaults
  }
}

export function useColumnWidths(defaults: ColumnWidths) {
  // Server render must not read localStorage, so start from defaults and adopt
  // the stored values after mount to avoid a hydration mismatch.
  const [widths, setWidths] = useState<ColumnWidths>(defaults)

  // Held in a ref so the adopt-on-mount effect has genuinely empty deps rather
  // than a suppressed lint warning.
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  useEffect(() => {
    setWidths(load(defaultsRef.current))
  }, [])

  const persist = useCallback((next: ColumnWidths) => {
    setWidths(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private browsing or a full quota — resizing still works for this session.
    }
  }, [])

  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const onResizeStart = useCallback(
    (key: string, event: React.PointerEvent) => {
      event.preventDefault()
      const startWidth = widths[key] ?? defaults[key] ?? 100
      drag.current = { key, startX: event.clientX, startWidth }

      const onMove = (e: PointerEvent) => {
        const d = drag.current
        if (!d) return
        const next = Math.max(MIN_WIDTH, d.startWidth + (e.clientX - d.startX))
        setWidths((w) => ({ ...w, [d.key]: next }))
      }

      const onUp = () => {
        const d = drag.current
        drag.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (d) setWidths((w) => { persist(w); return w })
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [widths, defaults, persist],
  )

  /** Keyboard resizing — a drag handle that only responds to a pointer is unusable. */
  const onResizeKey = useCallback(
    (key: string, event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 40 : 12
      const current = widths[key] ?? defaults[key] ?? 100
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        persist({ ...widths, [key]: Math.max(MIN_WIDTH, current - step) })
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        persist({ ...widths, [key]: current + step })
      }
    },
    [widths, defaults, persist],
  )

  const reset = useCallback(() => {
    persist(defaults)
  }, [defaults, persist])

  return { widths, onResizeStart, onResizeKey, reset }
}
