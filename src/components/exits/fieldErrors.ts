/**
 * Turns a rejected server function into per-field messages.
 *
 * A validator's rejection crosses the wire as an Error whose message is its issues
 * as JSON, so that is where they are read from: the owner sees one sentence on the
 * field it is about, never the JSON. Anything else is one message for the form,
 * and a thrown string or a null rejection is still a message rather than a
 * TypeError inside the error handler.
 */
interface Issue {
  path?: (string | number)[]
  message?: string
}

function issuesIn(message: string): Issue[] {
  try {
    const parsed: unknown = JSON.parse(message)
    return Array.isArray(parsed) ? (parsed as Issue[]) : []
  } catch {
    return []
  }
}

export function toFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { form: 'Could not save' }
  const issues = issuesIn(error.message).filter((issue) => typeof issue.message === 'string')
  if (issues.length === 0) return { form: error.message }
  return Object.fromEntries(issues.map((issue) => [String(issue.path?.[0] ?? 'form'), issue.message!]))
}
