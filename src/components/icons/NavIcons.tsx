/**
 * One icon per screen in the sidebar.
 *
 * Drawn rather than typed. These were Unicode glyphs (`◎ ≡ ▤ ◇ ▦ ◈ ◱`), which
 * carried no meaning and, worse, are sized by whichever font resolves them —
 * so enlarging them for the collapsed rail gave ten different optical sizes and
 * baselines. Paths scale.
 *
 * House style from the other icons here: a 16×16 viewBox, `currentColor` so
 * they take the link's state colour, and no `width`/`height` so the stylesheet
 * decides how big they are.
 */
const BASE = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
} as const

interface IconProps { className?: string }

/**
 * Panels. A gauge would say "read-out" more precisely, but its needle is a
 * three-pixel stroke at this size and reads as a squiggle.
 */
const Dashboard = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <rect x="2.2" y="2.2" width="5" height="5" rx="1" />
    <rect x="8.8" y="2.2" width="5" height="5" rx="1" />
    <rect x="2.2" y="8.8" width="5" height="5" rx="1" />
    <rect x="8.8" y="8.8" width="5" height="5" rx="1" />
  </svg>
)

/** Two-way arrows: things bought and sold. */
const Trades = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M3.5 5.5h9M10 3l2.5 2.5L10 8" />
    <path d="M12.5 10.5h-9M6 8l-2.5 2.5L6 13" />
  </svg>
)

/** Layers: what is currently held, stacked. */
const Positions = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M8 2 2 5l6 3 6-3-6-3Z" />
    <path d="M2 8.5 8 11.5l6-3" />
    <path d="M2 11.5 8 14.5l6-3" />
  </svg>
)

/**
 * A coin taking income in.
 *
 * Deliberately not a circle with an arrow leaving it at 45° — that is the Mars
 * symbol, and at 16px it reads as exactly that.
 */
const Dividends = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 5v6M8 11l-2.1-2.1M8 11l2.1-2.1" />
  </svg>
)

const Calendar = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
)

const Stats = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M2.5 13.5h11" />
    <path d="M5 13.5V9M8 13.5V4.5M11 13.5V7" />
  </svg>
)

/** A shield: the tax-free wrapper. */
const Nisa = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M8 2 3.5 3.8v4.1c0 2.9 1.9 5 4.5 6.1 2.6-1.1 4.5-3.2 4.5-6.1V3.8L8 2Z" />
  </svg>
)

/** ¥ — the same idea the glyph carried, drawn to match its neighbours. */
const Tax = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M4.5 3 8 7.8 11.5 3" />
    <path d="M8 7.8v5.2M5.3 9.4h5.4M5.3 11.3h5.4" />
  </svg>
)

/** Into a tray. */
const Import = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M8 2v7M8 9l2.8-2.8M8 9 5.2 6.2" />
    <path d="M2.5 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
)

/**
 * A price line with a stop level beneath it. The horizontal rule is the point —
 * a bare trend line would read as Stats, and the whole screen is about the
 * level the line must not cross.
 */
const Exits = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <path d="M1.8 10.2 5 6.6l2.4 2.2L11 3.8" />
    <path d="M9.6 3.8H11v1.4" />
    <path d="M1.8 13.2h12.4" strokeDasharray="2 1.8" />
  </svg>
)

const Settings = ({ className }: IconProps) => (
  <svg {...BASE} className={className}>
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1.8v1.4M8 12.8v1.4M14.2 8h-1.4M3.2 8H1.8M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1" />
  </svg>
)

/** Keyed by route, so a nav entry cannot name an icon that does not exist. */
export const NAV_ICONS = {
  '/dashboard': Dashboard,
  '/trades': Trades,
  '/positions': Positions,
  '/exits': Exits,
  '/dividends': Dividends,
  '/calendar': Calendar,
  '/stats': Stats,
  '/nisa': Nisa,
  '/tax': Tax,
  '/import': Import,
  '/settings': Settings,
} as const

export type NavRoute = keyof typeof NAV_ICONS
