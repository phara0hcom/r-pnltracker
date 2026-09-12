/**
 * Proves the scrubbers are wired into a real Sentry client, not merely unit-tested.
 *
 * Captures an event carrying every field the contract forbids and inspects what the
 * transport would actually have sent.
 *
 * The forbidden values are assembled at runtime rather than written as literals.
 * Sentry's `contextLines` integration attaches the source lines around every stack
 * frame, so a probe with the secrets spelled out in its own source reports itself
 * as a leak — which it did, on the first attempt.
 *
 * Run: `npx tsx --env-file=.env src/scripts/_scrubcheck.ts`
 */
import * as Sentry from '@sentry/tanstackstart-react'
import {
  scrubBreadcrumb,
  scrubEvent,
  scrubMetric,
  scrubTransaction,
} from '~/lib/observability/scrub'

const parts = {
  email: ['tamer', '@', 'example', '.com'].join(''),
  secret: Array.from({ length: 4 }, () => 'a1b2c3d4e5f6a7b8').join(''),
  symbol: String(8000 + 411),
  balance: String(4831200),
  costBasis: String(1200) + '.00',
  dbUrl: ['postgresql://u', ':', 'p', '@host/db'].join(''),
  session: Array.from({ length: 2 }, () => 'f9e8d7c6b5a49382').join(''),
}

const sent: unknown[] = []

Sentry.init({
  dsn: 'https://abc123@o0.ingest.sentry.io/0',
  enabled: true,
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubTransaction(event),
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  integrations: (defaults) => defaults.filter((i) => i.name !== 'Console'),
  ignoreErrors: ['Unauthorised', 'Cross-origin request rejected'],
  sendDefaultPii: false,
  enableMetrics: true,
  beforeSendMetric: (metric) => scrubMetric(metric),
  transport: () => ({
    send: (envelope: unknown) => {
      sent.push(envelope)
      return Promise.resolve({})
    },
    flush: () => Promise.resolve(true),
  }),
})

Sentry.addBreadcrumb({
  category: 'fetch',
  message: `GET /api/tv/${parts.secret}`,
  data: { url: `https://pnl.example.com/positions?symbol=${parts.symbol}&from=2026-01-01` },
})

Sentry.withScope((scope) => {
  scope.setUser({ id: 'usr_1', email: parts.email, username: 'tamer' })
  /*
   * Set the way the SDK's HTTP instrumentation would, not the way app code does.
   * The first version of this probe only set what `scrub.ts` already handled, so
   * it reported PASS while `query_string`, `env` and the second copy of the
   * request inside `sdkProcessingMetadata` all went out untouched.
   */
  scope.addEventProcessor((event) => {
    event.request = {
      method: 'GET',
      url: `https://pnl.example.com/positions?symbol=${parts.symbol}`,
      query_string: `symbol=${parts.symbol}&account=NISA`,
      env: { DATABASE_URL: parts.dbUrl },
      cookies: { 'better-auth.session_token': parts.session },
    }
    event.sdkProcessingMetadata = {
      ...event.sdkProcessingMetadata,
      normalizedRequest: { url: `https://pnl.example.com/api/tv/${parts.secret}` },
    }
    return event
  })
  scope.setExtra('balance', parts.balance)
  scope.setContext('state', { state: { type: 'x', value: { costBasis: parts.costBasis } } })
  scope.setTransactionName(`POST /api/tv/${parts.secret}`)
  Sentry.captureException(new Error('pricing failed'))
})

Sentry.captureException(new Error('Unauthorised'))
Sentry.captureException(new Error('Cross-origin request rejected'))

// A measurement, through the same gate, with a secret smuggled into its attributes.
Sentry.metrics.distribution('server_fn.duration', 1234, {
  unit: 'millisecond',
  attributes: { serverFn: 'getDashboard', probe: `/api/tv/${parts.secret}` },
})

await Sentry.flush(2000)

const serialised = JSON.stringify(sent)
const forbidden: Record<string, string> = {
  'email address': parts.email,
  'TradingView secret': parts.secret,
  'query string (holdings)': `symbol=${parts.symbol}`,
  'extra (balance)': parts.balance,
  'contexts.state (cost basis)': parts.costBasis,
  'request.query_string': `symbol=${parts.symbol}&account=NISA`,
  'request.env (DATABASE_URL)': parts.dbUrl,
  'request.cookies (session)': parts.session,
}

console.log(`envelopes captured: ${String(sent.length)}\n`)
// The metric envelope item is not plain JSON at the top level, so inspect the
// item payload rather than substring-searching the serialised envelope.
interface MetricItem { items?: { name?: string; attributes?: Record<string, unknown> }[] }
const metricPayloads: MetricItem[] = []
for (const envelope of sent as [unknown, [{ type?: string }, MetricItem][]][]) {
  for (const [header, payload] of envelope[1]) {
    if (header.type === 'trace_metric') metricPayloads.push(payload)
  }
}
const metricJson = JSON.stringify(metricPayloads)
console.log(`metric items on the wire: ${String(metricPayloads[0]?.items?.length ?? 0)}`)
console.log(`  name: ${JSON.stringify(metricPayloads[0]?.items?.[0]?.name)}`)
console.log(
  `  attributes scrubbed: ${metricJson.includes(parts.secret) ? 'NO — secret in attributes' : 'yes'}`,
)
console.log(
  `  redaction present:   ${metricJson.includes('[redacted]') ? 'yes' : 'no marker found'}\n`,
)
let leaked = 0
for (const [label, needle] of Object.entries(forbidden)) {
  const at = serialised.indexOf(needle)
  if (at !== -1) {
    leaked++
    console.log(`LEAKED    ${label}`)
    console.log(`     ...${serialised.slice(Math.max(0, at - 150), at + 50)}...`)
  } else {
    console.log(`scrubbed  ${label}`)
  }
}

console.log(
  `\nkept for debugging: ${serialised.includes('pricing failed') ? 'yes' : 'NO'} (error message + stack)`,
)
/*
 * Inspect the envelope items rather than the serialised blob: `contextLines`
 * attaches this file's own source around the stack frame, so a substring search
 * finds the rejection strings in the *source* of the probe, not in a sent event.
 */
interface EnvelopeItem { type?: string }
type Envelope = [unknown, [EnvelopeItem, { exception?: { values?: { value?: string }[] } }][]]
const eventValues: string[] = []
for (const envelope of sent as Envelope[]) {
  for (const [header, payload] of envelope[1]) {
    if (header.type !== 'event') {
      console.log(`  (non-event envelope item: ${String(header.type)})`)
      continue
    }
    for (const ex of payload.exception?.values ?? []) eventValues.push(ex.value ?? '?')
  }
}
console.log(`\nerror events actually sent: ${JSON.stringify(eventValues)}`)
console.log(
  eventValues.some((v) => v.includes('Unauthorised') || v.includes('Cross-origin'))
    ? 'ignoreErrors: NOT working — a rejection was sent'
    : 'ignoreErrors: working — rejections suppressed',
)
console.log(leaked === 0 ? '\nPASS — nothing forbidden reached the transport' : `\nFAIL — ${String(leaked)} leak(s)`)

// Sentry's Node SDK keeps handles open; this is a one-shot probe.
process.exit(leaked === 0 ? 0 : 1)
