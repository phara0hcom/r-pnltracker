/**
 * One Playbook write: run it, show what the server refused, refresh on success.
 *
 * Everything is invalidated rather than a named list, as the Trades screen does:
 * a position's note, plan or link shows on the Calendar, Trades and Exit Rules too.
 *
 * It stays pending until that refetch lands, and `pendingInput` carries what was
 * sent meanwhile: a rating or a tick shows at once from it, then from the server,
 * with no gap in which it snaps back — and a refusal puts it back by itself.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { reportError } from '~/lib/observability/report'
import type { ActionResult } from '~/server/playbook'

/**
 * A validator's rejection arrives with its issues as JSON in the message, and
 * the first one is the sentence to show. Null for any other error.
 */
export function validationMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  try {
    const issues = JSON.parse(error.message) as { message?: string }[]
    return issues[0]?.message ?? null
  } catch {
    return null
  }
}

/** What the owner reads: a validator's sentence, or anything else as it stands. */
export function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not save.'
  return validationMessage(error) ?? error.message
}

export function usePlaybookAction<I, T extends object = object>(
  action: (input: I) => Promise<ActionResult<T>>,
  onDone?: (result: T) => void,
) {
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: action,
    onMutate: () => {
      setProblem(null)
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      onDone?.(result)
      return queryClient.invalidateQueries()
    },
    onError: (error: unknown) => {
      // A rejected input is the owner's to fix, not a failure for Sentry.
      if (validationMessage(error) === null) reportError(error, { mutation: 'playbook' })
      setProblem(messageOf(error))
    },
  })
  return {
    run: mutation.mutate,
    pending: mutation.isPending,
    pendingInput: mutation.isPending ? mutation.variables : undefined,
    problem,
  }
}
