/**
 * Drizzle schema — Postgres (Neon).
 *
 * Money and quantity columns are `numeric`, never `real`/`double`. Fund unit
 * counts run to 7+ significant digits and cost basis compounds across hundreds
 * of trades, so binary floats would drift. Values round-trip through
 * `decimal.js` in the application layer.
 *
 * Every user-owned table carries `userId` even though this is a single-user
 * app: it costs nothing now and avoids a painful migration if that changes.
 */
import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

// ── Enums ───────────────────────────────────────────────────────────────────
export const accountTypeEnum = pgEnum('account_type', [
  'SPECIFIC',
  'NISA_OLD',
  'NISA_GROWTH',
  'NISA_TSUMITATE',
])
export const assetClassEnum = pgEnum('asset_class', ['JP_EQUITY', 'US_EQUITY', 'FUND'])
export const currencyEnum = pgEnum('currency', ['JPY', 'USD'])
export const tradeSideEnum = pgEnum('trade_side', ['BUY', 'SELL', 'REINVEST', 'REDEEM'])
export const dividendKindEnum = pgEnum('dividend_kind', ['DIVIDEND', 'DISTRIBUTION'])
/** Where a row came from. Manual rows are never touched by an import. */
export const originEnum = pgEnum('origin', ['IMPORT', 'MANUAL'])
export const cashKindEnum = pgEnum('cash_kind', ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'])
export const priceSourceEnum = pgEnum('price_source', ['FINNHUB', 'SCRAPE', 'MANUAL', 'STALE'])

/** Monetary/quantity precision: 24 digits total, 8 decimal places. */
const money = (name: string) => numeric(name, { precision: 24, scale: 8 })

// ── Better Auth tables ──────────────────────────────────────────────────────
// Shapes are dictated by Better Auth's Drizzle adapter — regenerate with its
// CLI rather than editing by hand.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ── Instruments ─────────────────────────────────────────────────────────────

/**
 * `symbol` is the canonical identity: a 4-digit code for JP equities, a ticker
 * for US equities, and the fund name for 投信 (Rakuten's exports carry no fund
 * code). Renamed funds are folded onto one symbol before insert — see
 * `lib/domain/instruments.ts`.
 */
export const instruments = pgTable(
  'instruments',
  {
    id: text('id').primaryKey(),
    symbol: varchar('symbol', { length: 128 }).notNull(),
    name: text('name').notNull(),
    assetClass: assetClassEnum('asset_class').notNull(),
    currency: currencyEnum('currency').notNull(),
    exchange: varchar('exchange', { length: 32 }),
    isin: varchar('isin', { length: 12 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('instruments_symbol_uq').on(table.symbol)],
)

// ── Trades ──────────────────────────────────────────────────────────────────

export const trades = pgTable(
  'trades',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id),

    /** 約定日 — drives performance views and the calendar. */
    tradeDate: date('trade_date').notNull(),
    /** 受渡日 — drives tax-year attribution. */
    settleDate: date('settle_date').notNull(),

    accountType: accountTypeEnum('account_type').notNull(),
    side: tradeSideEnum('side').notNull(),

    quantity: money('quantity').notNull(),
    /** Per single unit — fund 基準価額 is divided by 10,000 at parse time. */
    unitPrice: money('unit_price').notNull(),
    currency: currencyEnum('currency').notNull(),

    fee: money('fee').notNull().default('0'),
    /** Consumption tax on commission (JP) or withholding (US) — NOT capital gains tax. */
    feeTax: money('fee_tax').notNull().default('0'),
    otherCost: money('other_cost').notNull().default('0'),

    /** USD→JPY on the trade; 1 for JPY-native instruments. */
    fxRate: money('fx_rate').notNull().default('1'),
    grossAmount: money('gross_amount').notNull(),
    netAmount: money('net_amount').notNull(),
    /** The value cost basis and realized P&L are tracked in. Always whole yen. */
    netAmountJpy: money('net_amount_jpy').notNull(),

    /** Rakuten points applied — informational, already inside `netAmount`. */
    pointsUsed: money('points_used'),
    /** False when 受渡金額 was "-" and the amount had to be derived. */
    isSettled: boolean('is_settled').notNull().default(true),

    /** Makes re-importing overlapping exports a no-op. */
    sourceRowHash: varchar('source_row_hash', { length: 64 }).notNull(),
    sourceFile: text('source_file').notNull(),
    importBatchId: text('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),

    /** CSV import or hand-entered. Manual rows are never rewritten by an import. */
    origin: originEnum('origin').notNull().default('IMPORT'),
    /** True when an imported row has been hand-corrected; the edit is authoritative. */
    isEdited: boolean('is_edited').notNull().default(false),
    editedAt: timestamp('edited_at'),
    /**
     * Soft delete.
     *
     * Hard-deleting an imported trade would let the next CSV import resurrect
     * it, because dedupe works on `sourceRowHash` and the row would be gone.
     * Keeping a tombstone means the hash still matches and the deletion sticks.
     */
    deletedAt: timestamp('deleted_at'),
    /** Free-text note on the trade itself — rationale, thesis, mistake. */
    memo: text('memo'),
    /**
     * 1–5, how motivated you felt taking this specific trade.
     *
     * Separate from the daily journal score: a good day can contain one
     * impulsive trade, and averaging that away is exactly the signal worth
     * keeping.
     */
    motivation: smallint('motivation'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // The idempotency guarantee: the DB, not the app, is the final arbiter.
    uniqueIndex('trades_user_hash_uq').on(table.userId, table.sourceRowHash),
    index('trades_user_trade_date_idx').on(table.userId, table.tradeDate),
    index('trades_user_settle_date_idx').on(table.userId, table.settleDate),
    // The engine walks pools keyed by (instrument, account) in date order.
    index('trades_pool_idx').on(table.userId, table.instrumentId, table.accountType, table.tradeDate),
    // Every read path filters out tombstones.
    index('trades_active_idx').on(table.userId, table.deletedAt),
  ],
)

// ── Dividends ───────────────────────────────────────────────────────────────

export const dividends = pgTable(
  'dividends',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id').references(() => instruments.id),

    payDate: date('pay_date').notNull(),
    /** Resolved by matching holdings; the source statement has no account column. */
    accountType: accountTypeEnum('account_type').notNull(),
    kind: dividendKindEnum('kind').notNull(),

    /** Reconstructed from the credited amount. Equals `netAmount` when exempt. */
    grossAmount: money('gross_amount').notNull(),
    incomeTax: money('income_tax').notNull().default('0'),
    localTax: money('local_tax').notNull().default('0'),
    /** As credited by Rakuten — the only figure the statement actually reports. */
    netAmount: money('net_amount').notNull(),
    currency: currencyEnum('currency').notNull().default('JPY'),

    isTaxable: boolean('is_taxable').notNull(),
    /** False when the account was inferred (paid after the position closed). */
    attributionConfident: boolean('attribution_confident').notNull().default(true),

    sourceRowHash: varchar('source_row_hash', { length: 64 }).notNull(),
    sourceFile: text('source_file').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dividends_user_hash_uq').on(table.userId, table.sourceRowHash),
    index('dividends_user_pay_date_idx').on(table.userId, table.payDate),
  ],
)

// ── Cash ledger ─────────────────────────────────────────────────────────────

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    kind: cashKindEnum('kind').notNull(),
    description: text('description').notNull().default(''),
    amount: money('amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    sourceRowHash: varchar('source_row_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cash_user_hash_uq').on(table.userId, table.sourceRowHash),
    index('cash_user_date_idx').on(table.userId, table.date),
  ],
)

// ── Position snapshots (validation oracle) ──────────────────────────────────

/**
 * Month-end holdings straight from 取引残高報告書. Never used to compute
 * anything — held only so the engine's output can be reconciled against what
 * Rakuten actually reported holding.
 */
export const positionSnapshots = pgTable(
  'position_snapshots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id').references(() => instruments.id),
    asOf: date('as_of').notNull(),
    symbol: varchar('symbol', { length: 128 }).notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    quantity: money('quantity').notNull(),
    valuationJpy: money('valuation_jpy').notNull(),
  },
  (table) => [
    uniqueIndex('snapshot_uq').on(table.userId, table.asOf, table.symbol, table.accountType),
    index('snapshot_user_asof_idx').on(table.userId, table.asOf),
  ],
)

// ── Prices ──────────────────────────────────────────────────────────────────

/**
 * Durable last-known price per instrument.
 *
 * One row per instrument, updated in place: this is the cross-session stale
 * store that lets the app render when Finnhub's free-tier quota is exhausted.
 * TanStack Query handles in-session caching on top of it.
 */
export const priceCache = pgTable(
  'price_cache',
  {
    instrumentId: text('instrument_id')
      .primaryKey()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    price: money('price').notNull(),
    currency: currencyEnum('currency').notNull(),
    /** Market timestamp the quote refers to — drives the staleness badge. */
    asOf: timestamp('as_of').notNull(),
    source: priceSourceEnum('source').notNull(),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (table) => [index('price_cache_fetched_idx').on(table.fetchedAt)],
)

/**
 * Hand-entered prices, per user.
 *
 * Kept out of `price_cache` deliberately. A fetched quote is market data and is
 * the same for everyone, so caching it once is right; an override is one user's
 * judgement about an instrument no provider can price — funds, most JP tickers.
 * Storing the two in one row would make one user's correction silently rewrite
 * every other user's valuations, which is the one thing the `userId`-everywhere
 * rule at the top of this file exists to prevent.
 */
export const priceOverrides = pgTable(
  'price_overrides',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    price: money('price').notNull(),
    currency: currencyEnum('currency').notNull(),
    setAt: timestamp('set_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.instrumentId] })],
)

export const fxRates = pgTable(
  'fx_rates',
  {
    base: currencyEnum('base').notNull(),
    quote: currencyEnum('quote').notNull(),
    rate: money('rate').notNull(),
    asOf: timestamp('as_of').notNull(),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.base, table.quote] })],
)

// ── Journal ─────────────────────────────────────────────────────────────────

/**
 * One entry per day. Mood and motivation are 1–5 so they can be correlated
 * against that day's realized P&L.
 */
export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    mood: smallint('mood'),
    motivation: smallint('motivation'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // One note per day keeps the calendar unambiguous.
    uniqueIndex('notes_user_date_uq').on(table.userId, table.date),
    index('notes_user_date_idx').on(table.userId, table.date),
  ],
)

// ── Import audit ────────────────────────────────────────────────────────────

export const importBatches = pgTable('import_batches', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  fileType: varchar('file_type', { length: 16 }).notNull(),
  rowsParsed: integer('rows_parsed').notNull().default(0),
  rowsInserted: integer('rows_inserted').notNull().default(0),
  rowsSkipped: integer('rows_skipped').notNull().default(0),
  /** Row-level parse failures, kept so a bad import can be diagnosed later. */
  errors: jsonb('errors').$type<{ line: number; message: string }[]>().notNull().default([]),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
})

// ── Relations ───────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  trades: many(trades),
  dividends: many(dividends),
  notes: many(notes),
  importBatches: many(importBatches),
}))

export const instrumentRelations = relations(instruments, ({ many, one }) => ({
  trades: many(trades),
  dividends: many(dividends),
  price: one(priceCache, {
    fields: [instruments.id],
    references: [priceCache.instrumentId],
  }),
}))

export const tradeRelations = relations(trades, ({ one }) => ({
  instrument: one(instruments, {
    fields: [trades.instrumentId],
    references: [instruments.id],
  }),
  user: one(user, { fields: [trades.userId], references: [user.id] }),
  batch: one(importBatches, {
    fields: [trades.importBatchId],
    references: [importBatches.id],
  }),
}))

export const dividendRelations = relations(dividends, ({ one }) => ({
  instrument: one(instruments, {
    fields: [dividends.instrumentId],
    references: [instruments.id],
  }),
}))

export type DbTrade = typeof trades.$inferSelect
export type NewDbTrade = typeof trades.$inferInsert
export type DbInstrument = typeof instruments.$inferSelect
export type DbDividend = typeof dividends.$inferSelect
export type DbNote = typeof notes.$inferSelect
export type NewDbNote = typeof notes.$inferInsert
export type DbPriceCache = typeof priceCache.$inferSelect
export type DbPriceOverride = typeof priceOverrides.$inferSelect
