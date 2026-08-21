/**
 * The Trades text search, held locally and written through to the URL after a
 * pause.
 *
 * Every other filter can be bound straight to its search param, but this one
 * cannot: `navigate` commits inside a React transition, so between a keystroke
 * and the commit the input re-renders with the value from *before* that
 * keystroke and the character is lost. Typing faster than the round trip meant
 * losing most of a word — the field read as disabled.
 *
 * So the box owns its text and the URL follows. `pushed` is what this hook last
 * sent there and `seenUrl` is the last value it reacted to; together they tell a
 * URL change this hook caused (ignore it — the box is already ahead) from one it
 * did not (Clear filters, the back button, a shared link — adopt it).
 */
import { useEffect, useRef, useState } from 'react'

/** Long enough to type a word through, short enough that the URL feels current. */
const SEARCH_DEBOUNCE_MS = 250

export function useDebouncedSymbol(urlValue: string, commit: (next: string) => void) {
  const [text, setText] = useState(urlValue)
  const pushed = useRef(urlValue)
  const seenUrl = useRef(urlValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Held in a ref so the debounce below depends on the text alone. `commit` is a
  // fresh closure every render, and as a dependency it would restart the timer
  // on each one — a pause that never elapses.
  const latestCommit = useRef(commit)
  useEffect(() => {
    latestCommit.current = commit
  })

  useEffect(() => {
    if (urlValue === seenUrl.current) return
    seenUrl.current = urlValue
    if (urlValue === pushed.current) return
    // `pushed` moves too: the box now matches the URL, so there is nothing left
    // to write. Without this the debounce below sees text it has not sent and
    // commits the value straight back — a navigation that does nothing except
    // reset the page number.
    pushed.current = urlValue
    setText(urlValue)
  }, [urlValue])

  useEffect(() => {
    if (text === pushed.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      pushed.current = text
      latestCommit.current(text)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [text])

  return {
    text,
    onType: setText,
    /** Enter: apply now rather than waiting out the pause. */
    flush: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (text === pushed.current) return
      pushed.current = text
      latestCommit.current(text)
    },
    /**
     * Empty the box and drop any pending write, for callers that clear the
     * param themselves — otherwise the in-flight keystrokes land afterwards and
     * put the filter straight back.
     */
    clear: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pushed.current = ''
      setText('')
    },
  }
}

export type SymbolField = ReturnType<typeof useDebouncedSymbol>
