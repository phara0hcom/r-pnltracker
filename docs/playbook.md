# Playbook

The trade journal, and the home of the exit framework. A position is one swing
trade from open to close, filed under a setup, with chart screenshots, 1–10 ratings
and an exit plan. The point is to learn which setups work by comparing their best
and worst trades side by side.

`docs/plans/playbook.md` holds the full design and its reasoning. `CLAUDE.md` holds
the rules that are easy to get wrong. The framework itself is `docs/exit-rules.md`.

## What a position is

A real position is one holding streak of one pool: from the buy that takes
`(symbol × accountType)` off flat to the sell that returns it to flat, or to today.
Its trades, status and result are **derived on every read and never stored**. Only
the anchor (the streak's first opening trade id) and the owner's annotations are.
So top-ups and exits join by themselves when imported, and re-entering a pool starts
a new position rather than reopening a closed one.

| Status | Means |
|---|---|
| Awaiting import | Opened from scratch; the export has not arrived |
| Open | Its streak still holds units |
| Closed | Its streak is flat |
| Trades not found | The anchor resolves to nothing. It offers to relink and never guesses |

Paper positions have typed-in legs and never reach the engine or any figure outside
the Playbook.

## Screens

| Route | Shows |
|---|---|
| `/playbook` | *Needs action*, then every position; filters and sort live in the URL |
| `/playbook/$journalId` | One position: exit plan, score, charts, legs and review |
| `/playbook/setups` | One card per setup and kind it is used as, with its statistics |
| `/playbook/setups/$setupId` | A setup's best and worst trades, then all of its positions |
| `/exits` | Redirects to `/playbook`, keeping the account and market filters |

The framework's settings and the default account size are on `/settings`, under
*Exit framework*. Both `/settings` and `/playbook` warn when the webhook secret is
unset or too short.

## Opening a position

**Open position** on `/playbook` has four steps: source, setup, images, exit plan.

- **From a current holding** — an open streak no position resolves to. Gets a live plan.
- **New from scratch** — bought, but not exported yet. Gets a live plan, and its typed
  legs until the owner links the imported trades. It is deliberately not a manual
  trade, which would double the fill when the export arrives. Importing only reports
  that matches were found; the owner links them from the Playbook.
- **Paper** — from scratch with the Paper toggle. A static plan only.
- **From a past trade** — a closed streak no position resolves to. A static plan is
  optional, and if an archived plan covered the streak its stop is prefilled.

## Exit plans

| Plan | Who has one | What it does |
|---|---|---|
| Live | A real position opened from a holding or scratch | An `exit_rules` row: feed, ladder, recommendation and push |
| Static | Paper positions and past trades | Stop, Target 1 and extra targets, for risk and R only |
| Archived | A position whose live plan was retired | Read-only; its stop still gives the position its R |

A plan's entry facts are locked and everything path-dependent is replayed from
stored bars; see `docs/exit-rules.md`.

**Closing writes nothing.** A closed position's live plan evaluates as
`POSITION_CLOSED` or `PLAN_SUPERSEDED`, and *Needs action* and the position's page
offer *Archive exit plan*. A read never archives. Opening a new position on the same
pool archives the old plan in the same transaction when its position is over.

**Plans from before the Playbook** have no `journal_id`. They keep evaluating and
pushing, with their notification landing on `/playbook`. The Playbook offers *File N
existing exit plans*, which gives each a position anchored to its streak; a plan with
no streak to file under is listed there to archive.

## Notifications

A push fires when a live plan's recommendation changes, and lands on
`/playbook/<journal_id>`, or `/playbook` without one. Clicking brings forward a window
already on that position; otherwise an open window is sent there rather than a second
one opened.

## Scores and setup statistics

Scores and statistics are worked out on read and never stored. Overall is entry, exit,
risk and result at a quarter each, so process outweighs outcome three to one, and it
is marked provisional while a part is missing. Setup statistics count live positions
only, and real and paper apart. An archived position counts nowhere and shows on no
screen.

## Chart images

Private and online-only: stored by `src/db/imageStore.ts` in a private Vercel Blob
store, or a gitignored `.images/` locally, and served through `/api/images/$id` after a
session and ownership check. See `CLAUDE.md`.

## Where the code lives

| Path | Role |
|---|---|
| `src/lib/playbook/streaks.ts` | Holding streaks, anchors, legs and linking |
| `src/lib/playbook/position.ts` | One position as the screens read it |
| `src/lib/playbook/score.ts`, `stats.ts`, `paper.ts` | Score, setup statistics, paper results |
| `src/lib/playbook/plan.ts` | A plan's levels before there is a plan |
| `src/db/playbook.service.ts` | Setups, positions and annotations |
| `src/server/playbook.ts` | Server functions |
| `src/server/playbookView.ts` | The reads, kept out of client-reachable modules |
| `src/components/playbook/` | The table, dialogs, galleries, ratings and plan figures |
| `src/components/exits/` | What the Playbook and Settings share from the framework |
