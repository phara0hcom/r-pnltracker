/**
 * Where a push lands, through the real notifier. A plan from before the Playbook
 * has no position until the owner files it, and it has to keep pushing regardless.
 */
import Decimal from 'decimal.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyExitActionChanges } from './exitNotifications'
import type { ExitRuleRecord } from '~/db/exit.service'

const mocks = vi.hoisted(() => ({
  sendWebPush: vi.fn(),
  listRules: vi.fn(),
  recordState: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('./engine', () => ({
  engineFor: () => Promise.resolve({ records: [], trades: [], engine: { positions: [] } }),
}))
vi.mock('./exitPosition', () => ({
  holdingContext: () => ({}),
  evaluateExitRule: () => ({ result: { action: { kind: 'STOPPED_OUT', message: 'Sell.' } } }),
}))
vi.mock('~/db/exit.service', () => ({
  barsFor: () => Promise.resolve(new Map()),
  getExitSettings: () => Promise.resolve({}),
  listExitRulesForInstrument: mocks.listRules,
}))
vi.mock('~/db/notifications.service', () => ({
  getExitActionState: mocks.getState,
  listPushSubscriptions: () => Promise.resolve([{ endpoint: 'https://push.test/1', p256dh: 'p', auth: 'a' }]),
  pruneDeadSubscription: vi.fn(),
  recordExitActionState: mocks.recordState,
}))
vi.mock('~/db/playbook.service', () => ({ listJournalEntries: () => Promise.resolve([]) }))
vi.mock('~/lib/notifications/webpush', () => ({
  serverPushConfigured: () => true,
  sendWebPush: mocks.sendWebPush,
  isGoneSubscription: () => false,
}))
vi.mock('~/lib/observability/report', () => ({ reportError: vi.fn() }))

const plan = (journalId: string | null) =>
  ({ id: 'r1', userId: 'u1', symbol: '7203', journalId, entryPrice: new Decimal(1) }) as unknown as ExitRuleRecord

describe('notifyExitActionChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getState.mockResolvedValue('HOLD')
    mocks.sendWebPush.mockResolvedValue(undefined)
  })

  it('sends a filed plan to its position', async () => {
    mocks.listRules.mockResolvedValue([plan('journal-1')])
    await notifyExitActionChanges('i1')
    expect(mocks.sendWebPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ url: '/playbook/journal-1' }) as unknown }),
    )
    expect(mocks.recordState).toHaveBeenCalledWith('r1', 'u1', 'STOPPED_OUT')
  })

  it('still pushes a plan with no position, to the Playbook', async () => {
    mocks.listRules.mockResolvedValue([plan(null)])
    await notifyExitActionChanges('i1')
    expect(mocks.sendWebPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ url: '/playbook' }) as unknown }),
    )
  })
})
