# Reporting errors and finding slow paths

Nothing new is written to Postgres for this. `exit_feed_deliveries` stays as it
is — it answers a different question, and it is the only observability the app
renders in its own UI.

## Why an external service at all

The Vercel plan is **hobby**, where runtime logs are retained for **one hour**
and Log Drains and Observability Plus are Pro-only. The nine `console.error`
lines this app had were therefore write-only: by the time anyone knew to look,
the evidence was gone. Sentry's free Developer plan gives **5,000 errors and
10,000 spans a month** for one user, grouped and with stack traces.

## The quota is the design constraint

10,000 spans a month is tight. `defaultPreload: 'intent'` means hovering a nav
link already costs a server function call, so full tracing would exhaust the
budget in days.

- **Server traces are sampled at 5%** (`tracesSampleRate` in
  `src/instrument.server.ts`). Enough to see the shape of latency for one user.
- **Client tracing is off entirely.** `browserTracingIntegration` emits a pageload
  transaction plus ~20 resource spans per navigation, to report numbers Vercel
  Speed Insights already collects at 100% sampling.
- **Session replay is off.** It would record the portfolio screens.

A 5% sample cannot be relied on to catch a regression, and `tracesSampler`
decides at span *start*, before there is a duration to judge — so "always sample
the slow ones" is not expressible as sampling.

Two channels cover it, because a duration is two different things:

- **Every** server-function duration and **every** web vital is recorded as a
  `metrics.distribution`. A percentile over every call is what shows
  `getDashboard` drifting from 300ms to 900ms; a count of the times it was already
  slow cannot.

  Recording all of them is affordable, but **not** because they are aggregated —
  they are not. 500 `distribution` calls with an identical name and attributes
  produce 500 items on the wire, measured: one batched envelope, ~0.55 KB per
  item. It is affordable because the metrics quota is counted in **bytes**, not
  events, and one user's traffic sits orders of magnitude under it. If this app
  ever had real traffic, that arithmetic would need redoing — the volume scales
  1:1 with calls.
- Only a **slow** call (`SLOW_SERVER_FN_MS`) or a **poor** vital is *also* sent as
  an error event. The metric is the chart; the event is the part that reaches
  someone.

Metrics are **off by default in the SDK**. Without `enableMetrics: true` in both
instrument files, every `metrics.distribution` call is silently a no-op.

The threshold events are kept rather than replaced: metric-based alerting has not
been confirmed on the free plan, and a chart nobody is paged by is not an alarm.
They are rare by construction, so keeping both costs almost nothing. If metric
alerts do work there, the events can go.

## There are no automatic database spans

Nitro inlines `pg` into the server bundle — `.output/server/_libs/drizzle-orm.mjs`
contains 34 regions of it — and OpenTelemetry's instrumentation works by
intercepting the module *load* of `pg`. There is no load to intercept, so no hook
fires. Compounding it, `instrument.server.ts` is reached through two lazy dynamic
imports, so `Sentry.init` runs on the first request rather than at cold start.

**So database time is measured by hand or not at all.** That is why the spans in
`src/server/engine.ts` are not decoration: `engineFor` is the funnel for seven of
the eight GET screens, and its two halves — one round trip to Singapore at ~75ms,
then a synchronous pass in 40-digit `Decimal` — are what decide whether the fix is
co-locating the database or reducing the arithmetic.

Two levers might restore auto-instrumentation, neither tried: `nitro({ traceDeps:
['pg'] })` to externalise `pg` again, and `vercel.functions.environment.NODE_OPTIONS`
set to `--import=@sentry/tanstackstart-react/import`. Treat as an experiment.

## What may leave the machine

`src/lib/observability/scrub.ts` is the single gate, and it is pure so that the
guarantee is a unit test rather than a claim. It is wired into all four hooks —
`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` and `beforeSendMetric` —
because each is called for a different kind of payload and wiring one leaves the
others open.

Removed: request bodies, cookies, headers, the user object entirely, `extra`,
`contexts.state`, and every URL query string. Kept: messages, stack traces,
tickers, account type, counts, durations, status codes.

Three leaks that were not obvious:

1. **The TradingView secret is in the URL path.** Sentry names HTTP transactions
   after the URL, so `/api/tv/<secret>` would have appeared in issue *titles*.
   `redactTvSecret` matches the path segment rather than the configured value, so
   it cannot fail open where the secret is not available — such as the browser.
2. **Console breadcrumbs.** Sentry's console integration attaches every
   `console.error` to the next event. `server/middleware.ts` logged the rejected
   address on every failed sign-in. The log no longer names it *and* the console
   integration is disabled server-side.
3. **Auth rejections would burn the quota.** `Unauthorised` and
   `Cross-origin request rejected` are the allowlist working. Both are in
   `ignoreErrors`; without that, one crawler probing `_authed` is a burst of
   identical issues.

### The request appears in four places, not one

Stripping the query string from `event.request.url` removes almost none of it.
The same data is also in:

- **`request.query_string`** — a separate field, populated by the SDK's HTTP
  instrumentation rather than by app code, which is why nothing in this repo ever
  revealed it.
- **`request.env`** — the server's environment, `DATABASE_URL` included.
- **`sdkProcessingMetadata.normalizedRequest`** — a second, unstripped copy of url
  and headers. The name suggests it is internal bookkeeping. It is not: it reaches
  the wire verbatim. Only that one key is removed, because
  `dynamicSamplingContext` lives beside it and the envelope header is built from it.

All three were live leaks in the first version of this feature, and the
verification script passed anyway — it only populated the fields `scrub.ts`
already handled. It now sets them the way the SDK would, and
`scrub.test.ts` asserts each one.

### Source code travels with the stack trace

Sentry's `contextLines` integration reads the source file around every stack frame
and attaches it to the event. It is worth knowing because it is invisible until
you look at a raw event: an error thrown in `lib/auth.ts` ships the lines around
it. That is source, not user data, and it is the same exposure the uploaded source
maps already accept deliberately — but it means a literal written into a line near
a throw will be sent.

It also makes a naive verification script lie. `src/scripts/_scrubcheck.ts` builds
its forbidden values at runtime for exactly this reason: the first version spelled
them out, `contextLines` attached its own source, and the probe reported five leaks
that were its own text.

### Verifying it

`npx tsx --env-file=.env src/scripts/_scrubcheck.ts` captures a real event through
the real SDK with a fake transport and reports what would have been sent. It
asserts the five forbidden values are gone, the error message and stack survive,
and that `ignoreErrors` suppressed both auth rejections. Run it after touching
`scrub.ts`.

Monetary amounts are excluded by construction rather than by a filter: nothing
here puts one in a tag, span attribute or message, and bodies are dropped. A
digit-masking pass was considered and rejected — it would mangle 4-digit JP
tickers like `8411` and corrupt stack frames.

## `src/start.ts` holds CSRF protection now

This is the trap in this feature. `createStartHandler` reads:

```js
requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]
```

Until `src/start.ts` existed there was no start instance, so every server function
was CSRF-protected by that default. Creating the file — which is how global
tracing is applied without editing 28 call sites — moved that responsibility into
our hands. **Omitting `csrf` from `requestMiddleware` silently disables it**, and
the framework's only complaint is a `console.warn` gated on
`NODE_ENV !== 'production'`.

The `filter` matters as much as the middleware: without it CSRF also guards
`/api/tv/$secret`, and `allowRequestsWithoutOriginCheck` defaults to `false` —
TradingView sends no `Origin`, `Sec-Fetch-Site` or `Referer`, so every delivery
would be answered with a 403.

`src/start.test.ts` asserts both, by running the middleware rather than reading
its options.

## Unset means off

`Sentry.init({ enabled: dsn !== undefined })` on both sides, and
`lib/observability/report.ts` checks `getClient()` before doing anything. With no
DSN the whole feature is inert — no network, no console noise, no behaviour
change. That is the same stance `TRADINGVIEW_WEBHOOK_SECRET` takes, and it is what
keeps `npm test` and a fresh clone offline.

`report.ts` also never throws, a contract inherited verbatim from
`lib/prices/providers.ts`. Reporting a failure must not become one — most of all
on the TradingView route, where a 5xx is retried.
