/**
 * What the Playbook's server functions accept. Client-safe: validators run in
 * the browser, so nothing reachable from here may import a server-only module.
 */
import { z } from 'zod'
import { initialStopAtrMultiple, positiveDecimal, targetMultiple, trailingMethod } from '../exit/planInput'
import {
  decodedLength,
  MAX_CAPTION,
  MAX_IMAGE_EDGE,
  MAX_TIMEFRAME,
  MAX_UPLOAD_BASE64,
  MAX_UPLOAD_BYTES,
  UPLOAD_TOO_LARGE,
} from './images'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const instant = z.iso.datetime().nullable()
const ratingValue = z.number().int().min(1).max(10).nullable()
const account = z.enum(['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE'])

const extraTargets = z
  .array(z.object({ price: positiveDecimal('target price'), fraction: positiveDecimal('target fraction') }))
  .max(10)

const optionalPrice = (label: string) => positiveDecimal(label).nullable()

const planInputs = z.object({
  supportLevel: positiveDecimal('support level'),
  stopMultiple: initialStopAtrMultiple,
  targetMultiple,
  target1Override: optionalPrice('Target 1'),
  trailingMethod: trailingMethod.nullable(),
  note: z.string().trim().max(500).nullable(),
})

export type PlanInputs = z.infer<typeof planInputs>

const typedLeg = z.object({
  id: z.string().min(1).optional(),
  side: z.enum(['ENTRY', 'EXIT']),
  date: isoDate,
  executedAt: instant,
  price: positiveDecimal('price'),
  quantity: positiveDecimal('quantity'),
  fee: z.string().trim().regex(/^\d+(\.\d+)?$/, 'fee must be a number').default('0'),
})

export type TypedLegInput = z.infer<typeof typedLeg>

export const setupSchema = z.object({
  name: z.string().trim().min(1, 'A setup needs a name.').max(80, 'A setup’s name is 80 characters at most.'),
  description: z.string().trim().max(1000, 'A description is 1,000 characters at most.'),
  criteria: z
    .array(
      z.object({
        /** Kept across a rename, so ticks already recorded against it survive. */
        id: z.string().min(1).optional(),
        text: z.string().trim().max(200, 'A criterion is 200 characters at most.'),
      }),
    )
    .max(30, 'A setup can have 30 criteria at most.'),
})

export const updateSetupSchema = setupSchema.extend({ id: z.string().min(1) })

/**
 * Opening a position, by source. A holding or past trade names the streak by its
 * anchor; from scratch and paper carry the typed entry instead. The entry facts
 * are the plan's: they stay editable in the dialog and lock when saved.
 */
export const openPositionSchema = z.object({
  source: z.enum(['HOLDING', 'SCRATCH', 'PAST']),
  paper: z.boolean(),
  setupId: z.string().min(1),
  symbol: z.string().trim().min(1).max(128),
  name: z.string().trim().max(200),
  market: z.enum(['JP', 'US']),
  accountType: account.nullable(),
  entryDate: isoDate,
  entryPrice: positiveDecimal('entry price'),
  shares: positiveDecimal('shares'),
  executedAt: instant,
  anchorTradeId: z.string().min(1).nullable(),
  plan: planInputs.nullable(),
  extraTargets,
  accountEquity: optionalPrice('account size'),
})

export type OpenPositionData = z.infer<typeof openPositionSchema>

/** Lenient on purpose: this runs as the owner types, and answers with a message. */
export const previewPlanSchema = z.object({
  symbol: z.string(),
  entryDate: z.string(),
  entryPrice: z.string(),
  shares: z.string(),
  supportLevel: z.string(),
  stopMultiple: z.string(),
  targetMultiple: z.string(),
  target1Override: z.string().nullable(),
  extraTargets: z.array(z.object({ price: z.string(), fraction: z.string() })),
  accountEquity: z.string().nullable(),
})

const idOnly = z.object({ id: z.string().min(1) })
export const positionIdSchema = idOnly

export const updatePositionSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().min(1).nullable().optional(),
  riskRatingOverride: ratingValue.optional(),
  criteriaMet: z.array(z.string().min(1)).max(50).optional(),
  mistakes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  lessons: z.string().trim().max(5000).optional(),
  /** Replaces the typed legs — awaiting import and paper only. */
  legs: z.array(typedLeg).max(50).optional(),
})

/** A live plan's typo-correction, or a static plan's levels. */
export const updatePlanSchema = z.object({
  id: z.string().min(1),
  live: z
    .object({
      entryPrice: positiveDecimal('entry price'),
      totalShares: positiveDecimal('shares'),
      supportLevel: positiveDecimal('support level'),
      stopMultiple: initialStopAtrMultiple,
      targetMultiple,
      target1Override: optionalPrice('Target 1'),
      trailingMethod: trailingMethod.nullable(),
      note: z.string().trim().max(500).nullable(),
    })
    .optional(),
  static: z.object({ stopPrice: optionalPrice('stop'), target1Price: optionalPrice('Target 1') }).optional(),
  extraTargets,
})

export const annotationSchema = z.object({
  journalId: z.string().min(1),
  /** The stored row, once one exists. */
  legId: z.string().min(1).nullable(),
  side: z.enum(['ENTRY', 'EXIT']),
  date: isoDate,
  firstTradeId: z.string().min(1).nullable(),
  rating: ratingValue.optional(),
  note: z.string().trim().max(2000).optional(),
})

export const legTimeSchema = z.object({
  journalId: z.string().min(1),
  firstTradeId: z.string().min(1),
  executedAt: instant,
})

export const reattachSchema = z.object({
  legId: z.string().min(1),
  firstTradeId: z.string().min(1),
  side: z.enum(['ENTRY', 'EXIT']),
  date: isoDate,
})

export const linkSchema = z.object({
  id: z.string().min(1),
  anchorTradeId: z.string().min(1),
  /** Also correct the plan's entry price and shares to the imported ones. */
  correctPlan: z.boolean(),
})

const imageFields = z.object({
  phase: z.enum(['PLAN', 'ENTRY', 'DURING', 'EXIT']),
  timeframe: z
    .string()
    .trim()
    .max(MAX_TIMEFRAME, `A timeframe is ${String(MAX_TIMEFRAME)} characters at most, like 1D or 15m.`)
    .transform((value) => (value === '' ? null : value)),
  caption: z.string().trim().max(MAX_CAPTION, `A caption is ${String(MAX_CAPTION)} characters at most.`),
})

const encodedImage = z.object({
  base64: z.string().min(1).max(MAX_UPLOAD_BASE64, UPLOAD_TOO_LARGE),
  /** What the canvas produced. Checked against the bytes on the server, never believed. */
  contentType: z.string().max(40),
  width: z.number().int().min(1).max(MAX_IMAGE_EDGE),
  height: z.number().int().min(1).max(MAX_IMAGE_EDGE),
})

/**
 * An upload. Refused here, in the browser too, rather than sent only to fail: on
 * Vercel an over-long body would come back as a bare 413 with no sentence in it.
 */
export const uploadImageSchema = imageFields
  .extend({ journalId: z.string().min(1), image: encodedImage, thumb: encodedImage })
  .refine((data) => decodedLength(data.image.base64) + decodedLength(data.thumb.base64) <= MAX_UPLOAD_BYTES, {
    message: UPLOAD_TOO_LARGE,
  })

export const updateImageSchema = imageFields.extend({ id: z.string().min(1) })
