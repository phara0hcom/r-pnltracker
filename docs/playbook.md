# Playbook

A playbook is a type of play — a breakout, a pullback to the 20-day — and the
conditions that make a trade one. Each trade is reviewed under one: how the
entry and exit were made, rated 1–10 with an explanation, the risk taken, and
the candles the decisions were judged on, captured on as many timeframes as
are useful and drawn from data rather than stored as screenshots.

## Setting up

1. Apply `drizzle/0004_playbook.sql` (or `npm run db:push`).
2. The candle webhook shares `TRADINGVIEW_WEBHOOK_SECRET` with the exit-rules
   feed — nothing new to configure. Check it from a browser:

   ```bash
   curl https://<host>/api/candles/<secret>
   # {"ok":true,"endpoint":"playbook candles"}
   ```

## Reviews

- **From my trades** — pick a position (one symbol in one account: 移動平均法
  averages within that pool, so a review cannot mix two) and the buys and
  sells that made the trade. The result is the engine's realized P&L for the
  linked sells, fees included, so it matches Trades and Tax. A trade can be in
  one review only.
- **Paper trade** — a setup watched but not taken. Its legs are typed in and
  its result is computed from them. Paper reviews are kept out of every figure
  outside this screen, and summarised separately on each playbook.

A scale-in or a partial exit is its own leg, with its own rating. Ratings
average weighted by size, so a small add rated 3 counts less than the main
entry rated 8.

**Time of fill.** No Rakuten export carries an execution time. Without one an
intraday chart shades the fill's whole day; with one (exchange-local `HH:MM`)
it marks the bar.

## The overall score

Out of 10, in four equal parts — `src/lib/playbook/score.ts`:

| Part | From |
|---|---|
| Entry | the entries' ratings |
| Exit | the exits' ratings |
| Risk | 70% the share of the account lost at the stop (½% → 10, 1% → 9, 2% → 6, 3% → 3, 5% → 1), 30% the position's share of the account (≤10% → 10, 30% → 6, 75% → 1). Overridable by hand. |
| Result | R multiple (−2R → 1, −1R → 3, 0 → 5, +1R → 7, +2R → 9, +3R → 10), or the return when there is no stop |

Three parts are process and one is outcome, on purpose: a well-run loss should
outscore a lucky, oversized gamble. A part that cannot be known yet — no exit,
no rating, no stop — is left out and the others reweighted, and the score is
marked provisional. The score is never stored; it is recomputed on every read.

R is measured on the units closed: half a position out at +2R is +2R on that
half.

## Candles

Each leg can capture charts on any timeframe. A capture is frozen into the
review (`review_charts`) — sources forget intraday history, and a review should
keep showing what was judged. Capturing the same timeframe again refreshes it.
Each chart keeps 60 bars before the fill and up to 30 after.

### From TradingView (the alert)

Add this indicator to a chart **after opening a trade**, on each timeframe you
want, and create an alert on it. Every bar close it sends its last 30 bars, so
the first delivery already carries the structure *before* the entry, and a
missed delivery heals on the next one.

```pinescript
//@version=6
indicator("Playbook Candles", overlay=true)

barsBack = input.int(30, "Bars per alert", minval=1, maxval=100)

num(x) => na(x) ? "null" : str.tostring(x)

if barstate.isconfirmed
    n = math.min(barsBack, bar_index + 1)
    rows = array.new_string()
    for i = n - 1 to 0
        array.push(rows, "[" + str.tostring(time[i]) + "," + num(open[i]) + "," + num(high[i]) + "," + num(low[i]) + "," + num(close[i]) + "," + num(volume[i]) + "]")
    alert('{"ticker":"' + syminfo.ticker + '","exchange":"' + syminfo.exchange + '","interval":"' + timeframe.period + '","bars":[' + array.join(rows, ",") + "]}", alert.freq_once_per_bar_close)
```

Alert: condition **Playbook Candles → Any alert() function call**, trigger
**Once Per Bar Close**, webhook URL `https://<host>/api/candles/<secret>`. The
endpoint takes at most 100 bars per delivery; at 30 the message stays well
inside TradingView's size limit.

A plain alert with no Pine works too, one bar at a time, with this message:

```json
{"ticker":"{{ticker}}","exchange":"{{exchange}}","interval":"{{interval}}","time":"{{time}}","open":{{open}},"high":{{high}},"low":{{low}},"close":{{close}},"volume":{{volume}}}
```

Bars are keyed by `syminfo.ticker` without the venue (`7203`, `AAPL`,
`BRK.B`) and the timeframe, normalised (`5` → `5m`, `60` → `1h`, `D` → `1D`).

### From Yahoo

No setup, but Yahoo's reach is limited: 1-minute bars for about 30 days, up to
30-minute bars for 60, hourly for two years, daily and longer without limit,
and no 4-hour bars at all. Past those the capture says so — use the alert or a
longer timeframe. Yahoo also rate-limits by IP; wait a minute and retry.

## Files

| Path | Role |
|---|---|
| `src/lib/playbook/candles.ts` | webhook payload, timeframes, windows, fill placement, Yahoo request/response |
| `src/lib/playbook/score.ts` | figures, ratings and the overall score |
| `src/lib/playbook/stats.ts` | per-playbook win rate, mean R, mean score |
| `src/routes/api/candles/$secret.ts` | the candle webhook |
| `src/db/candles.service.ts` / `src/db/playbook.service.ts` | storage |
| `src/server/playbook.ts` | server functions; `src/server/candleSources.ts` fetches for a capture |
