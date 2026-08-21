/** Marks a link as leaving the app, so the jump isn't a surprise. */
export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 2h8v8M14 2 6.5 9.5M11 10.5V14H2V5h3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
