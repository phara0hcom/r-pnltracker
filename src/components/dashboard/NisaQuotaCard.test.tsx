/**
 * An annual frame refills on 1 January; the lifetime pool does not — only the
 * cost of this year's NISA sales comes back — so only a frame may say so.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NisaQuotaCard } from './NisaQuotaCard'
import type { DashboardNisa } from '~/server/portfolio'

const nisa: DashboardNisa = {
  lifetimeUsedJpy: '6000000',
  lifetimeLimitJpy: '18000000',
  lifetimeRemainingJpy: '12000000',
  lifetimeUtilization: 1 / 3,
  pendingRestorationJpy: '0',
  restorationDate: '2027-01-01',
  year: 2026,
  growthUsedJpy: '2400000',
  growthLimitJpy: '2400000',
  growthRemainingJpy: '0',
  growthUtilization: 1,
  tsumitateUsedJpy: '600000',
  tsumitateLimitJpy: '1200000',
  tsumitateRemainingJpy: '600000',
  tsumitateUtilization: 0.5,
}

describe('NisaQuotaCard', () => {
  it('says a full annual frame stays full until January', () => {
    render(<NisaQuotaCard nisa={nisa} />)
    expect(screen.getByText('Full until January')).toBeTruthy()
  })

  it('does not promise January to a full lifetime pool', () => {
    render(
      <NisaQuotaCard
        nisa={{
          ...nisa,
          lifetimeUsedJpy: '18000000',
          lifetimeRemainingJpy: '0',
          lifetimeUtilization: 1,
          growthUsedJpy: '0',
          growthRemainingJpy: '2400000',
          growthUtilization: 0,
        }}
      />,
    )
    expect(screen.queryByText('Full until January')).toBeNull()
    expect(screen.getByText('Full')).toBeTruthy()
  })
})
