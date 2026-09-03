# Exit Rules

Stops, targets and trailing levels for open swing positions, driven by a daily
TradingView feed. The screen answers one question each morning — *is there
anything I have to do today?* — and ranks positions by urgency rather than by
symbol or size.

The framework is fixed: it is the rule set used for TSE swing trades, extended
to US equities where the arithmetic is identical and only the lot size differs.

---

## 1. Setup

### 1.1 Generate and set the webhook secret

```bash
openssl rand -hex 32
```

Put it in `.env` (and in the Vercel project's environment variables):

```
TRADINGVIEW_WEBHOOK_SECRET="8f3c…a91"
```

The secret forms the endpoint path — `POST /api/tv/<secret>`. TradingView alerts
cannot send custom headers (the Notifications tab offers a URL and the alert
message, nothing else), so the path is the only place a shared secret can live
without editing the Pine script for every alert.

The trade-off is understood and accepted: a path secret can appear in proxy and
CDN logs in a way a header would not. It is mitigated by the token being long,
single-purpose, rotatable by changing one environment variable, and capable of
nothing except appending a price bar for an instrument that already exists in
the database.

**Under 24 characters, the endpoint refuses to serve at all.** Unset, the Exit
Rules screen says so at the top rather than letting every plan quietly read as
stale.

Confirm it works before wiring any alert — a `GET` on the same URL is a health
check:

```bash
curl https://<your-app>/api/tv/<secret>
# {"ok":true,"endpoint":"exit-rules feed"}
```

### 1.2 Apply the Pine script

Add this to the **daily** chart of each holding. Lengths are inputs so they stay
adjustable without editing code; the defaults match the framework (SMA 10/20,
RSI 14, ATR 14, MACD 12/26/9).

```pinescript
//@version=6
indicator("Exit Rules Data Feed", overlay=true)

smaShortLen = input.int(10, "SMA Short Length")
smaLongLen  = input.int(20, "SMA Long Length")
rsiLen      = input.int(14, "RSI Length")
atrLen      = input.int(14, "ATR Length")

smaShort = ta.sma(close, smaShortLen)
smaLong  = ta.sma(close, smaLongLen)
rsiVal   = ta.rsi(close, rsiLen)
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
atrVal   = ta.atr(atrLen)

jsonMsg = '{"ticker":"' + syminfo.ticker + '","exchange":"' + syminfo.exchange + '","time":' + str.tostring(time) + ',"close":' + str.tostring(close, "#.##") + ',"sma10":' + str.tostring(smaShort, "#.##") + ',"sma20":' + str.tostring(smaLong, "#.##") + ',"rsi14":' + str.tostring(rsiVal, "#.##") + ',"macd":' + str.tostring(macdLine, "#.####") + ',"macdSignal":' + str.tostring(signalLine, "#.####") + ',"macdHist":' + str.tostring(histLine, "#.####") + ',"atr14":' + str.tostring(atrVal, "#.##") + '}'

if barstate.isconfirmed
    alert(jsonMsg, alert.freq_once_per_bar_close)

plot(smaShort, "SMA10", color = color.blue)
plot(smaLong, "SMA20", color = color.orange)
```

The script needs no modification — the endpoint tolerates the two ways Pine's
`str.tostring` can emit text that is not strictly valid JSON. See §5.

### 1.3 Create the alert (once per open position)

1. Apply the script to the holding's **daily** chart.
2. Click the alarm-clock **Alert** icon.
3. Condition: **Exit Rules Data Feed** → **Any alert() function call**.
4. Trigger: **Once Per Bar Close**.
5. Expiration: the longest date offered. **On the Plus plan alerts expire after
   two months** — open-ended is Premium-only. Set a recurring reminder to renew,
   or the feed stops silently.
6. Notifications tab: enable **Webhook URL**, paste `https://<your-app>/api/tv/<secret>`.
7. Repeat per position. TradingView alerts are per-symbol, so add one when a
   position opens and delete it when the position closes. The Plus limit of 200
   alerts is not a practical constraint for a personal book.

A lapsed alert is the single most likely failure of this feature, which is why
staleness is surfaced per card *and* the suggested action says so explicitly.

---

## 2. Opening a plan

**Exit Rules → New plan.** Pick an open holding; entry date, entry price and
size prefill from the current holding streak. Only the support level is yours to
enter.

"Holding streak" means the run since the position was last flat — see
`src/lib/exit/entry.ts`. It is not the engine's moving-average cost basis, which
drifts with every later top-up and has no notion of "the trade that opened this
position". Entry price is blended across the buys in the streak, because a
position scaled into over three days was entered at that blend.

Prefilled values stay editable and are **frozen into the plan on save**. Nothing
recalculates them afterwards.

**Shares remaining is not stored.** It is read live from the engine's pool
quantity, so importing the Target 1 sell is what moves a plan from "take partial"
to "trail" — there is no second flag to keep in step, and no way for the two to
disagree.

---

## 3. The rules as implemented

`ATR(14)` arrives in the payload; nothing is recomputed locally.

| Quantity | Formula |
|---|---|
| Initial stop | `MIN(support, entry − 1.5 × ATR₁₄ at entry)` — locked at entry |
| Risk per share (R) | `entry − initialStop` |
| Target 1 | `entry + 1.5 × R` |
| Partial exit size | `ROUND_DOWN_TO_LOT(totalShares × 0.5)` |
| Stop after Target 1 | `MAX(entry, trailingStop)` |
| Trail — ATR (default) | `highestCloseSinceEntry − 3 × ATR₁₄` |
| Trail — SMA | `SMA10` or `SMA20`, counted only while that SMA is rising |
| Current effective stop | initial stop before Target 1; `MAX(breakeven, trail)` after |

Every multiplier, the partial fraction, the time-stop day count and the
staleness threshold are settings on the screen, not constants.

**The trailing stop only ever ratchets up.** A wider stop computed on a quieter
day never loosens one already earned.

**Time stop** — flags for review when *all four* hold:

- Target 1 not yet reached, and
- more than 12 **trading** days since entry, and
- the last five `macdHist` readings are strictly decreasing, and
- the most recent `rsi14` is below 50.

### Two interpretations worth stating

**"Shrinking" MACD histogram means falling *values*, not falling magnitude.** A
histogram going −0.5 → −0.1 is momentum *recovering* for a long position;
testing `|h|` would have flagged that as fading and closed the trade into a turn.

**Trading days, not calendar days.** Counting calendar days would fire the time
stop early on any position spanning Golden Week, and would report "stale" every
Monday. The JP and US exchange calendars are derived arithmetically from the
statutory rules — including 振替休日, 国民の休日, the 年末年始 closure, and the US
Good Friday and Saturday/Sunday observance shifts — rather than listed, so they
do not silently stop being right next year. See `src/lib/exit/calendar.ts`.

---

## 4. Nothing path-dependent is stored

Highest close, whether Target 1 was reached, and the ratcheting trail are all
**replayed from the full stored bar history on every read**, never mutated in
place.

This is deliberate. The obvious alternative — keep a running high-water mark and
update it as each payload lands — is wrong in a way that never heals: one bad or
duplicated payload permanently poisons the ratchet, and because the trail only
moves up, no later observation can correct it. Replaying means a deleted or
backfilled bar simply produces the right answer next time.

Which is also why every payload is persisted rather than overwriting "today's
row", and why a resent bar for the same session **updates** rather than
duplicating — a duplicate would distort the five-reading momentum window.

---

## 5. Edge cases handled

**Opening gaps are approximated, not observed.** The payload carries `close`
only, so a true gap is strictly unobservable. What is observable is that price
crossed from above the stop to well below it in one session — more than half an
ATR through — which makes "you were filled at your stop" a bad assumption. That
case reports *"Stopped out — gap"* and says to assume a fill at market. Anything
shallower reports an ordinary stop-out.

**Pine's number formatting.** A `"#.##"` pattern treats each `#` as an optional
digit, so a value below 1 can serialise as `.0123` or `-.0123`, which is not
valid JSON. MACD lines sit near zero constantly, so the endpoint repairs the
leading zero before parsing. Quoted strings are untouched.

**Indicators that have not warmed up** arrive as `NaN` and the bar is rejected
outright rather than stored as zero.

**Bar dates are read in the exchange's timezone.** TradingView sends `time` as
the bar's opening instant in UTC milliseconds; for a 東証 daily bar that is 15:00
UTC the *previous* day. Reading it naively would shift every JP bar back one day
and break both the entry-ATR lookup and the staleness count.

**A plan opened before its entry-day bar exists** rests on the support level
alone — the card says *"support only — no entry ATR"*. When a payload for that
date later arrives, the webhook backfills the ATR for exactly that plan. This is
not a recalculation: it completes a value that was missing, from the plan's own
entry date.

**An unknown ticker is discarded with a 404** and logged. An alert exists for
something the account has never traded, so there is nothing to attach a bar to.

**Suggested-action precedence** runs most urgent first, so a stopped-out position
is never also told to "hold". A stop-out outranks staleness — knowing the last
observed close was already through the stop is more actionable than knowing the
feed is quiet — and the stale badge stays visible either way.

**Share quantities are always whole board lots**: 100 on 東証, 1 for US shares,
rounded *down*. Over-trimming a winner is the costlier mistake. A single-lot
position cannot be halved, and the card says so rather than suggesting a
zero-share sale.

---

## 6. Where the code lives

| Path | Role |
|---|---|
| `src/lib/exit/rules.ts` | The framework — `assess()` returns every level plus the recommendation |
| `src/lib/exit/calendar.ts` | JP and US trading-day calendars |
| `src/lib/exit/entry.ts` | Current holding streak, for prefill |
| `src/lib/exit/webhook.ts` | Payload parsing, timezone and Pine-JSON repair |
| `src/routes/api/tv/$secret.ts` | The webhook endpoint (no session — see §1.1) |
| `src/db/exit.service.ts` | Plans, settings, bar storage |
| `src/server/exit.ts` | Server functions backing the screen |
| `src/routes/_authed/exits.tsx` | The screen |

`src/lib/exit/` is pure and DB-free like the rest of `lib/`, so the whole rule
set is tested against handmade bar sequences with no database and no network —
see `rules.test.ts`, `calendar.test.ts` and `webhook.test.ts`.
