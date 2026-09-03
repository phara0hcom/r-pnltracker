# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server on :3000
npm run build        # production build → .output/ (Nitro; Vercel consumes this)
npm start            # serve the build (node .output/server/index.mjs)

npm test             # vitest run
npm run test:watch
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . (type-aware; must be clean)
npm run lint:fix

npm run db:generate  # drizzle-kit generate — after editing db/schema.ts
npm run db:push      # apply to DATABASE_URL
npm run db:studio
```

Single test file / single test:

```bash
npm test -- src/lib/pnl/engine.test.ts
npm test -- -t "uses moving weighted average, not FIFO"
```

One-off scripts run through `vite-node` (or `npx tsx --env-file=.env`) so the `~` alias
and `.env` resolve: `npm run report`, `npm run seed`, and the ad-hoc reports in
`src/scripts/`.

**Verification loop for any change: `npm run typecheck && npm run lint && npm test`.**
All three must pass, and lint must be warning-free — `npx eslint src --max-warnings=0`
is the check actually used. `npm run lint:fix` handles import ordering, which is the
usual source of warnings.

### Tests depend on real, gitignored data

`csv/` holds the owner's actual Rakuten exports and is gitignored. `src/lib/import/loadFixtures.ts`
reads it directly — these are the only meaningful fixtures, because synthetic data does not
reproduce the quirks the code exists to handle. **Without `csv/`, 62 tests across 12 files fail.**
A fresh clone cannot run the suite until those exports are restored.

## Architecture

Data flows one way, and the engine is the single source of truth:

```
Shift-JIS CSV → parser → NormalizedTrade[] → runEngine() → server fn → route loader → UI
```

**`src/lib/` is pure and DB-free.** Parsers, the P&L engine, NISA quota, tax, and stats are
plain functions over plain data with no database or network access. This is what makes them
testable against the real CSVs without a DB. Keep it that way.

**The UI never does financial arithmetic.** Server functions in `src/server/` return
already-formatted strings (`Decimal` → string) and the components only render them.
`src/components/format.ts` is display-only — the comment there is load-bearing.

### Key modules

| Path | Role |
|---|---|
| `src/lib/domain/types.ts` | `NormalizedTrade`, `AccountType`, `TradeSide`, shared constants |
| `src/lib/import/tradeHistory.ts` | `detectFormat` + the three trade parsers |
| `src/lib/import/torizan.ts` | month-end statements: dividends, snapshots, cash |
| `src/lib/pnl/engine.ts` | `runEngine` — cost basis and realized events |
| `src/db/import.service.ts` | two-phase `previewImport` / `commitImport` |
| `src/server/screens.ts` | one server fn per screen; calls `runEngine` via `engineFor()` |
| `src/lib/exit/rules.ts` | swing-trade exit framework — stops, targets, trail, recommendation |
| `src/lib/exit/calendar.ts` | JP/US trading-day calendars, derived from the statutory rules |
| `src/routes/api/tv/$secret.ts` | TradingView webhook — the only unauthenticated route |
| `src/server/middleware.ts` | `authed` (composes `sameOrigin`) — supplies typed `context.userId` |

Every server function touching user data must `.middleware([authed])`. The typed
`context.userId` means a handler that forgets the check does not compile.

Routes are file-based under `src/routes/`. `_authed.tsx` guards its children in `beforeLoad`,
so an unauthenticated visitor is redirected before any loader hits the database. Filter and
sort state lives in typed search params, not component state.

## Domain rules that are easy to get wrong

These cost real debugging time and are enforced by tests — read `PLAN.md` for the full
derivation and sources.

- **Cost basis is 移動平均法** (moving weighted average), which Japanese tax rules require.
  FIFO produces different, and for filing purposes wrong, numbers. There is consequently
  **no link between an individual buy and an individual sell** — units are fungible within a pool.
- **Pools are keyed `(symbol × accountType)`.** The same ticker in 特定 and NISA is two
  independent tax lots; commingling corrupts both P&L and the NISA quota.
- **Money is `Decimal` (decimal.js) everywhere, never a float.** `Decimal.set({ precision: 40 })`
  in the engine. DB columns are `numeric(24,8)`. JPY results are rounded to whole yen via `toYen`.
- **Fund prices (基準価額) are quoted per 10,000 口** and divided down at parse time. Display
  code multiplies back up.
- **`税金等` in the JP CSV is consumption tax on commission, not capital gains tax.**
  Capital-gains withholding appears in no export and is estimated.
- **Tax year is the calendar year on a 受渡日 (settlement-date) basis**, not the trade date and
  not April–March. Rate is 20.315%.
- **Unsettled rows carry `受渡金額 = "-"`** — the amount must be derived and `isSettled` set false.
- **`再投資` rows are zero-cash buys** that add units *and* cost basis.
- **旧NISA is a separate system** and is excluded from the ¥18M lifetime cap.
- **Exit-rule entry facts are locked**: `initialStop` and R are fixed from the entry-date
  ATR and never recomputed, while everything path-dependent (highest close, Target 1 latch,
  the ratcheting trail) is *replayed* from stored bars rather than mutated — a poisoned
  high-water mark on a one-way ratchet is uncorrectable. See `docs/exit-rules.md`.

`src/lib/pnl/reconcile.test.ts` replays the engine against 10 month-end 取引残高報告書
snapshots. It is the strongest correctness check in the repo — a cost-basis or ordering bug
that would survive an end-state comparison fails here at the month it starts.

## Import pipeline

`detectFormat` classifies by header row into five formats, and they are **not** interchangeable:

- `JP` / `US` / `INVST` — the `tradehistory` exports. **The only source of trades.**
- `TORIZAN` — 取引残高報告書. The only source of dividends, plus position snapshots and cash.
- `TORIHOU` / `GAIKABU` — daily statements. **Deliberately rejected**; they duplicate the trade
  history. Uploading one yields 0 trades and an explanatory error.

Dedupe is `sourceRowHash`, unique per `(userId, sourceRowHash)`. The hash includes a **per-file
occurrence ordinal** because one order is often filled as several byte-identical executions —
without it, real trades silently collapse into one. Re-importing an overlapping export is safe.

Deletes are soft (`deletedAt`), because a hard delete would let the next import resurrect the
row via a hash that no longer exists. Manual trades are salted `MANUAL` so an import can never
match one; editing an imported trade keeps its original hash so a re-import does not revert
the correction.

## Conventions

- Import alias `~/*` → `src/*` (tsconfig + vitest + vite all configured).
- **SCSS Modules + Radix primitives.** No Tailwind, no shadcn. Dark theme only.
  All color goes through `var(--color-*)` / `var(--chart-*)` tokens in `src/styles/_tokens.scss`
  — no hardcoded hex in `*.module.scss`. Money columns use the `tabular-nums` mixin.
- ESLint is **pinned to 9** (react + jsx-a11y do not support 10) and runs type-aware rules:
  `no-unsafe-*` and `no-floating-promises` are errors. a11y rules are errors, not warnings.
- Comments explain *why*, especially where a subtle domain rule or a past bug drove the code.
  Match that density; do not add narration.

## Environment

See `SETUP.md` for the full checklist. `.env` keys: `DATABASE_URL` (Neon **pooled** `-pooler`
host), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`ALLOWED_EMAIL` (hard allowlist — empty fails closed), `FINNHUB_API_KEY`,
`TRADINGVIEW_WEBHOOK_SECRET` (24+ chars; forms the `/api/tv/<secret>` path — unset disables
the exit-rules feed rather than failing).

Price providers degrade rather than throw: Finnhub (US only) → JP scrape (Yahoo, then
kabutan) → manual override → stale cache. Nothing in `src/lib/prices/providers.ts` may
throw; a pricing outage must never break a render. Yahoo rate-limits by IP and returns
429 under light use, so the second JP source is load-bearing, not decorative.
`hasQuotableTicker` gates the whole chain — funds are named, not coded, in every Rakuten
export, so they are skipped rather than attempted and never count as a provider failure. Settings → *Check connections* probes each source live and
distinguishes a missing key from a rate limit.

`PLAN.md` is the original design document with the full rationale and validation strategy.
