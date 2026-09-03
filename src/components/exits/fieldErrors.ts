/**
 * Turns a rejected server function into per-field messages.
 *
 * Shared by the two exit forms. It also guards the `.issues` lookup, which both
 * copies used to read straight off an `unknown` — a thrown string or a null
 * rejection became a TypeError inside the error handler, so the form showed
 * nothing at all instead of a message.
 */
export function toFieldErrors(error: unknown): Record<string, string> {
  const issues =
    typeof error === 'object' && error !== null && 'issues' in error
      ? (error as { issues?: { path: (string | number)[]; message: string }[] }).issues
      : undefined

  if (issues && issues.length > 0) {
    return Object.fromEntries(
      issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]),
    )
  }

  return { form: error instanceof Error ? error.message : 'Could not save' }
}
