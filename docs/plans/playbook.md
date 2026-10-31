# Plan: Playbook — trade journal with chart screenshots and built-in exit plans

> Written for a developer who knows this repository (`CLAUDE.md` is required reading) but not the
> conversations that produced the plan. Start from `main`, and ship in the phases listed under
> *Delivery*, one branch and one PR each.

## Context

The owner is a swing trader. They want one place that records every trade:

- **Setup** — which type of play the trade was.
- **Charts** — what the chart looked like at entry and at exit.
- **Ratings** — how well the entry and the exit were executed.
- **Risk** — how much was risked.
- **Exit plan** — the plan for getting out, while the trade is still open.

The goal is to learn which setups work by comparing their best and worst trades side by side.

Today the exit plan lives on its own **Exit Rules** page (`/exits`). It covers the swing framework in
`src/lib/exit/rules.ts`: stop, R, Target 1, trail, time stop and a daily recommendation, fed by the
TradingView daily feed at `/api/tv/$secret`. This plan:

1. Adds a **Playbook** section built around a *position journal*. A position is one swing trade from
   open to close — one holding streak of one pool — filed under a setup, with chart screenshots,
   1–10 ratings and an exit plan.
2. **Replaces the Exit Rules page.** The exit plan becomes part of opening a position in the
   Playbook. The framework, its feed and its push notifications stay; only the screen moves.
3. Stores **TradingView screenshots** rather than raw price data, because a screenshot carries the
   owner's own indicators and drawings. They go in a private **Vercel Blob** store.
4. Adds an optional **execution time (JST)** for each imported trade, entered on the import screen.
   No Rakuten export records a time.
5. Lets **trades that closed before the Playbook existed** be filed as well, so the setup statistics
   have data from the start.

## Decisions already made

| Topic | Decision |
|---|---|
| Image hosting | **Vercel Blob, private store.**<br>- The app already deploys to Vercel Hobby, where Blob is free within limits: 1 GB stored, 10,000 simple and 2,000 advanced operations (uploads and `list()`), and 10 GB of transfer a month.<br>- Private means images are only served through the app after sign-in.<br>- Expected volume is about 4 images per trade at 150–300 KB each, a few hundred MB a year.<br>- Going over any Hobby limit makes Blob unavailable for 30 days rather than billing. Cloudflare R2 (10 GB free, free egress) is the fallback if that ever matters. |
| Platform | **One Vercel project.** Vercel Services was considered and does not fit. TanStack Start already serves the pages, the server functions and `/api/*`, and nothing here needs a separate runtime. |
| Opening a position | **Three ways:**<br>- from a current holding that is not yet in the Playbook;<br>- from scratch, at buy time, before the CSV export exists — the real trades are linked when they are imported;<br>- from a past trade: a closed holding streak in the trade history. |
| Exit Rules page | **Removed.** Its plan editing, recommendation and settings move into the Playbook and Settings. |
| Execution time | **Optional, in JST, per trade, entered during import.**<br>- Not asked for funds (`assetClass === 'FUND'`, 投資信託). Exchange-listed ETFs bought as stock (e.g. 1306) **do** get a time. The rule is `assetClass !== 'FUND'`, not anything ETF-specific.<br>- When every trade of a pool-day has a time, the time order **pre-fills** that day's within-day order. The owner still confirms it. |
| Trade note | **One shared note.** For a trade in a Playbook position, its "why" is its leg's note. The Calendar and the Trades screen show and edit that same note. Trades outside the Playbook keep their memo. `trades.motivation` (1–5) is unchanged. |
| Paper positions | **Static plan only.** Stop, Target 1 and extra targets are stored so that risk and R can be scored. There is no feed, ladder, recommendation or push, and no `exit_rules` row. |
| Ratings | 1–10 for each entry and each exit decision. They rate the execution, not the outcome.<br>- A computed 1–10 risk rating with a manual override.<br>- A computed 1–10 overall score. |

## Step 0 — mock design before any app code

Publish an HTML mock as an Artifact. Use the Artifact tool's quickstart with `intent: "design"`.

- **Look:** use the app's dark tokens from `src/styles/_tokens.scss`.
- **Widths:** show desktop and phone (390 px).
- **Screens:**
  - the five screens described under *Screens*;
  - the import preview with its time inputs;
  - a Calendar trade row showing a shared note.
- **States to draw:**
  - a position awaiting import;
  - a closed position whose exit plan is still live;
  - a setup with fewer than ten closed trades;
  - an image that cannot load, because the device is offline or storage is unavailable.

Get the owner's sign-off before building.

## What a position is

Everything else in this plan follows from this section.

**A real position is one holding streak of one pool.** A pool is `(symbol × accountType)`. A streak
runs from the buy that takes the pool off flat to the sell that returns it to flat, or to today if
units are still held. It is the unit the exit framework already plans over (`src/lib/exit/entry.ts`).

**Membership, status and result are derived from the trade history on every read, never stored.**
`exit_rules` already follows this rule for shares remaining. Only two things are stored: the
*anchor*, which says which streak a position is, and the owner's annotations.

A stored list of "which trades belong to this position" would have to be kept in step on every write
path: import inserts, restatements, settlements, settlement regrouping, and manual create, edit,
delete and restore. Rakuten restates and regroups fills routinely (see `CLAUDE.md`, *Import
pipeline*), so a stored list would drift. Deriving it has three consequences:

- Top-ups, partial exits and the final close join the position by themselves when they are imported.
- Re-entering the pool later starts a new streak, so a closed position never reads as open again.
  The exit framework needs `PLAN_SUPERSEDED` to catch this case; here it cannot occur.
- A streak starts and ends flat, so the engine's moving-average result over its sells is exactly this
  trade's result. No units from another trade are averaged in.

The rules:

- **Anchor:** the streak's first opening trade id.
  - US restatement updates rows in place, so the id survives re-dating.
  - Settlement regrouping can soft-delete that row (`supersededTrades`). The anchor then falls back
    to the streak in the same pool that starts on the stored `entryDate`, or on the day after it for
    a US pool.
  - If neither finds a streak, the position says it cannot find its trades and offers to relink. It
    never guesses.
- **Legs:** the streak's fills, grouped by side and 約定日 — one leg per decision.
  - One order filled as several executions is one leg, which the owner rates once.
  - Limitation: two separate decisions on the same side and day merge into one leg. This is rare in
    swing trading.
- **Annotations** (rating, note and time) are stored per leg.
  - Each is keyed by its leg's first fill id, falling back to `(side, 約定日)` for the same reason the
    anchor falls back.
  - An annotation that matches no leg is listed on the position page as unattached, with a control
    to reattach it. The owner's notes are never dropped silently.
- **Status:**
  - *Awaiting import* — a position opened from scratch whose trades are not imported yet. It is not
    called "Planned", because the trade has already happened; only the export is missing.
  - *Open* — its streak still holds units.
  - *Closed* — its streak is flat.
- **Paper positions** have typed-in legs and never reach the engine. Their status comes from those
  legs.
- **Past trades** are anchored to a closed streak. They are Closed from the start and have no live
  plan.

These rules go in `src/lib/playbook/streaks.ts`, pure and tested:

- `holdingStreaks(trades)` returns every streak of every pool, open and closed, with its trades in
  engine order. It uses `sortTradesForEngine`, so a hand-set day order is honoured.
- `resolvePosition(entry, streaks)` applies the anchor rules.
- `legsOf(streak)` does the grouping.

Re-express `openEntryStreaks` on `holdingStreaks`, so that "flat" has one definition. Test these
cases:

- a top-up;
- a Target 1 partial;
- a close followed by re-entry;
- a same-day round trip, with and without a day order;
- US re-dating, where the anchor id survives;
- JP regrouping, where the anchor falls back;
- a history that begins mid-position.

## Screens

### 1. `/playbook` — all positions (replaces `/exits` in the sidebar)

```
Playbook                                                          [Open position]
Filters: Account [All▾]  Market [All▾]  Setup [All▾]  Status [All▾]  Kind [Real▾]
Sort: any column (default: open first, then most recent)

⚠ Needs action (only while an open plan rates urgent/attention — the old Exit Rules strip)
 7203 Toyota · 特定  STOPPED OUT — sell 100   stop ¥2,700  last ¥2,688   [ladder]   [Open]

Symbol      Setup            Status           Opened  Closed  Result           R      Entry Exit Risk Overall
7203 Toyota Pullback to 20d  Open             10/01   —       —                —      8     —    9.8  7.4*
AAPL Apple  Breakout         Closed           09/12   09/30   +$412 (¥61,020)  +2.1R  7     6    8.0  7.6
6758 Sony   Pullback to 20d  Awaiting import  10/20   —       —                —      —     —    9.0  —
```

- **Filters:**
  - Account: all / 特定 / NISA. Reuse `AccountFilterControl`.
  - Market: All / JP / US. Reuse `MarketFilterControl`; this is the split the app already makes.
  - Setup, status and kind. Kind defaults to Real.
- **Sorting:** by result, R, each rating and overall. Use the existing `SortHeader` and `sortRows`
  helpers.
  - Result sorts by its yen value (`realizedJpy`), the way the dashboard totals across markets.
  - A paper position has no yen value, so when Kind is Paper, Result sorts by return %.
- **State:** filter and sort live in typed search params, as on other screens.
- `*` marks a provisional score (see *Scoring*).
- An open position's row also shows the exit recommendation badge (`ExitFlags`) and a compact
  `ExitLadder`.
- A position awaiting import shows "trades found — link" when matching trades exist (see *Linking*).
- On a phone, the table becomes cards, as Exit Rules and Positions do today (`useIsMobile`).
- Clicking a row opens the position page.

### 2. `/playbook/setups` — the setups, and how each performs

- **Contents:** one card per active setup, including one that has no positions yet.
  - Name and description.
  - Stats: closed trades, win rate, average R, average overall score. Average R covers only
    positions that have a stop, and shows its own count.
  - Real and paper are shown separately. Past trades count as real.
- **Actions:** create, edit and archive setups.
  - A setup has only a name, description and criteria (see *Data model*). Real and paper are a property of the position, never of the setup, so a setup that is used both ways shows two cards.

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

- **Ranking:**
  - Best and worst are the top and bottom five closed positions by overall score.
  - A toggle ranks by R instead, over the positions that have an R.
  - With fewer than ten closed positions, show one ranked list. Two lists of five would otherwise
    show the same trade in both.
- **Images:** each trade shows its entry and exit thumbnails with their notes.
- **Lightbox:** clicking an image opens it at full size.
  - Arrow keys or a swipe (`useSwipe`) move between that trade's images.
  - Escape or Back closes it (`useDialogHistory`).

### 4. `/playbook/$journalId` — one position

- **Header:** symbol, account, setup, status, Edit and Archive/Delete.
  - **Edit position** changes the setup. On a linked real position, symbol, account and each leg's date, price and quantity are read-only, because they come from the trades. Only a leg's time can be set, and it writes through to that leg's fills that have no time yet. A position awaiting import, and a paper position, edit their typed legs here.
  - **Archive** sets `archivedAt` and archives the live exit plan with it. The trades stay in Trades.
  - **Edit plan** changes the exit plan only (support, stop multiple, targets, trail), through the typo-correction path.
- **Exit plan panel:**
  - **Live plan** — a real position with an `exit_rules` row. Moved from the old Exit Rules card:
    - entry, support, initial stop, R, Target 1 (auto or manual), extra targets, trail method and
      time stop;
    - the current recommendation, `ExitLadder`, and feed freshness.
  - **Static plan** — paper positions and past trades: stop, Target 1 and extra targets only.
  - A closed position whose plan is still live shows *Archive exit plan* (see *Closing*).
- **Score panel:**
  - overall, with entry / exit / risk / result parts;
  - risked amount and % of account, position size % of account, planned R vs actual R.
- **Charts:** an image gallery grouped by phase (Plan / Entry / During / Exit).
  - Each image has a timeframe label (1D, 1h, 5m…) and a caption.
  - Add images by paste, drag-drop or file picker.
- **Legs:**
  - Each leg shows its date, JST time, average price, quantity and number of fills, a 1–10 rating,
    and its note (the shared note — see *Trade note*).
  - Unattached annotations are listed here too.
- **Review:**
  - a setup criteria checklist ("which held at entry");
  - mistake tags, using `TagInput` with earlier tags suggested;
  - a lessons field.
- **Awaiting import:** a "Link imported trades" prompt when matching trades exist.

### 5. Open Position dialog — four steps

1. **Source**
   - **From a current holding not yet in the Playbook.**
     - Candidates are the open streaks of JP and US equity pools that no position resolves to.
       Reuse the `EligibleHolding` logic in `src/server/exit.ts`.
     - Prefill entry date, price and shares from the streak.
   - **New from scratch** — bought, but not exported yet.
     - Symbol, name, market (JP/US), account, entry date, JST time, price and shares.
     - Refused when the pool already holds units (that is "from a holding"), or already has a
       position awaiting import.
     - The "Paper" toggle lives here.
     - It is deliberately not a manual trade. A manual trade enters the engine at once and is
       salted so that no import can match it, so the later export would add the same fill a second
       time.
   - **From a past trade.**
     - Candidates are the closed streaks that no position resolves to, newest first.
     - Prefill everything. If an archived exit plan covers that streak, prefill the stop from it.
2. **Setup** — pick one, or create one inline: name, description and entry criteria list.
3. **Images** — choose or paste the entry screenshots now (optional; more can be added later).
   - They are held in the browser and uploaded once the position exists, because the upload needs
     its id.
4. **Exit plan**
   - **Real, from a holding or from scratch: a live plan (`exit_rules`).**
     - Support level.
     - The stop ATR multiple and the Target 1 multiple. Both default from exit settings and are
       editable here. The `createExitRule` server fn must accept them, validated with the same ranges
       as settings; today it copies them from settings.
     - **Target 1:** auto (`entry + multiple × R`), or entered manually.
     - **Optional extra targets:** a price and the fraction of the position to sell at each.
     - Trail method, per position as today.
     - Partial-exit fraction, time stop and trail width are shown read-only, with a link to
       Settings. They are global settings that apply on the next read (`docs/exit-rules.md` §3), and
       `exit_rules` has no per-plan columns for them.
   - **Paper or past trade: a static plan.**
     - It takes the same inputs. The server computes the stop and Target 1 once and stores the
       results.
     - It is optional for a past trade.
   - **Account size, for the risk %.** Prefilled from Settings, editable, and stored on the
     position like the other entry facts.
   - **Live preview:** stop, R, targets, risk % and risk rating. The server computes these; call a
     `previewExitPlan` server fn on change, debounced.
   - After a real position is created, remind the owner to add its TradingView alert
     (`docs/exit-rules.md` §1.3). Alerts are per symbol, and without one the plan reads as stale.

The dialog uses Radix Dialog like the existing `ExitRuleDialog`, plus `useDialogHistory`,
`FormField` and `toFieldErrors`. `RatingInput` is a radio group of ten options, clearable, with
arrow-key navigation, so that the jsx-a11y rules pass.

## Data model

One migration:

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate -- --name playbook`, so the file gets a real name.
3. Commit the generated SQL and `drizzle/meta`.
4. Apply it with `npm run db:push`; the database is built by push (`CLAUDE.md`).

`npm run test:db` applies the baseline and then every migration in journal order, so the database
tests see the new tables.

- **`setups`**
  - `id, userId, name, description, criteria jsonb [{ id, text }], archivedAt, createdAt, updatedAt`
  - Criteria carry ids, so renaming one keeps the ticks already recorded against it.
  - Unique `(userId, name) WHERE archived_at IS NULL`. It is partial, like `exit_rules_active_uq`,
    so that archiving a setup frees its name.
- **`journal_entries`** — one row per position.
  - `id, userId, setupId? (FK set null)`
  - `kind` enum: `REAL | PAPER`
  - `instrumentId` (FK, not null).
    - Every position has an `instruments` row (see *How a position works*).
    - Symbol, name, asset class and currency come from the join, as they do for `exit_rules`.
      There are no copies to drift.
  - `accountType?` — null for paper.
  - `entryDate` — the streak's start as known when the position was filed. It is also the anchor's
    fallback.
  - `anchorTradeId?` (FK trades, set null) — null while awaiting import, and for paper.
    - Partial unique index on `(userId, anchorTradeId) WHERE anchor_trade_id IS NOT NULL AND
      archived_at IS NULL`. One position per streak, or setup statistics count it twice.
    - Candidate lists also exclude streaks that any position *resolves* to. That covers the
      fallback case, which the index cannot see.
  - Static plan, set for paper positions and past trades and null when a live plan exists:
    `stopPrice?, target1Price?`
  - `extraTargets jsonb [{ price, fraction }]` — display-only, for every kind.
    - The fractions sum to at most 1.
    - They live here rather than on `exit_rules` because they never feed `assess()`.
  - `accountEquity?` (locked when the position is filed), `riskRatingOverride smallint?`
  - `criteriaMet jsonb` (criterion ids), `mistakes jsonb string[]`, `lessons`
  - `archivedAt, timestamps`
  - There is no stored status and no "planned" flag. A real position with no anchor is awaiting
    import; the rest is derived.
- **`journal_legs`** — the owner's annotations, plus the typed-in fills of paper positions and of
  positions awaiting import.
  - `id, journalId (cascade), userId, side ENTRY|EXIT, date`
  - `firstTradeId? (FK trades, set null)` — on a linked real position, this and `date` key the
    annotation to its derived leg. Those legs' figures always come from the trades.
  - Typed-in legs only: `executedAt?, price?, quantity?, fee?`. A linked leg's time is its fills'
    `executed_at`.
  - `rating smallint?` (1–10), `note`
  - Unique `(journalId, firstTradeId) WHERE first_trade_id IS NOT NULL`.
- **`journal_images`**
  - `id, userId, journalId (cascade), legId? (set null)`
  - `phase` enum: `PLAN | ENTRY | DURING | EXIT`
  - `timeframe varchar(8), caption, pathname, thumbPathname, contentType, width, height, bytes,
    position, createdAt`
- **`exit_rules`** (existing) gains:
  - `journal_id` — FK to `journal_entries`, unique, nullable for plans that predate this.
  - `target1_override numeric?` — the manual Target 1, locked like the other entry facts.
    - When set, it replaces the computed Target 1 inside `assess()`.
    - Thread it through `ExitRulePosition` (`src/lib/exit/types.ts`). Move the inline Target 1
      arithmetic into an exported `target1For` beside `initialStopFor`, which static plans also
      use. Add a unit test.
    - It must sit above the entry price. Otherwise the framework inverts, for the same reason that
      `createExitRule` refuses a support level at or above entry.
  - `exit_rules` remains the store for live plans. `lib/exit/rules.ts`, the `/api/tv` feed and
    push notifications keep working.
- **`exit_settings`** (existing) gains `account_equity numeric?`, the account size that prefills
  the dialog. Null means the dialog asks for it.
- **`trades.executed_at timestamptz?`** — the execution time.
  - It is entered in JST but stored as an instant. A US fill viewed in JST falls after midnight, so
    its JST date can be the trade date + 1, and a time-only column would be ambiguous.
  - The restatement and settlement updates in `commitImport` write explicit `.set({...})` lists that
    do not name this column, so it survives them. Keep it that way, and test it.
  - Settlement regrouping replaces rows with new ones (`supersededTrades`). Carry the time over to
    the replacements when every superseded fill of that pool, day and side had the same time.
    Otherwise leave it empty for the owner to enter again.
- **New enums** `journal_kind`, `journal_leg_side` and `journal_image_phase` are kept in step with
  their TypeScript unions by hand, as `exit_action_kind` is.

## How a position works

- **Opening from scratch (real, awaiting import):**
  - Ensure an `instruments` row exists for the canonical symbol: a 4-digit TSE code or a US ticker
    (see `lib/domain/instruments.ts`).
    - Build it with `toInstrumentRow` from `src/db/mappers.ts`, so its id matches the one a later
      import would create (`instrumentId(symbol)`).
    - The import's instrument upsert overwrites the name, asset class and currency, so the first
      import corrects anything typed by hand.
    - The row also lets the `/api/tv` feed store bars at once. Price refresh and listing walk the
      engine's positions, not this table, so the row costs no provider calls.
  - Insert typed-in ENTRY legs.
  - Create the `exit_rules` row through the existing `createExitRule` service in
    `src/db/exit.service.ts`, with `journal_id` set.
- **Opening from a holding:** anchor to the current streak and create the live plan. There are no
  typed legs.
- **Opening a past trade:** anchor to the closed streak, with an optional static plan.
- **Opening a paper position:** typed legs, an `instruments` row as above, and an optional static
  plan. It never reaches the engine, or any figure outside the Playbook.
- **Shares remaining and shares sold** both feed `evaluateExitRule` in
  `src/server/exitPosition.ts`.
  - **Awaiting import:** taken from the typed legs.
  - **Linked:** taken from the position's own streak.
  - Without this, a position opened from scratch reads `POSITION_CLOSED` until its trades arrive.
    The notifier would then push a spurious change when they do, because the first evaluation only
    seeds silently.
  - Both callers of `evaluateExitRule` must pass these figures: the Playbook loader and
    `src/server/exitNotifications.ts`.
  - Put the choice in a small pure, tested function in `src/lib/playbook/streaks.ts`.

## Linking a position awaiting import

- **The owner links, the import never does.** The import result only reports that matching trades were found. Linking happens from "Trades found — link" on the Playbook.
- **The owner picks a streak, not trades.** The dialog lists the candidate streaks with their fills, one selectable. Membership is derived from the streak, so individual trades are never ticked.
- **Candidates:** streaks of the same pool whose first opening trade is dated on or after
  `entryDate − 1`, and that no other position resolves to. The −1 is there because Rakuten dates a
  US fill by its US day before settlement and by the JST day after (`CLAUDE.md`, *Import pipeline*).
- **On confirm:**
  - Set `anchorTradeId`.
  - Turn the typed legs into annotations of the derived legs, matched by side and then in order.
  - Write each typed time to its fills' `executed_at`, wherever that is still empty.
- **If the imported entry price or share count differs from what was typed**, offer to correct the
  plan through the existing typo-correction path, `updateExitRule`. It exists for this case:
  correcting the record is not the same as letting the market move it.

## Closing

- Nothing is written when a position closes; its status follows its streak.
- A closed position's live plan already evaluates as `POSITION_CLOSED` or `PLAN_SUPERSEDED`.
  - The position page and the Needs-action strip offer *Archive exit plan*, one click on the
    existing `archiveExitRule`.
  - Opening a new position on the same pool archives the old plan in the same transaction when that
    plan's position is closed. Otherwise `createExitRule` refuses the new plan with "Archive it
    before opening another".
- Do not archive automatically on a read. `toArchive` in `src/server/exit.ts` only *lists* plans for
  the owner to archive by hand. Archiving during a load would put a write on a read path.

## Result and R

- **Result (real):** the engine's realized events for the streak's closing trades.
  - Find them by reference through `engineFor` (`src/server/engine.ts`): the `records` carry ids,
    and `engine.realized[i].trade` is the same object as `record.trade`.
  - **JP:** `realizedJpy`.
  - **US:** in dollars, the way the app shows every US close: `usdGain` from `lib/pnl/usdResult.ts`
    (Rakuten's figure, with the sell commission not taken off), and the yen in brackets.
    - Do not display `realizedNative` here. It is net of the sell commission, and so it would
      disagree with Trades and Calendar on every US close.
- **R multiple:** `realizedNative` ÷ (risk per share × units closed).
  - `realizedNative` is net of both commissions and free of FX, so a JP R and a US R compare like
    for like.
  - A US position's R therefore sits slightly below what its displayed dollar figure implies, by the
    sell commission. The R tooltip says so.
- **Risk per share:**
  - When a plan exists, live or archived: entry minus initial stop, computed from the plan's stored
    entry facts.
  - When there is a static plan: entry minus `stopPrice`.
  - Otherwise there is no R.
- **Paper:** a pure function computes the result from the typed legs, at moving-average cost. It
  never enters the engine.

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
  - The stop is the plan's initial stop, live or static. Equity is the position's locked account
    size.
  - Later top-ups do not change the rating: it rates the trade as it was sized.
- **Result:** the R multiple on the closed units: −2R → 1, −1R → 3, 0 → 5, +1R → 7, +2R → 9,
  +3R → 10.
  - With no stop: return % instead: −10% → 1, −5% → 3, 0 → 5, +5% → 7, +10% → 9, +15% → 10.
- **Overall:** entry, exit, risk and result are 25% each, so process outweighs outcome three to one.
  - A missing part (no exit yet, an unrated leg, no stop) is dropped and the rest reweighted.
  - The score is then *provisional*, and so is any open position's.
- **Setup statistics** (`src/lib/playbook/stats.ts`):
  - Closed positions only.
  - A win is a result above zero: in yen for real positions, natively for paper ones.
  - Average R covers only the positions that have an R, and shows how many that is.
  - Average overall score.
  - Real and paper are reported separately.

## Images (Vercel Blob, private)

- **Store:**
  - Create a *private* store in Tokyo, with
    `vercel blob create-store <name> --access private --region hnd1` or by picking Tokyo in the
    dashboard.
    - The default region is `iad1`. Private images stream through the function, which is pinned to
      `hnd1` (`vite.config.ts`).
    - A store in Washington would add a trans-Pacific round trip to every upload and every image.
  - Connect it to the project for Production and Preview.
- **Authentication:**
  - On Vercel the SDK uses OIDC. Connecting the store sets `BLOB_STORE_ID`, and
    `VERCEL_OIDC_TOKEN` is injected at runtime. Nothing goes in `.env`.
  - New private stores default to OIDC; they do not hand out a `BLOB_READ_WRITE_TOKEN`
    automatically.
  - Confirm OIDC works on a preview deployment, which no local run can show. It should:
    `waitUntil` from `@vercel/functions` already works under this Nitro build and relies on the
    same request context.
- **`src/db/imageStore.ts` is the one place that stores images.** It exposes `put`, `get` and `del`,
  and lives in `src/db/` because it does I/O; `src/lib/` stays pure. It has three modes:
  - **Vercel Blob**, when `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` is set.
  - **Local disk** under a gitignored `.images/`, when neither is set and `VERCEL` is not set. This
    serves development and the end-to-end check.
  - **Disabled** on Vercel when neither is set. The upload control then says that image storage is
    not configured — the same contract as `TRADINGVIEW_WEBHOOK_SECRET`.
  - To work against the real store locally, put a static `BLOB_READ_WRITE_TOKEN` for the store in
    `.env`.
    - Do not use `vercel env pull` for this.
    - It writes an OIDC token that expires in about 12 hours, and it replaces the whole target file.
      This repo keeps its secrets in a hand-kept `.env` (`SETUP.md`).
  - This module is also where Cloudflare R2 would slot in.
- **Client:** `src/components/playbook/ImageDrop.tsx`.
  - Accepts paste (TradingView's "copy chart image" puts it on the clipboard), drag-drop or file
    picker.
  - Downscales on a canvas to a 2000 px maximum edge and encodes WebP at about 0.85 quality. It also
    makes a 480 px thumbnail the same way.
  - **Check the type that comes back.** Safari's canvas cannot encode WebP and silently returns PNG.
    Fall back to JPEG at about 0.9, and send the type actually produced.
- **Upload: an authed server fn, `uploadImage` in `src/server/playbook.ts`.**
  - It sends base64, as `src/server/uploads.ts` already does for CSVs.
  - Do not upload directly from the browser to Blob with `upload()`:
    - `handleUpload` does not accept OIDC tokens. It needs a static read-write token, or
      `handleUploadPresigned`.
    - A token route under `/api/*` sits outside the server-fn CSRF filter in `src/start.ts` and
      outside `authed`. It would need session and Origin checks of its own.
    - Here the blob and its row are written in one request. A failed second call cannot strand a
      blob, and `onUploadCompleted`, which cannot reach localhost, is not needed.
  - A downscaled image is a few hundred KB, far under the 4.5 MB function body limit.
    - Cap the decoded size at 3 MB, so that base64 (+33%) stays under the limit.
    - Do not copy `MAX_FILE_BYTES` (5 MB) from `src/server/uploads.ts`: once encoded, it is above
      the platform limit.
  - The handler:
    1. verifies that the caller owns the journal entry;
    2. checks the magic bytes for WebP, PNG or JPEG, rather than trusting the declared type;
    3. `put`s the image and its thumbnail at `users/<userId>/<journalId>/<uuid>[.thumb].<ext>`;
    4. inserts the row, and `del()`s what it put if the insert fails.
- **Serving:** `src/routes/api/images/$id.ts` (GET), an API route like `/api/tv/$secret.ts`.
  - Authenticate with `sessionForRequest` and `isAllowedEmail`, imported inside the handler as
    `authed` does.
  - Load the row by `(userId, id)`. Return 404 both for a missing row and for someone else's, so
    that existence does not leak.
  - `?size=thumb` serves the thumbnail.
  - Stream the body of `get(pathname, { access: 'private' })`. Streamed responses are not subject
    to the 4.5 MB cap.
  - Headers: the row's `Content-Type`, `X-Content-Type-Options: nosniff`, and
    `Cache-Control: private, no-store`.
  - **Why `no-store`:** `CLAUDE.md` requires holdings saved on a device to be wiped on sign-out.
    - The browser's HTTP cache cannot be cleared from JavaScript, and a chart screenshot shows the
      holding. A `max-age` would leave it on the device.
    - Re-fetching is cheap. Galleries use thumbnails, and Blob's own cache absorbs repeated reads;
      cache hits do not count as Blob operations.
  - The service worker passes `/api/*` straight through (`src/lib/offline/policy.ts`), so images are
    online-only. An image that fails to load shows a placeholder that says why.
- **Deleting:**
  - Delete the rows in the transaction.
  - Then `del()` the blobs inside `waitUntil(...)`, so the response does not wait, and report
    failures with `reportError`.
  - A leftover blob costs a few hundred KB; a row that points at nothing is a broken image.
- **Quota:**
  - Uploads and `list()` are advanced operations, and Hobby allows 2,000 a month. Keep any
    `list()`-based sweep off frequent paths.
  - If Blob is unavailable, image slots show a placeholder and nothing else on the page fails. This
    is the contract the price providers already keep: a storage outage must never break a render.
- **Server-only:** add `@vercel/blob` to `SERVER_ONLY` in `vite.config.ts`.
  - Today the guard does not list it, so nothing would catch a leak into the client bundle.
  - With server-side uploads the browser needs no Blob code at all, so the guard can be strict.

## Execution time on import

This is a change to the **existing CSV import flow** on the Import screen, the one used today for
the Rakuten trade-history exports. It is not a new or separate import. It does not depend on the
Playbook, so it ships first, as its own PR.

- **The preview lists no individual trades today.** It shows counts per file, plus the "Order within
  the day" list for the days that need ordering.
  - `previewFiles` must therefore also return the new and restated equity trades: id, symbol,
    account, side, quantity, price and date.
  - Key them by the row id the preview already computes (`idFor('trade', userId, hash)`), the way
    day orders are keyed.
- **Inputs:** an optional **Time (JST)** for each listed trade, hidden only for funds.
  - Days offered for ordering show the input inline in their `DayOrderList`.
  - All other trades go in a collapsible "Execution times (optional)" list.
- **US fills:**
  - The date part defaults to the stored 約定日, with a "+1 day" toggle for fills after midnight
    JST.
  - The stored 約定日 is the US day before settlement and the JST day after, so the correct toggle
    setting differs between the two cases.
  - Show the resolved instant in both JST and New York time, for example "= 10/20 11:30 ET", so the
    owner can see which session it lands in.
  - Warn, without blocking, when the instant falls outside the exchange's session hours, extended
    hours included.
- **Order pre-fill** (the owner's decision):
  - When every trade of a pool-day offered for ordering has a time, its list starts in time order.
  - The owner still confirms it, and the existing refusal rule still applies.
  - The hint says that confirming moves that day's figures away from Rakuten's buys-first count.
  - The Calendar's day-order list does the same when no order is stored yet.
  - Where a stored order contradicts stored times, the Calendar flags the day.
- **Commit:** `commitFiles` accepts `executedAt` keyed by row id, as it already accepts day orders.
- **Editing later:**
  - Times can also be edited on the Trades edit row (`TradeEditRow`; there is no edit dialog) and on
    a position's leg.
  - A leg's time writes through to any of its fills that have no time yet.

## Trade note (shared)

- For a trade in a filed real position, the note **is** its leg's `note`.
- Until the owner edits it, a leg's note reads as its fills' memos, joined if they differ. Nothing is
  copied in the meantime.
- Every path that reads or writes a trade's memo resolves to the leg's note when the trade belongs to
  a position. There are two such paths:
  - the Calendar journal row (`TradeJournalRow` → `setTradeJournal`);
  - the Trades edit row (`updateTrade`).
- `trades.memo` stays in place but is no longer shown for those trades. If the position is deleted,
  the memo shows again.
- Writing a note never marks a trade `isEdited`. `setTradeJournal` already keeps that rule.
- `trades.motivation` is unchanged.

## Removing the Exit Rules page

- **Navigation:** remove `/exits` from `NAV` in `src/components/SidebarNav.tsx` and from
  `src/components/icons/NavIcons.tsx`. Add `/playbook` with a new icon.
- **Old URL:** make `src/routes/_authed/exits.tsx` a redirect to `/playbook`, so bookmarks and old
  notifications still land.
- **Settings:**
  - Move `ExitSettingsForm` to `src/routes/_authed/settings.tsx`, and add the account-size field.
  - Show the webhook "not configured" warning there and on the Playbook.
- **Reuse:** `ExitLadder`, `ExitFlags`, the recommendation message and `ExitPlanDialog` content
  where they fit. Delete what becomes unused.
- **Plans to archive:** this section of `/exits` is replaced by *Closing* above.
- **Push notifications:**
  - The URL becomes `/playbook/<journalId>`, falling back to `/playbook`.
  - The notifier reads the plan's `journal_id`. Change `exitActionPushPayload` in
    `src/lib/notifications/exitActionNotice.ts`, its caller in `src/server/exitNotifications.ts`,
    and the default URL in `src/sw/sw.ts`.
  - `sw.ts` focuses an open window only when its path matches exactly, so a notification for another
    position opens a second window. Navigate the open window instead (`client.navigate`).
- **Existing plans with no `journal_id`:**
  - On first visit, show "File N existing exit plans in the Playbook".
  - It creates a real position anchored to each plan's streak and sets `journal_id`.
  - It ships with the Playbook screens (phase 3), so the two never disagree.
- **Archived plans:** their streaks appear under "From a past trade", with the stop prefilled.
- **Docs:** update `docs/exit-rules.md`:
  - §2 (opening a plan) and the §6 file table.
  - §1.1 says a leaked secret cannot "reach an instrument that was never traded". That stops being
    true once scratch and paper positions create instruments: the feed will store and publish closes
    for them as well. It still cannot read anything.
- **Tests:**
  - Update the tests that list `/exits`: `SidebarNav.test.tsx`, `PositionsRoute.test.tsx`
    (`NAV_ROUTES`) and `exitActionNotice.test.ts`.
  - Update `ExitCard.test.tsx` and `ExitLadder.test.tsx` if their components move.

## Files

- **New, pure and tested:** `src/lib/playbook/{types,streaks,score,stats,paper}.ts`.
- **New, database:** `src/db/playbook.service.ts` and `src/db/imageStore.ts`.
  - Scope every query by `userId`, child tables included.
  - Check uniqueness explicitly before inserting, as `createExitRule` does, so the owner gets a
    message rather than a raw 23505. If you also catch the violation, remember that Drizzle wraps
    pg errors: read `error.cause?.code`.
  - Build insert values explicitly. Spreading an input that carries `id: undefined` overrides the
    generated id.
  - Make ids the way `newExitRuleId` does: `idFor('<kind>', randomUUID())`.
- **New, server:** `src/server/playbook.ts`.
  - Server fns only, all `.middleware([authed])`.
  - Validators use zod from client-safe modules only.
- **New, routes:**
  - `src/routes/_authed/playbook.index.tsx`
  - `playbook.$journalId.tsx`
  - `playbook.setups.index.tsx`
  - `playbook.setups.$setupId.tsx`
  - `src/routes/api/images/$id.ts`. There is no upload route; see *Images*.
  - Do not add a `playbook.tsx` layout, or the others become its children.
- **New, components:** `src/components/playbook/`.
  - `PositionTable`, `OpenPositionDialog` (the four steps), `SetupDialog`, `ImageDrop`,
    `ImageGallery` with lightbox, `RatingInput`, `LegCard`, `ExitPlanPanel`, `ScorePanel`.
  - SCSS modules and tokens only.
  - JPY prices need one decimal; `money()` in `format.ts` rounds yen.
- **Modified:**
  - Exit framework: `src/db/schema.ts`, `src/db/exit.service.ts`, `src/server/exit.ts`,
    `src/server/exitPosition.ts`, `src/server/exitNotifications.ts`, `src/lib/exit/types.ts`,
    `src/lib/exit/rules.ts` (Target 1 override and `target1For`), `src/lib/exit/entry.ts`.
  - Import: `src/server/uploads.ts`, `src/db/import.service.ts`, `src/routes/_authed/import.tsx`,
    `src/components/trades/DayOrderList.tsx`.
  - Shared note: `src/db/trades.service.ts`, `src/server/notes.ts`, `src/server/trades.ts`,
    `src/components/calendar/TradeJournalRow.tsx`, `src/components/trades/TradeEditRow.tsx`.
  - App shell and build: the settings route, sidebar and icons, the notification payload,
    `src/sw/sw.ts`, `vite.config.ts` (`SERVER_ONLY`), and `.gitignore` (`.images/`).
  - `CLAUDE.md`:
    - the key-modules table;
    - `BLOB_STORE_ID`, and the optional `BLOB_READ_WRITE_TOKEN` for local work;
    - a domain-rule bullet: "A Playbook position is one holding streak; its trades, status and
      result are derived on read, never stored."
  - `SETUP.md`, `docs/exit-rules.md`, and a new `docs/playbook.md`.
- **Regenerated:** `src/routeTree.gen.ts`. It is committed; `npm run build` or `npm run dev`
  regenerates it.

## Verification

- **Every change:** `npm run typecheck && npx eslint src --max-warnings=0 && npm test`.
  - Without the gitignored `csv/` exports, 62 tests in 12 files fail. That is expected; nothing new
    may fail.
  - New unit tests:
    - `streaks.ts`: the cases listed under *What a position is*;
    - shares remaining and sold, for a position awaiting import and for a linked one;
    - score and stats: the curves, reweighting, provisional scores, and the best/worst rule under
      ten trades;
    - the Target 1 override in `rules.ts`;
    - US result and R: dollars from `usdGain`, R from `realizedNative`;
    - how the shared note resolves;
    - the import time map, including survival through restatement and settlement updates and the
      carry-over on regrouping;
    - order pre-fill from times;
    - the notification URL.
- **Database:** add `src/db/playbook.db.test.ts` and run it with `npm run test:db` (testcontainers,
  with Docker or Podman). It covers:
  - the partial unique indexes on the anchor and on the setup name;
  - cascades and `set null`;
  - an anchor whose trade has been soft-deleted.
- **Build:** `npm run build` must pass. It includes the server-code-in-client guard, which now
  covers `@vercel/blob`.
- **Offline:** after touching `src/sw/`, run `npm run check:offline`.
- **Preview deployment:** upload, view and delete an image on a Vercel preview. Only this shows that
  OIDC works, and it confirms the store's region.
- **End to end, locally:**
  - Run `npm run build && npm start` with `.env` and the local-disk image store.
  - Drive Chromium with Playwright through this flow:
    1. Open a position from scratch through all four dialog steps.
    2. Paste an image.
    3. Import a CSV with a JST time, and link the trades.
    4. Rate the legs, import the sell, and check the result, R and score.
    5. File a past trade.
    6. Check the setup page's best/worst galleries, the table filters and sorting, the `/exits`
       redirect, and the phone width.
- **In a cloud container without Docker:** Postgres 16 is at `/usr/lib/postgresql/16/bin`.
  1. `initdb` and start the database as the `postgres` user.
  2. Apply the files listed in `drizzle/meta/_journal.json` in order, as `src/test/postgres.ts`
     does. Confirm with `drizzle-kit push` that there is no diff.
  3. Point Playwright at `executablePath: '/opt/pw-browsers/chromium'`.
  4. Sign in by inserting a `session` row and setting the cookie
     `__Secure-better-auth.session_token` to
     `encodeURIComponent(token + '.' + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))`.
     - The cookie has the `__Secure-` prefix because `npm start` runs with `NODE_ENV=production`
       (`useSecureCookies` in `src/lib/auth.ts`).

## Delivery

One PR per phase, each on its own branch from `main`.

0. **Mock** (Step 0). Needs the owner's sign-off.
1. **Execution time on import**, with the order pre-fill. It is independent of everything else.
2. **Model and pure core:**
   - the migration;
   - `streaks`, `score`, `stats` and `paper`;
   - `playbook.service`;
   - the database tests.
   - No UI in this phase.
3. **Playbook screens:**
   - the table, the position page, and the Open Position dialog with all sources, paper included;
   - live and static plans;
   - the shared note;
   - filing existing plans.
   - From this phase on, plans are opened in the Playbook. `/exits` stays as a read-only view, with
     its New plan button removed.
4. **Images**, on Blob.
5. **Setups pages:** statistics and the best/worst galleries.
6. **Replace `/exits`:**
   - the redirect;
   - the settings move;
   - notification URLs;
   - removing it from the navigation;
   - the docs.

`/exits` stays usable until phase 6, so no release lacks a way to manage plans.

This plan file belongs in the repository at `docs/plans/playbook.md`. Commit it on its own branch
and merge it through a PR, as the repository does with every change, rather than pushing to `main`.

## Out of scope

- Ordering trades within a day by `executed_at` without the owner confirming the order.
- A partial-exit fraction or time stop per position. Both are global settings that apply live, by
  design.
- Splitting two decisions on the same side and day into separate legs.
- Moving images to Cloudflare R2.
