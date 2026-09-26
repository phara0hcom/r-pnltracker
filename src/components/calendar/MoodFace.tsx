/**
 * A day's mood as a small drawn face.
 *
 * It replaces emoji, which every platform draws differently and which at the
 * calendar's 11px could not be told apart — 🙁 and 😐 were one grey smudge.
 * The mouth alone carries the score, from a deep frown at 1 to a wide smile
 * at 5, and the stroke takes the text colour so it reads on any tint.
 *
 * Decorative: whatever shows it also says the mood in words for a screen reader.
 */

/** 1-indexed, so `[0]` is unused padding. */
export const MOOD_LABELS = ['', 'Awful', 'Poor', 'Neutral', 'Good', 'Great'] as const
export const MOTIVATION_LABELS = ['', 'Drained', 'Low', 'Steady', 'Driven', 'Sharp'] as const

const MOUTH = [
  '',
  'M5.3 11.4 Q8 8.6 10.7 11.4',
  'M5.5 11 Q8 9.5 10.5 11',
  'M5.5 10.4 H10.5',
  'M5.5 9.8 Q8 11.7 10.5 9.8',
  'M5 9.4 Q8 12.9 11 9.4',
]

export function MoodFace({
  mood,
  size = 16,
  className,
}: {
  mood: number | null | undefined
  size?: number
  className?: string
}) {
  const mouth = mood == null ? undefined : MOUTH[mood]
  if (!mouth) return null

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.9 6.5h.01M10.1 6.5h.01" strokeWidth={1.9} />
      <path d={mouth} />
    </svg>
  )
}
