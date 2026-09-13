import { describe, expect, it } from 'vitest'
import { offlinePageHtml } from './offlinePage'

describe('offlinePageHtml', () => {
  it('references nothing it would need the network to load', () => {
    const html = offlinePageHtml()
    expect(html).not.toMatch(/https?:/)
    expect(html).not.toMatch(/\ssrc=/)
    expect(html).not.toMatch(/<link\b/)
  })

  it('says the screen was not saved, rather than that something broke', () => {
    expect(offlinePageHtml()).toContain('hasn’t been saved on this device yet')
  })
})
