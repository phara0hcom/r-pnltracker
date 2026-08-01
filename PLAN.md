# Rakuten Securities P&L Tracker

## Context

The user trades through a Rakuten Securities account across taxable (特定) and three NISA account types, spanning Japanese equities, US equities, and Japanese mutual funds. Today the only record is three Shift-JIS CSV exports sitting in `csv/` — 315 trades from Jun 2022 to Jul 2026 — with no way to see aggregate performance, no cost-basis tracking, and no visibility into the tax bill Rakuten will withhold.

The goal is a deployed, password-protected web app that imports those CSVs, computes correct realized/unrealized P&L under Japanese cost-basis rules, and pairs the numbers with a trading journal (calendar + mood/motivation notes) so patterns between mental state and results become visible.

**Non-obvious constraints discovered during exploration** — these drive most of the design:

1. **Three incompatible CSV schemas**, all Shift-JIS: JP (28 cols), US (18 cols), INVST/funds (14 cols).
2. **Fund prices are quoted per 10,000 units** (基準価額). `96,016 units @ 20,830 → ¥200,000`. Verified.
3. **Unsettled rows carry `受渡金額 = "-"`** — 6 such rows exist (trades dated today). Amounts must be *derived*, never read blindly.
4. **US trades settle in either JPY or USD** — exactly one of the two amount columns is populated; the other is `"-"`. Every row carries its own FX rate.
5. **`再投資` (reinvestment) rows are zero-cash buys** that add units. If they don't hit cost basis, fund P&L is massively overstated.
6. **`税金等` in the JP CSV is consumption tax on commission (exactly 10% of fee), NOT capital gains tax.** Capital-gains withholding appears nowhere in these exports and must be estimated.
7. **Cost basis pools are per (instrument × account type)** — 特定 and NISA holdings of the same ticker are separate tax lots and must never be commingled.
8. **Japanese securities tax is calendar-year (Jan 1–Dec 31) on a 受渡日 (settlement-date) basis** — confirmed against 楽天証券 / 国税庁 guidance. Not April–March (that's 年度, the fiscal/budget year).
9. **Finnhub's free tier is US-only.** It covers 39 US tickers but none of the 20 JP tickers or 10 funds — roughly 78% of traded value (¥49.8M of ¥64.2M) needs another price source.

## Data sources

Five Rakuten export formats plus one XML, all Shift-JIS (XML is UTF-8). Located in `csv/` and `csv/statements/`.

| File | Cadence | Contains | Role |
|---|---|---|---|
| `tradehistory(JP\|US\|INVST)_*.csv` | on-demand | 315 trades, Jun 2022 → Jul 2026 | **primary trade source** |
| `*_torizan.csv` (取引残高報告書) | monthly ×10 | month-end holdings, cash ledger, **dividends** | dividends + position oracle |
| `*_torihou.csv` (取引報告書) | daily ×15 | domestic trades, incl. margin/bond/futures sections | redundant with JP history |
| `*_gaikabu.csv` (外国株式) | daily ×13 | US trades with **SEC fee broken out** | fee detail |
| `2025_nentori.xml` (年間取引報告書) | annual | official 2025 tax figures | **ground-truth validation** |

**Import priority**: `tradehistory` is authoritative for trades; `torizan` is the only source of dividends; `gaikabu`/`torihou` are redundant for trades and imported only for fee refinement. The `sourceRowHash` dedupe means overlapping files are safe to import in any order.

**Dividends — 6 payouts, ¥60,119**, found in `torizan` under 取引明細（金銭及び有価証券の推移）:

- `配当金` = equity dividends (みずほFG ×2, ONE ETF 日経225, フルキャスト)
- `分配金` = fund distributions (GSテクノロジー ×2)
- **Fund distributions are immediately followed by a `特定再投資` row** buying units with that exact cash. Each distribution is therefore *both* income *and* a cost-basis-increasing purchase — booking only one side corrupts fund P&L.
- **No US dividends present** despite holdings in KO, AAPL, KMB, DVN, BKR, RIO, XLE. Rakuten reports these in a separate 外国株式配当金計算書 not included in this export (see `SETUP.md` §5). US dividend income is a known gap until that file is supplied.

**Ground-truth validation anchors** (from `2025_nentori.xml`, the official 特定口座年間取引報告書):

- Every 譲渡 (capital gains) field is **0** for 2025 — independently confirmed by the trade data, which has **zero 特定 sells settling in 2025**. 72 of 73 taxable sells settle in **2026**.
- Dividend withholding: **¥927 gross − ¥142 income tax − ¥46 local = ¥739 net**, matching the 2025/12/05 分配金 row exactly. Validates the 15.315% / 5% split to the yen.
- `torizan` month-end holdings give **10 monthly checkpoints** to assert computed positions against — a far stronger test than a single end-state comparison.

⚠️ **`2025_nentori.xml` contains PII** (full name, address, date of birth). The parser must extract only the financial fields (`ZLF*` codes) and never persist or log the `ZLE*` identity block. `csv/` is gitignored.

## Decisions (confirmed with user)

| Area | Decision |
|---|---|
| Stack | TanStack Start `1.168.x` (Vite) + React 19 + TypeScript, deployed on Vercel (zero-config) |
| Routing/data | TanStack Router (typed search params) + TanStack Query `5.101.x` + TanStack Table `8.21.x` |
| UI | SCSS Modules + Radix UI Primitives (unstyled), dark mode only |
| Auth | Better Auth `1.6.x`, Google OAuth, single-user email allowlist |
| DB | Neon Postgres (Vercel Marketplace) + Drizzle ORM |
| Cost basis | Moving weighted average (移動平均法) — matches Rakuten 特定口座 |
| Prices | Finnhub for US; best-effort scrape for JP + funds; aggressive cache, stale-on-failure |
| Fetch timing | Lazy, on page visit — never a background cron (free-tier quota) |
| Currency | JPY base everywhere; JPY/USD toggle scoped to US positions only |
| Tax | 20.315% on 特定 realized gains only; NISA shown separately as tax-free |

**One correction applied:** the user asked for an Apr 1–Mar 31 tax year. Japanese individual securities tax is calendar-year on settlement-date basis, so the tax report **defaults to Jan–Dec** (so the figure matches Rakuten's 年間取引報告書 and actual withholding). An Apr–Mar toggle is included as a secondary view for personal budgeting, clearly labelled as non-tax-official.

---

## Architecture

```
src/
  routes/
    __root.tsx              shell, QueryClientProvider, globals.scss
    index.tsx               → redirect to /dashboard or /signin
    signin.tsx              Google sign-in
    _authed.tsx             auth guard — beforeLoad throws redirect
    _authed/
      dashboard.tsx         KPIs, equity curve, allocation
      trades.tsx            table; typed search params for filters+sort
      calendar.tsx          month grid: daily P&L + mood
      positions.tsx         open positions, unrealized P&L
      tax.tsx               per-year tax estimate + YoY comparison
      nisa.tsx              lifetime ¥18M + annual quota
      stats.tsx             win rate, drawdown, streaks, FX attribution
      import.tsx            CSV upload + dry-run preview
      settings.tsx          manual price overrides
    api/auth/$.ts           Better Auth handler
  server/                   createServerFn endpoints
    trades.ts  prices.ts  import.ts  notes.ts
  lib/
    import/                 parsers (shift-jis → normalized trades)
    pnl/                    cost basis + realized/unrealized engine
    prices/                 finnhub | scrape | manual providers
    tax/                    Japanese tax estimation
    nisa/                   quota engine (lifetime + annual)
    stats/                  trading statistics
    auth.ts                 Better Auth config
  components/ui/            Radix primitives wrapped + SCSS-styled
  styles/                   tokens, mixins, globals
  db/schema.ts              Drizzle schema
```

**Server access** goes through `createServerFn` (typed, no hand-written REST layer). Route `loader`s prefetch into the Query cache so first paint is server-rendered, then Query owns client-side refetch and invalidation.

**Typed search params** — the main reason for Start. The trades route validates its own filter/sort state:

```ts
// routes/_authed/trades.tsx
validateSearch: (s) => tradeFilterSchema.parse(s)
// → { from?, to?, account?, assetClass?, symbol?, side?, outcome?, sortBy, sortDir }
```

`Route.useSearch()` returns it fully typed, and `navigate({ search: prev => ... })` updates it. Filter state lives in the URL, so views are shareable and survive refresh — with compile-time safety instead of manual `URLSearchParams` parsing. Same pattern for the calendar's `?month=` and tax/stats `?year=`.

### Data model (Drizzle, `db/schema.ts`)

- `user`, `session`, `account`, `verification` — Better Auth's Drizzle schema (generate via `better-auth` CLI, don't hand-write)
- `instruments` — `symbol`, `name`, `assetClass` (`JP_EQUITY|US_EQUITY|FUND`), `currency`, `exchange`, `isin`
- `trades` — `tradeDate`, `settleDate`, `instrumentId`, `accountType` (`SPECIFIC|NISA_OLD|NISA_GROWTH|NISA_TSUMITATE`), `side` (`BUY|SELL|REINVEST|REDEEM`), `quantity`, `unitPrice`, `fee`, `feeTax`, `otherCost`, `fxRate`, `settleCurrency`, `grossAmount`, `netAmount`, `isSettled`, `sourceRowHash` **(unique — enables safe re-import of overlapping exports)**
- `priceCache` — `instrumentId`, `price`, `currency`, `asOf`, `source`, `fetchedAt`, `isStale`
- `fxRates` — `base`, `quote`, `rate`, `asOf`
- `dividends` — `payDate`, `instrumentId`, `accountType`, `kind` (`DIVIDEND|DISTRIBUTION`), `grossAmount`, `incomeTax`, `localTax`, `netAmount`, `currency`, `reinvestedTradeId` (nullable FK → `trades`), `sourceRowHash`
- `cashMovements` — `date`, `kind` (`DEPOSIT|WITHDRAWAL|TRANSFER`), `amount`, `currency` — from the `torizan` ledger; enables true time-weighted return later
- `positionSnapshots` — `asOf`, `instrumentId`, `accountType`, `quantity`, `valuation` — parsed from `torizan` month-end holdings, used purely to assert engine correctness
- `notes` — `date`, `title`, `body`, `mood` (1–5), `motivation` (1–5), `tags[]`
- `importBatches` — `filename`, `fileType`, `rowsParsed`, `rowsInserted`, `rowsSkipped`, `importedAt`

Store all money/quantity as `numeric`, handled via `decimal.js` in app code. **Never floats** — fund unit counts run to 6+ significant digits and rounding drift compounds across 315 trades.

---

## Implementation

### 1. CSV import (`lib/import/`)

Decode Shift-JIS with `iconv-lite` (`iconv.decode(buffer, 'Shift_JIS')`), parse with `csv-parse`. Detect file type by matching the header row — `ティッカー` → US, `銘柄コード` → JP, `ファンド名` → INVST.

Normalizer per format, all emitting a common `NormalizedTrade`:

- **JP**: `gross = qty × price`; buy `net = gross + fee + feeTax + other`, sell `net = gross − fee − feeTax − other`. *(Verified against all 65 settled rows.)*
- **US**: `gross = 約定代金USD`; buy `net = gross + fee + tax`, sell `net = gross − fee − tax`. JPY value = `net × fxRate`. Pick whichever amount column isn't `"-"`.
- **INVST**: `unitPrice = 基準価額 / 10000`; `gross = qty × unitPrice`. Map `買付`→BUY, `解約`→REDEEM, `再投資`→REINVEST.

When `受渡金額 = "-"`, derive the amount and set `isSettled = false`.

Dedupe on `sourceRowHash = sha256(tradeDate|symbol|account|side|qty|price)`. Import is a **dry-run preview first** (shows new / duplicate / error counts), then commit — so re-uploading a fresh export that overlaps history is safe.

### 2. P&L engine (`lib/pnl/`)

Pure functions over a chronologically sorted trade list, keyed by `(instrumentId, accountType)`:

```
BUY / REINVEST → qty += q;  costBasis += net       (REINVEST: net = gross, no cash out)
SELL / REDEEM  → avgCost = costBasis / qty
                 realized = netProceeds − (avgCost × q)
                 costBasis -= avgCost × q;  qty -= q
```

Sort by `tradeDate`, tie-broken by side (BUY before SELL) so same-day round trips — e.g. 8411 bought and sold on 2026/7/29 — resolve correctly rather than selling from a position that doesn't exist yet.

Unrealized = `(currentPrice − avgCost) × qty`, in JPY using the latest cached FX rate.

Emit both a trade-date series (for performance views) and a settlement-date series (for tax).

### 3. Prices (`lib/prices/`)

Provider chain, tried in order, first success wins:

1. **Finnhub** (`/quote?symbol=`) — US equities only. Key in env.
2. **Scrape** — JP equities and fund NAVs, best-effort.
3. **Manual override** — user-entered value from Settings.
4. **Stale cache** — last known price, surfaced in the UI with an "as of" timestamp.

FX via `open.er-api.com/v6/latest/USD` (free, no key, verified working).

Rules: fetch only on visit, only for instruments with an open position, only when cache is older than the TTL. Batch with a concurrency cap. **Any provider failure is non-fatal** — it falls through to stale and the UI shows a staleness badge rather than an error. Scraping is isolated behind the provider interface so it can be swapped or dropped without touching the P&L engine.

**TanStack Query does most of the caching work here** — its stale-while-revalidate model is exactly the requested "serve stale data when we hit the rate limit" behaviour, so no bespoke cache layer is needed:

```ts
useQuery({
  queryKey: ['prices', instrumentIds],
  queryFn: fetchPrices,          // server fn; never throws on provider failure
  staleTime: 15 * 60_000,        // intraday TTL
  gcTime: Infinity,              // keep last-known prices for the session
  placeholderData: keepPreviousData,
  retry: 1,
  refetchOnWindowFocus: false,   // protects the free-tier quota
})
```

The DB `priceCache` row remains the durable stale store across sessions; Query is the in-session layer. Server fn returns `{ price, asOf, source, isStale }` and the badge renders from `asOf`, so a rate-limited fetch degrades silently to last-known rather than erroring.

### 4. Tax (`lib/tax/`)

Filter to `accountType = SPECIFIC` and group realized P&L by **settlement-date calendar year**. Net gains against losses within the year; if the year nets negative, tax owed is zero and the loss is reported as carryforward-eligible (informational — requires filing a return, not automatic under 源泉徴収あり).

`estimatedTax = max(0, netGain) × 0.20315` (15% income + 0.315% reconstruction + 5% local).

NISA realized gains displayed separately, labelled tax-free. Page carries a plain disclaimer that this is an estimate, not tax advice.

### 5. UI

**SCSS Modules + Radix UI Primitives**, dark mode only. No Tailwind, no shadcn (shadcn is Tailwind-coupled — Radix primitives are consumed directly and styled by hand).

```
styles/
  _tokens.scss      design tokens as CSS custom properties on :root
  _mixins.scss      media queries, focus rings, numeric-tabular helper
  globals.scss      reset + base typography + token import
components/**/X.module.scss
```

Tokens live as CSS custom properties (`--color-bg`, `--color-profit`, `--color-loss`, `--space-*`, `--radius-*`, `--font-*`) declared once on `:root`, consumed from modules via `var()`. Sass handles nesting, `@use` partials, and mixins; runtime theming stays in custom properties. Dark palette is the only theme — tokens are defined once, not behind a media query.

**Radix primitives used**: `Dialog` (note editor), `Popover` (filters), `Select`, `Tabs` (dashboard sections), `Slider` (mood/motivation), `Tooltip` (chart + staleness badges), `DropdownMenu` (account switcher), `Toggle Group` (JPY/USD switch), `ScrollArea`. Each wrapped in a local styled component (`components/ui/Select/`) exposing a project-level API, so Radix stays swappable.

Styling Radix requires state-attribute selectors rather than utility classes — e.g. `&[data-state='open']`, `&[data-disabled]`, `&[data-highlighted]`. Codify these in a `_mixins.scss` helper so every primitive gets consistent focus/hover/open treatment.

**Financial number rendering**: `font-variant-numeric: tabular-nums` on all money columns so digits align in the trades table — a mixin, applied everywhere P&L appears.

TanStack Table (headless, style-agnostic) for the trades grid — column sort, plus filters for date range, account type, asset class, symbol, side, and a P&L win/loss filter. Table state is **driven from the route's typed search params**, not local component state, so the URL is the single source of truth. Recharts for charts, with colors read from the same CSS custom properties so charts and UI never drift.

**Calendar**: month grid built as a CSS Grid in SCSS (no calendar library), each day tinted green/red by realized P&L magnitude, with a mood emoji when a note exists. Click a day → Radix `Dialog` to read/write a note with mood (1–5), motivation (1–5), free text, and tags.

### 5b. Manual trade entry & editing (`lib/trades/manual.ts`, `db/trades.service.ts`)

Trades can be hand-entered and hand-corrected, not only imported. Once created a
manual trade is indistinguishable to the engine — both paths produce the same
`NormalizedTrade`. What differs is provenance and how imports treat them.

Three rules govern the interaction with CSV import, each a place a naive
implementation loses data:

| Rule | Why |
|---|---|
| A manual trade is never matched or overwritten by an import | Its hash is salted with `MANUAL`, so it cannot collide with a CSV row |
| Editing an imported trade **keeps** its `sourceRowHash` | Re-importing the same CSV then skips the row, so the correction is not silently reverted |
| Deleting is a **soft** delete (`deletedAt` tombstone) | A hard delete would let the next import resurrect the row, since dedupe matches on a hash that would no longer exist |

`purgeManualTrade` allows a genuine hard delete, but only for `origin='MANUAL'`
— there is no CSV that could recreate those, so no tombstone is needed.

Validation (zod) enforces the same invariants the parsers do: positive quantity
and price, settlement not before trade date, fund prices entered as 基準価額
(per 10,000 口), and **a mandatory USD/JPY rate on US trades** — without it a
$200 stock would book at ¥200. Rates outside 50–400 are flagged as likely
decimal-point typos. Form input is parsed as strings straight into `Decimal`, so
`Number()` never touches a monetary value.

### 6. NISA screen (`lib/nisa/`, `app/(app)/nisa/`)

Dedicated screen for lifetime and annual quota. Four rules govern it, all verified against 三菱UFJ銀行 / 楽天証券 guidance — each one is a place a naive implementation gets it wrong:

| Rule | Implementation consequence |
|---|---|
| ¥18M lifetime cap is tracked at **簿価残高 (book value)** | Quota consumed = acquisition cost. Gains never consume quota. |
| Selling restores quota at **acquisition cost, in January of the following year** | A 2026 sell restores in Jan 2027 — never within the same year. |
| Annual quotas **never** restore | ¥1.2M / ¥2.4M are use-it-or-lose-it, independent of the ¥18M pool. |
| **旧NISA is a separate system** | The 2022–23 旧NISA buys (¥2,238,252) must be **excluded** from the ¥18M. |

Limits: つみたて投資枠 ¥1.2M/yr, 成長投資枠 ¥2.4M/yr (combined ¥3.6M/yr), lifetime ¥18M with a ¥12M sub-cap on 成長投資枠.

```
lifetimeUsed(asOf) = Σ acquisitionCost(new-NISA buys)
                   − Σ acquisitionCost(positions sold in years < currentYear)
```

Sells are attributed at the **moving-average cost of the units sold**, reusing the existing P&L engine's cost-basis output — not recomputed separately.

Screen shows: lifetime ring (used / ¥18M) with the 成長 ¥12M sub-cap as an inner track; per-year bars for both frames vs their caps; a "restoring in Jan {year+1}" callout for quota freed by the current year's sells; and remaining headroom per frame.

Validated against real data — 2026 成長投資枠 is at **¥2,400,000, exactly the annual cap**, so the screen must render a maxed state correctly, not just partial fills.

### 7. Trading stats (`lib/stats/`)

Computed over closed round trips (each SELL/REDEEM produces a realized event with an entry cost and holding period):

- **Win rate** — winning closes / total closes
- **Avg win vs avg loss** — mean realized P&L of positive vs negative closes
- **Profit factor** — Σ gains / |Σ losses| (guard: `Infinity` when no losses, render as "—")
- **Max drawdown** — peak-to-trough on the cumulative realized equity curve, in JPY and %
- **Longest win / loss streak** — consecutive closes by date order
- **Avg holding period** — weighted by position size; per close, `sellDate − weighted-avg buy date` of the units sold

All filterable by account type, asset class, and date range so JP/US/fund behaviour can be compared. Edge cases to handle explicitly: zero closes, all-wins (no losses), and single-trade history.

### 8. Currency attribution (`lib/pnl/fx-attribution.ts`)

Splits US-position JPY P&L into stock movement vs FX movement. For quantity `q`, entry price/rate `P₀,R₀`, exit `P₁,R₁`:

```
stockEffect = (P₁ − P₀) × R₁ × q      // stock move, valued at exit FX
fxEffect    = P₀ × (R₁ − R₀) × q      // yen move, applied to original cost
total       = P₁R₁q − P₀R₀q           // exact — the two terms sum with no residual
```

This two-term form is chosen deliberately over the textbook three-term split (stock / FX / cross-product) because it is **exact with no leftover interaction term**, so the two bars always add to the headline number. Convention documented in-code.

`R₀` is the weighted-average FX rate of the units sold (tracked alongside cost basis in the same pool); `R₁` is the trade's own rate for realized, or the current cached rate for unrealized. Applies to US positions only — JP equities and funds are natively JPY.

Rendered as a stacked bar per position plus a portfolio-level total, answering "how much of my US return was the yen?" Given USD/JPY ranged 143–159 across the history, this is expected to be material.

### 9. Year-over-year comparison (`app/(app)/tax/`, YoY section)

Table + grouped bar chart, one row per calendar year: realized P&L split 特定 vs NISA, estimated tax, net-after-tax, trade count, and win rate. Uses **settlement-date** attribution to stay consistent with the tax figures. Includes a YoY delta column and a cumulative net-after-tax line.

---

## Follow-on features (not in this build)

- **Per-symbol scorecard** — realized + unrealized per ticker, ranked by contribution
- **CSV / PDF export** — for filing or an accountant
- **Dividend tracking** — needs a separate Rakuten 配当金 CSV; extend the import pipeline

---

## Build order

1. Scaffold TanStack Start + TS + Sass, SCSS token layer + Radix primitives, dark theme, Vercel project
2. Neon Postgres + Drizzle schema + migrations
3. Better Auth Google OAuth with email allowlist (`_authed` guard route)
4. **Import pipeline + P&L engine with unit tests** — the correctness core; do this before any UI
5. Trades table (sort/filter)
6. Dashboard (KPIs, equity curve, allocation)
7. Positions + price providers + FX
8. Calendar + notes (mood/motivation)
9. **NISA screen** — lifetime ¥18M + annual quotas
10. Tax page + **year-over-year comparison**
11. **Trading stats** + **currency attribution** + mood correlation
12. Deploy

## Verification

**Unit tests (Vitest)** on the engine — this is where correctness lives:
- Fund per-10,000-unit conversion: `96,016 @ 20,830 → ¥200,000`
- JP fee arithmetic across all 65 settled rows; US arithmetic across all 69 USD-settled rows
- `再投資` rows increase units and cost basis without cash outflow
- Unsettled (`"-"`) rows derive an amount and flag `isSettled = false`
- Same-day buy+sell of 8411 (2026/7/29) produces correct realized P&L
- 特定 and NISA pools for the same ticker stay independent
- Re-importing an identical CSV inserts 0 rows

**Ground truth (highest-value tests — these catch real bugs):**
- **2025 特定 realized gains = ¥0**, matching `2025_nentori.xml`. Zero 特定 sells settle in 2025.
- **¥927 gross → ¥142 income + ¥46 local → ¥739 net** reproduces the official withholding exactly
- Computed positions match `torizan` month-end holdings at **all 10 monthly checkpoints**, per instrument *and* per account type
- A fund distribution books income *and* increases cost basis via its paired `特定再投資` row — neither side double-counted
- `nentori.xml` parser extracts `ZLF*` financial fields and never touches the `ZLE*` PII block

**NISA screen:**
- 旧NISA buys (¥2,238,252 across 2022–23) are excluded from the ¥18M lifetime total
- 2026 成長投資枠 computes to exactly ¥2,400,000 and renders as a maxed annual quota
- A sell in year N restores lifetime quota in Jan of year N+1 — never within year N
- Annual quota does *not* restore on sell
- 成長投資枠 ¥12M sub-cap is enforced independently of the ¥18M total

**Stats / attribution:**
- Profit factor with zero losses renders "—", not `Infinity` or a crash
- Max drawdown on a monotonically rising equity curve is 0
- Stats with zero closed trades render empty states, not `NaN`
- `stockEffect + fxEffect` equals total JPY P&L exactly for every US close (property test over all 41 US sells)
- A US trade with `R₁ == R₀` yields `fxEffect == 0`

**Year-over-year:**
- Year attribution uses settlement date — a trade executed in Dec settling in Jan lands in the later year

**Routing / data:**
- Trades filter+sort state round-trips through the URL — apply filters, copy the URL, open in a new tab, identical view
- Malformed search params (`?account=BOGUS`) are rejected by the validator and fall back to defaults rather than crashing the route
- `_authed` guard redirects a signed-out visitor to `/signin` before any loader runs
- Non-allowlisted Google account is rejected at sign-in

**UI:**
- Radix primitives are keyboard-navigable and focus-visible rings render (Dialog traps focus, Select opens on Space/Enter, Escape closes)
- Money columns align on `tabular-nums` across every table
- No hardcoded hex values in `*.module.scss` — all color goes through `var(--color-*)`; grep to confirm
- Recharts series colors resolve from the same custom properties as the surrounding UI

**End-to-end:**
- `npm run dev`, sign in with Google
- Import all three CSVs → expect 315 trades, 0 duplicates; re-import → 0 new
- Cross-check total realized P&L and per-symbol figures against Rakuten's own reporting
- Confirm open-position quantities match the actual Rakuten account
- Verify stale-price fallback by running with an invalid Finnhub key — app must render with staleness badges, not error
- `npm run build` clean, then deploy and re-verify sign-in + import on Vercel (zero-config Start detection; set env vars in project settings)

## Open items

- Finnhub API key → `FINNHUB_API_KEY` env var
- Google OAuth client ID/secret → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google Cloud Console, ~5 min)
- `BETTER_AUTH_SECRET` (generate) and `DATABASE_URL` (Neon)
- Allowlisted email → `ALLOWED_EMAIL=t.elsay3d@gmail.com`
- JP/fund scrape sources are best-effort by nature; manual override in Settings is the guaranteed path when they break
