import type * as Router from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RankedTrades } from './RankedTrades'
import type { GalleryImage } from '~/lib/playbook/images'
import type { PositionRow, RankedTrade } from '~/server/playbook'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="#position" className={className}>
      {children}
    </a>
  ),
}))

const image = (id: string, phase: GalleryImage['phase']): GalleryImage => ({
  id,
  phase,
  timeframe: '1D',
  caption: '',
  width: 2000,
  height: 1000,
  url: `/api/images/${id}`,
  thumbUrl: `/api/images/${id}?size=thumb`,
})

const trade = (id: string, images: GalleryImage[] = []): RankedTrade => ({
  row: {
    id,
    kind: 'REAL',
    symbol: id,
    name: `Name ${id}`,
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    currency: 'JPY',
    status: 'CLOSED',
    openDate: '2026-09-01',
    closeDate: '2026-09-10',
    result: '1000.00',
    resultJpy: '1000',
    returnPct: 0.1,
    r: '1.50',
    overall: '7.5',
    provisional: false,
  } as PositionRow,
  legs: [{ side: 'ENTRY', date: '2026-09-01', rating: 9, note: 'bounced off the 20d' }],
  images,
})

const trades = {
  a: trade('a', [image('a-exit', 'EXIT'), image('a-entry', 'ENTRY')]),
  b: trade('b', [image('b-entry', 'ENTRY')]),
}

afterEach(cleanup)

describe('RankedTrades', () => {
  it('shows one list under ten, with each trade’s charts and notes', () => {
    render(<RankedTrades ranking={{ list: { single: ['a', 'b'] }, unranked: 0 }} byR={false} trades={trades} />)
    expect(screen.queryByRole('heading', { name: 'Ranked by overall score' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Best 5' })).toBeNull()
    expect(screen.getAllByText('bounced off the 20d')).toHaveLength(2)
    expect(screen.getAllByText('Entry 9')).toHaveLength(2)
  })

  it('shows best and worst apart from ten on', () => {
    render(<RankedTrades ranking={{ list: { best: ['a'], worst: ['b'] }, unranked: 0 }} byR={false} trades={trades} />)
    expect(screen.queryByRole('heading', { name: 'Best 5' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Worst 5' })).not.toBeNull()
  })

  it('says how many closed positions the ranking leaves out', () => {
    render(<RankedTrades ranking={{ list: { single: ['a'] }, unranked: 2 }} byR trades={trades} />)
    expect(screen.queryByText(/2 closed positions have no R/)).not.toBeNull()
  })

  it('says why a ranking by R is empty, rather than that nothing has closed', () => {
    render(<RankedTrades ranking={{ list: { single: [] }, unranked: 3 }} byR trades={trades} />)
    expect(screen.queryByText(/None of its 3 closed positions has an R/)).not.toBeNull()
  })

  it('walks only that trade’s images in the lightbox, entry before exit', async () => {
    const user = userEvent.setup()
    render(<RankedTrades ranking={{ list: { single: ['a', 'b'] }, unranked: 0 }} byR={false} trades={trades} />)
    await user.click(screen.getAllByRole('button', { name: /Open Entry · 1D chart/ })[0]!)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('1 of 2')).not.toBeNull()
    await user.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/api/images/a-exit')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
