# Plan: Playbook — trade journal with chart screenshots and built-in exit plans

> Written for a developer who knows this repository (`CLAUDE.md` is required reading) but not the
> conversation that produced the plan. Start from `main` on a new branch.

## Context

The owner is a swing trader. They want one place that records every trade:

- **Setup** — which type of play the trade was.
- **Charts** — what the chart looked like at entry and at exit.
- **Ratings** — how well the entry and the exit were executed.
- **Risk** — how much was risked.
- **Exit plan** — the plan for getting out, while the trade is still open.

The goal is to learn which setups work by comparing their best and worst trades side by side.

Today the exit plan lives on its own **Exit Rules** page (`/exits`). It covers the swing framework in
`src/lib/exit/rules.ts`: stop, R, Target 1, trail, time stop and a daily recommendation. That page
fed by the TradingView daily feed at `/api/tv/$secret`. This plan:

1. Adds a **Playbook** section built around a *position journal*. A journal entry is one swing trade
   from open to close, filed under a setup, with chart screenshots, 1–10 ratings and an exit plan.
2. **Replaces the Exit Rules page.** The exit plan becomes part of opening a position in the
   Playbook. The framework, its feed and its push notifications stay; only the screen moves.
3. Stores **TradingView screenshots** rather than raw price data, because a screenshot carries the
   owner's own indicators and drawings. They go in a private **Vercel Blob** store.
4. Adds an optional **execution time (JST)** for each imported trade, entered on the import screen.
   No Rakuten export records a time.

## Decisions already made

| Topic | Decision |
|---|---|
| Image hosting | **Vercel Blob, private store.**<br>- The app already deploys to Vercel Hobby; Blob is free within Hobby limits.<br>- Private means images are only served through the app after sign-in.<br>- Expected volume is about 4 images per trade at 150–300 KB each, a few hundred MB a year.<br>- Going over the Hobby limit cuts Blob off for 30 days rather than billing. Cloudflare R2 (10 GB free, free egress) is the fallback if that ever matters. |
| Opening a position | **Both ways:**<br>- from an existing holding that is not yet in the Playbook;<br>- from scratch, at buy time, before the CSV export exists. The real trades are linked when they are imported later. |
| Exit Rules page | **Removed.** Its plan editing, recommendation and settings move into the Playbook and Settings. |
| Execution time | **Optional, in JST, per trade, entered during import.**<br>- Not asked for funds (`assetClass === 'FUND'`, 投資信託).<br>- Confirm with the owner whether exchange-listed ETFs such as 1306 (stored as `JP_EQUITY`) should also skip it; default is to *ask* for them. |
| Ratings | 1–10 for each entry and each exit (setup quality, not outcome).<br>- A computed 1–10 risk rating with a manual override.<br>- A computed 1–10 overall score. |

## Step 0 — mock design before any app code

Publish an HTML mock as an Artifact. Use the Artifact tool's quickstart with `intent: "design"`.

- **Look:** use the app's dark tokens from `src/styles/_tokens.scss`.
- **Widths:** show desktop and phone (390 px).
- **Screens:** the five described below.
  1. Playbook table
  2. Setups page
  3. Setup detail with best/worst galleries
  4. Position page
  5. The four-step Open Position dialog, plus the import time column

Get the owner's sign-off before building.

## Screens

### 1. `/playbook` — all positions (replaces `/exits` in the sidebar)

```
Playbook                                                   [Open position]
Filters: Account [All▾]  Currency [All▾]  Setup [All▾]  Status [Open/Closed/All▾]  Kind [Real/Paper]
Sort: any column (default: open first, then most recent)

⚠ Needs action (only while an open plan rates urgent/attention — the old Exit Rules alert strip)
 7203 Toyota · 特定  STOPPED OUT — sell 100   stop ¥2,700  last ¥2,688   [ladder]   [Open]

Symbol      Setup            Status   Opened   Closed   Result     R      Entry Exit Risk Overall
7203 Toyota Pullback to 20d  Open     10/01    —        —          —      8     —    9.8  7.4*
AAPL Apple  Breakout         Closed   09/12    09/30    +$412      +2.1R  7     6    8.0  7.6
6758 Sony   Pullback to 20d  Planned  10/20    —        —          —      —     —    9.0  —
```

- **Filters:** account (all / 特定 / NISA; reuse `AccountFilterControl`), currency (JPY / USD),
  setup, status, real/paper.
- **Sorting:** by result, R, each rating and overall. Use the existing `SortHeader` and `sortRows`
  helpers.
- **State:** filter and sort live in typed search params, as on other screens.
- `*` marks a provisional score (see *Scoring*).
- An open position's row also shows the exit recommendation badge (`ExitFlags`) and a compact
  `ExitLadder`.
- Clicking a row opens the position page.

### 2. `/playbook/setups` — the setups, and how each performs

- **Contents:** one card per setup that has at least one position.
  - Name and description.
  - Stats: closed trades, win rate, average R, average overall score.
  - Real and paper are shown separately.
- **Actions:** create, edit and archive setups.

### 3. `/playbook/setups/$setupId` — one setup's best and worst trades

```
Pullback to 20d — 14 closed · 57% win · +0.6R avg · 7.1 avg score
Criteria: Uptrend (20d > 50d) · Bounce candle on volume
Rank by: [Overall score ▾ | R result]

Best 5                                       Worst 5
┌ 7203 +2.1R 8.2 ─────────────────────┐      ┌ 8411 −1.3R 3.0 ──────────────────┐
│ [entry img] [entry img] [exit img]  │      │ [entry img] [exit img]           │
│ Entry 9 "bounced off 20d on vol…"   │      │ Entry 4 "chased, no volume"      │
└─────────────────────────────────────┘      └──────────────────────────────────┘
… then the full list of this setup's positions (same table as screen 1, pre-filtered)
```

- **Ranking:** best/worst are the top and bottom five closed positions by overall score. A toggle
  ranks by R instead.
- **Images:** each trade shows its entry and exit screenshots with the explanations.
- **Lightbox:** clicking an image opens it, and arrow keys move between the entry and exit images of
  that trade.

### 4. `/playbook/$journalId` — one position

- **Header:** symbol, account, setup, status, Edit and Archive/Delete.
- **Exit plan panel** (from the old Exit Rules card):
  - entry, support, initial stop, R, Target 1 (auto or manual), extra targets, trail method,
    time stop;
  - the current recommendation, `ExitLadder`, and feed freshness.
- **Score panel:**
  - overall, with entry / exit / risk / result parts;
  - risked amount and % of account, position size % of account, planned R vs actual R.
- **Charts:** an image gallery grouped by phase (Plan / Entry / During / Exit).
  - Each image has a timeframe label (1D, 1h, 5m…) and a caption.
  - Add images by paste, drag-drop or file picker.
- **Entries and exits:** each leg shows date, JST time, price and quantity, whether it is linked to
  an imported trade, a 1–10 rating and a "why" text field.
- **Review:** setup criteria checklist ("which held at entry"), mistake tags (reuse `TagInput`) and
  a lessons field.
- **Planned positions:** a "Link imported trades" prompt when matching trades exist (see *Linking*).

### 5. Open Position dialog — four steps

1. **Source**
   - **From a current holding not yet in the Playbook.**
     - Candidates are open pools from the engine with no journal entry. Reuse the
       `EligibleHolding` logic in `src/server/exit.ts`.
     - Prefill entry date, price and shares from `openEntryStreaks` (`src/lib/exit/entry.ts`).
   - **New from scratch.** Symbol, name, market (JP/US), account, entry date, JST time, price,
     shares. Also used for a paper trade (a "Paper" toggle).
2. **Setup** — pick one, or create one inline: name, description, entry criteria list.
3. **Images** — drop or paste the entry screenshots now (optional; more can be added later).
4. **Exit plan**
   - Support level and the stop ATR multiple: the default comes from exit settings and is editable
     here.
   - **Target 1:** auto (`entry + multiple × R`), or entered manually.
   - **Optional extra targets:** a price and the fraction of the position to sell at each.
   - Partial-exit fraction, trail method, time stop.
   - Account size, for the risk %.
   - **Live preview:** stop, R, targets, risk % and risk rating. The server computes these; call a
     `previewExitPlan` server fn on change, debounced.

The dialog uses Radix Dialog like the existing `ExitRuleDialog`, plus `useDialogHistory`,
`FormField` and `toFieldErrors`.

## Data model

One migration, via `npm run db:generate` after editing `src/db/schema.ts`. Commit the generated SQL
and `drizzle/meta`.

- **`setups`**
  - `id, userId, name, description, criteria jsonb string[], archivedAt, createdAt, updatedAt`
  - Unique `(userId, name)`.
- **`journal_entries`** — one row per swing trade.
  - `id, userId, setupId? (FK set null)`
  - `kind` enum: `REAL | PAPER`
  - `symbol, name, assetClass, currency, accountType?, instrumentId?`
  - `accountEquity?, riskRatingOverride smallint?, criteriaMet jsonb, mistakes jsonb, lessons`
  - `planned boolean` — true until imported trades are linked.
  - `archivedAt, timestamps`
  - **Status** (Planned / Open / Closed) is *derived* on read from `planned` and shares remaining.
- **`journal_legs`** — one entry or exit fill.
  - `id, journalId, userId, kind ENTRY|EXIT, tradeId? (FK trades, set null)`
  - `date, executedAt timestamptz?, price, quantity, fee`
  - `rating smallint?` (1–10), `explanation, position`
  - Partial unique index on `(userId, tradeId) WHERE trade_id IS NOT NULL`. A trade belongs to one
    journal entry, or setup statistics count it twice.
- **`journal_images`**
  - `id, userId, journalId, legId?`
  - `phase` enum: `PLAN | ENTRY | DURING | EXIT`
  - `timeframe varchar(8), caption, blobPathname, contentType, width, height, bytes, position,
    createdAt`
- **`exit_rules`** (existing) gains:
  - `journal_id` — FK to `journal_entries`, unique, nullable for plans that predate this.
  - `target1_override numeric?` — the manual Target 1, locked like the other entry facts.
  - `extra_targets jsonb [{ price, fraction }]`
  - `exit_rules` remains the exit-plan store. `lib/exit/rules.ts`, the `/api/tv` feed and push
    notifications keep working.
  - When `target1_override` is set, it replaces the computed Target 1 everywhere. Thread it through
    `ExitRulePosition` (`src/lib/exit/types.ts`), with a unit test.
  - Extra targets are shown on the ladder and in the plan. They do not change the framework's
    recommendation logic.
- **`trades.executed_at timestamptz?`** — execution time.
  - Entered in JST but stored as an instant. A US fill viewed in JST falls after midnight, so its
    JST date can be the trade date + 1, and a time-only column would be ambiguous.
  - The import update paths must preserve it: restatement and settlement updates in
    `src/lib/import/plan.ts` and `src/db/import.service.ts`.

## How a position works

- **Opening "from scratch" (REAL, planned):**
  - Ensure an `instruments` row exists for the canonical symbol (4-digit TSE code or US ticker; see
    `lib/domain/instruments.ts`). That also lets the `/api/tv` feed store bars immediately.
  - Insert a manual ENTRY leg.
  - Create the `exit_rules` row through the existing `createExitRule` service in
    `src/db/exit.service.ts`, with `journal_id` set.
- **Opening "from holding":** the same, except the legs are the pool's linked buys from the current
  holding streak, and `planned = false`.
- **Shares remaining** feeds `evaluateExitRule` in `src/server/exitPosition.ts`.
  - **Planned:** computed from the manual legs.
  - **Linked:** the engine pool, as today. The engine is the source of truth once trades exist.
  - Put this choice in a small pure, tested function, `src/lib/playbook/holding.ts`.
- **Linking after import:**
  - For a planned position, suggest unlinked trades with the same symbol and account and
    `tradeDate ≥ entry date − 1`. The −1 is because Rakuten can re-date US fills by a day; see
    `CLAUDE.md` *Import pipeline*.
  - On confirm, the manual legs are replaced by linked legs. Keep each leg's rating, explanation and
    time, and write the time to `trades.executed_at` if that is empty.
  - Set `planned = false`.
  - A planned position also shows on the Playbook table, flagged "trades found — link" when matches
    exist.
- **Closing:** when shares remaining reach 0 the exit plan is archived (reuse the existing
  retire/`toArchive` logic in `src/server/exit.ts`) and the position becomes Closed.
- **Paper positions:** no exit plan is required (optional), their legs are typed in, and they never
  appear in any figure outside the Playbook.
- **Result (REAL):** the engine's `realizedNative` summed over the linked sells.
  - Map trade id to its close through `engineFor` (`src/server/engine.ts`): the `records` carry ids,
    and `engine.realized[i].trade` is the same object as `record.trade`.
  - This keeps the Playbook consistent with Trades and Tax.

## Scoring

Pure functions in `src/lib/playbook/score.ts`, unit-tested. The score is **never stored**; it is
recomputed on every read.

- **Entry / Exit:** the legs' 1–10 ratings, weighted by quantity.
- **Risk:** linear between the points below.
  - 70% comes from the loss at the initial stop as a share of account equity:

    | Loss at stop (% of equity) | 0.5% | 1% | 2% | 3% | 5% |
    |---|---|---|---|---|---|
    | Score | 10 | 9 | 6 | 3 | 1 |

  - 30% comes from the position cost as a share of equity:

    | Position cost (% of equity) | ≤10% | 20% | 30% | 50% | 75% |
    |---|---|---|---|---|---|
    | Score | 10 | 8 | 6 | 3 | 1 |

  - A manual 1–10 override replaces the computed value.
  - The stop is the exit plan's initial stop.
- **Result:** the R multiple on the closed units: −2R → 1, −1R → 3, 0 → 5, +1R → 7, +2R → 9,
  +3R → 10.
  - With no stop: return % instead: −10% → 1, −5% → 3, 0 → 5, +5% → 7, +10% → 9, +15% → 10.
- **Overall:** entry, exit, risk and result are 25% each, so process outweighs outcome three to one.
  - A missing part (no exit yet, an unrated leg, no stop) is dropped and the rest reweighted.
  - The score is then *provisional*, and so is any open position's.
- **Setup statistics** (`src/lib/playbook/stats.ts`): closed positions only for win rate and
  average R; average overall score; real and paper reported separately.

## Images (Vercel Blob, private)

- **Setup:** create a *private* Blob store linked to the Vercel project. That provisions
  `BLOB_READ_WRITE_TOKEN`; add it to `.env` for local work. Add `@vercel/blob`.
  - Private stores are recent, so check `put`, `get`, `del`, `handleUpload` and `upload` against the
    current Vercel docs.
- **Client:** `src/components/playbook/ImageDrop.tsx`.
  - Accepts paste (TradingView's "copy chart image" puts it on the clipboard), drag-drop or file
    picker.
  - Downscales on a canvas to a 2000 px maximum edge and encodes WebP at about 0.85 quality.
  - Uploads directly to Blob with `upload()` from `@vercel/blob/client`, pathname
    `users/<userId>/<journalId>/<uuid>.webp`. A direct upload avoids the 4.5 MB function body limit.
- **Token route:** `src/routes/api/images/upload.ts` runs `handleUpload`. In
  `onBeforeGenerateToken`:
  - authenticate with `sessionForRequest` and `isAllowedEmail` (`src/lib/auth.ts`);
  - check `Origin` as `sameOrigin` in `src/server/middleware.ts` does — `/api/*` routes are outside
    the server-fn CSRF filter in `src/start.ts`;
  - allow only webp/png/jpeg, at most 5 MB, under the caller's own `users/<userId>/` prefix.
- **Saving the row:** after the upload resolves, the client calls the authed server fn
  `attachImage`. It verifies journal ownership and the pathname prefix, then inserts the
  `journal_images` row.
  - This is not done in the `onUploadCompleted` callback, because that callback cannot reach
    localhost.
- **Serving:** `src/routes/api/images/$id.ts` (GET)
  - authenticates the session and loads the row by `(userId, id)`;
  - streams it from Blob with `cache-control: private, max-age=86400`.
  - Images are never public.
  - The service worker never caches `/api/*` (`src/lib/offline/policy.ts`), so images are
    online-only. That is a deliberate privacy choice; leave it.
- **Deleting:** removing an image, or a journal entry, calls `del()` on its blobs.
- **Server-only:** the Blob SDK must stay out of the client bundle. `noServerCodeInClient()` in
  `vite.config.ts` will fail the build otherwise. See `docs/server-only-modules.md`.

## Execution time on import

- **Import preview** (`src/routes/_authed/import.tsx`, `previewImport` / `commitImport` in
  `src/db/import.service.ts`):
  - Add an optional **Time (JST)** input per new trade, hidden for funds.
  - Default the date part to the trade date, with a "+1 day" toggle for US fills that crossed
    midnight JST.
  - `commitImport` accepts a `sourceRowHash → executedAt` map.
- **Editing later:** editable on the Trades edit dialog (`src/components/trades/`) and on a journal
  leg. A leg's time writes through to its trade.
- **Do not** use `executed_at` to reorder trades within a day yet. That would change realized P&L
  between same-day sells; see the `day_sequence` rule in `CLAUDE.md`. Raise it with the owner as a
  follow-up.

## Removing the Exit Rules page

- **Navigation:** remove `/exits` from `NAV` in `src/components/SidebarNav.tsx` and from
  `src/components/icons/NavIcons.tsx`. Add `/playbook` with a new icon.
- **Old URL:** make `src/routes/_authed/exits.tsx` a redirect to `/playbook`, so bookmarks and old
  notifications still land.
- **Settings:** move `ExitSettingsForm` to `src/routes/_authed/settings.tsx`. Show the webhook
  "not configured" warning there and on the Playbook.
- **Reuse:** `ExitLadder`, `ExitFlags`, the recommendation message and `ExitPlanDialog` content
  where they fit. Delete what becomes unused.
- **Push notifications:** the URL becomes `/playbook/<journalId>`, falling back to `/playbook`. Change
  it in `src/lib/notifications/exitActionNotice.ts` and the default in `src/sw/sw.ts`.
- **Existing plans** with no `journal_id`: on first visit, show "Add N existing exit plans to the
  Playbook". It creates journal entries from those plans' pools.
- **Tests:** update those that list `/exits`: `SidebarNav.test.tsx`, `PositionsRoute.test.tsx`,
  `exitActionNotice.test.ts`.

## Files

- **New, pure and tested:** `src/lib/playbook/{types,score,stats,holding}.ts`.
- **New, database:** `src/db/playbook.service.ts`.
  - Scope every query by `userId`, child tables included.
  - Drizzle wraps pg errors, so detect unique violations via `error.cause?.code === '23505'`.
  - Build insert values explicitly. Spreading an input that carries `id: undefined` overrides the
    generated id.
- **New, server:** `src/server/playbook.ts`.
  - Server fns only, all `.middleware([authed])`.
  - Validators use zod from client-safe modules only.
- **New, routes:**
  - `src/routes/_authed/playbook.index.tsx`
  - `playbook.$journalId.tsx`
  - `playbook.setups.index.tsx`
  - `playbook.setups.$setupId.tsx`
  - `src/routes/api/images/{upload,$id}.ts`
  - Do not add a `playbook.tsx` layout, or the others become its children.
- **New, components:** `src/components/playbook/`.
  - `PositionTable`, `OpenPositionDialog` (the four steps), `SetupDialog`, `ImageDrop`,
    `ImageGallery` with lightbox, `RatingInput` (ten buttons, clearable), `LegCard`,
    `ExitPlanPanel`, `ScorePanel`.
  - SCSS modules and tokens only.
  - JPY prices need one decimal; `money()` in `format.ts` rounds yen.
- **Modified:**
  - `src/db/schema.ts`, `src/db/exit.service.ts`, `src/server/exitPosition.ts`,
    `src/server/exit.ts`, `src/lib/exit/types.ts`, `src/lib/exit/rules.ts` (Target 1 override)
  - import plan/service/route, trades edit dialog, settings route, sidebar and icons, notification
    payload, `src/sw/sw.ts`
  - `CLAUDE.md` (key modules, `BLOB_READ_WRITE_TOKEN`, a domain-rule bullet for the journal),
    `SETUP.md`, new `docs/playbook.md`
- **Regenerated:** `src/routeTree.gen.ts`. It is committed; `npm run build` or `npm run dev`
  regenerates it.

## Verification

- **Every change:** `npm run typecheck && npx eslint src --max-warnings=0 && npm test`.
  - Without the gitignored `csv/` exports, 62 tests in 12 files fail. That is expected; nothing new
    may fail.
  - New unit tests:
    - score and stats curves, reweighting, provisional;
    - `holding.ts` (planned vs linked);
    - Target 1 override in `rules.ts`;
    - import time map, including preservation through restatement and settlement updates;
    - notification URL.
- **Build:** `npm run build` must pass (it includes the server-code-in-client guard).
- **End to end, cloud container:** Docker is unavailable there, but Postgres 16 is at
  `/usr/lib/postgresql/16/bin`.
  1. `initdb` and start the database as the `postgres` user, apply `drizzle/*.sql` in order, and
     confirm with `drizzle-kit push` that there is no diff.
  2. `npm run build`, then run `node .output/server/index.mjs` with test env vars.
  3. Drive Chromium with Playwright (`executablePath: '/opt/pw-browsers/chromium'`).
  4. Sign in by inserting a `session` row and setting cookie `__Secure-better-auth.session_token` to
     `encodeURIComponent(token + '.' + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))`.
  5. Walk the flow:
     1. Open a position from scratch through all four dialog steps.
     2. Paste an image. This needs a real Blob token, or a stub at the service boundary.
     3. Import a CSV with a JST time, link the trades, rate the legs, sell, and check the result, R
        and score.
     4. Check the setup page's best/worst galleries, the table filters and sorting, the `/exits`
        redirect, and the phone width.
- **After touching `src/sw/`:** run `npm run check:offline`.

## Delivery

1. This plan is saved in the repository as `docs/plans/playbook.md`.
2. Commit it to the current branch and push.
3. Implementation happens later, in a fresh session on a new branch from `main`, starting with
   Step 0.
