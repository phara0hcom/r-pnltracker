/**
 * Geometry for a zero-origin bar.
 *
 * The track is one line whose zero point sits somewhere inside it: losses grow
 * left from that point, gains grow right. For a ¥100k gain and a ¥100k loss to
 * draw the same length, yen-per-percent has to be equal on both sides, which
 * fixes where the zero line goes — the space to its *left* is sized by the
 * largest loss, the space to its *right* by the largest gain. So the line sits
 * at the share of the range the losses occupy, not the gains.
 *
 * Getting that backwards is not obvious on screen: the two fills still scale
 * correctly against each other, so only the largest bar visibly runs past the
 * end of its track. Hence this is a tested function rather than arithmetic
 * inlined in the component.
 *
 * Pure and DB-free like the rest of `lib` — percentages in, percentages out.
 */
export interface ZeroBarGeometry {
  /** Distance from the left edge to the zero line, as a percentage of the track. */
  zeroPct: number
  /** Width of the positive fill. 0 unless the value is positive. */
  posPct: number
  /** Width of the negative fill. 0 unless the value is negative. */
  negPct: number
}

/**
 * `maxPos`/`maxNeg` are the largest magnitude on each side *across every row
 * being compared* — both as positive numbers — not this row's own value.
 * Passing per-row extents would scale every bar to full width and destroy the
 * comparison the bars exist to make.
 */
export function zeroBarGeometry(value: number, maxPos: number, maxNeg: number): ZeroBarGeometry {
  // A caller can hand over a negative extent from an empty reduce; treat it as
  // "no room on that side" rather than letting it flip the split.
  const positiveExtent = Math.max(maxPos, 0)
  const negativeExtent = Math.max(maxNeg, 0)
  const total = positiveExtent + negativeExtent

  // Nothing to scale against. Centre the line so the track still reads as a
  // zero-origin axis instead of collapsing to one side.
  if (total <= 0) return { zeroPct: 50, posPct: 0, negPct: 0 }

  const zeroPct = (negativeExtent / total) * 100
  const positiveRoom = 100 - zeroPct

  return {
    zeroPct,
    // Clamped: a value beyond the declared extent (a stale max, or a row the
    // caller forgot to include) must stop at the end of the track rather than
    // spill over the content beside it.
    posPct:
      value > 0 && positiveExtent > 0
        ? Math.min((value / positiveExtent) * positiveRoom, positiveRoom)
        : 0,
    negPct:
      value < 0 && negativeExtent > 0
        ? Math.min((Math.abs(value) / negativeExtent) * zeroPct, zeroPct)
        : 0,
  }
}
