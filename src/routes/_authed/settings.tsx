import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import styles from './settings.module.scss'
import { ASSET_LABEL } from '~/components/format'
import { InstrumentLink } from '~/components/InstrumentLink'
import { Empty, PageHeader, Section, Table } from '~/components/Screen'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import type { ProviderState } from '~/lib/prices/providers'
import { checkProviders, listPrices, refreshPrices, setManualPrice } from '~/server/prices'

export const Route = createFileRoute('/_authed/settings')({
  component: Settings,
})

const STATE_LABEL: Record<ProviderState, string> = {
  OK: 'Working',
  NO_KEY: 'No API key',
  BAD_KEY: 'Key rejected',
  RATE_LIMITED: 'Quota exhausted',
  UNREACHABLE: 'Unreachable',
}

function Settings() {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const { data: prices = [], isPending } = useQuery({
    queryKey: ['prices'],
    queryFn: () => listPrices(),
  })

  const refresh = useMutation({
    mutationFn: () => refreshPrices(),
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })

  const check = useMutation({
    mutationFn: () => checkProviders(),
  })

  const save = useMutation({
    mutationFn: (override: { symbol: string; price: string | null }) =>
      setManualPrice({ data: override }),
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })

  const unpriced = prices.filter((entry) => entry.price == null && entry.manualOverride == null)

  return (
    <>
      <PageHeader
        title="Settings"
        meta="Prices are fetched on visit, never on a schedule — the Finnhub free tier is quota-limited."
      >
        <button
          type="button"
          className={styles.primary}
          disabled={refresh.isPending}
          onClick={() => {
            refresh.mutate()
          }}
        >
          {refresh.isPending ? 'Refreshing…' : 'Refresh prices'}
        </button>
      </PageHeader>

      {refresh.data ? (
        <p className={styles.status}>
          Tried {refresh.data.attempted} · updated {refresh.data.updated} · failed{' '}
          {refresh.data.failed}
          {refresh.data.noSource > 0 ? (
            <span title="Funds are named, not coded, in every Rakuten export, and no free source publishes 基準価額 by name. These are skipped rather than attempted — not a failure.">
              {' · '}
              {refresh.data.noSource} with no source
            </span>
          ) : null}
          {refresh.data.fxUpdated ? ' · USD/JPY updated' : ''}
        </p>
      ) : null}

      <Section
        title="Prices"
        description="Finnhub covers US equities on the free tier. JP equities use a best-effort source that often fails, and funds have none — so those need a manual price."
      >
        {isPending ? (
          <Empty>Loading…</Empty>
        ) : prices.length === 0 ? (
          <Empty>No open positions to price.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Instrument</th>
                <th scope="col">Class</th>
                <th scope="col" data-numeric>Current</th>
                <th scope="col">Source</th>
                <th scope="col">As of</th>
                <th scope="col">Manual override</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((entry) => {
                const draft = drafts[entry.symbol] ?? entry.manualOverride ?? ''
                return (
                  <tr key={entry.symbol}>
                    <td>
                      <InstrumentLink symbol={entry.symbol} name={entry.name} assetClass={entry.assetClass} />
                    </td>
                    <td>{ASSET_LABEL[entry.assetClass] ?? entry.assetClass}</td>
                    <td data-numeric>
                      {entry.price == null
                        ? '—'
                        : entry.currency === 'USD'
                          ? `$${Number(entry.price).toFixed(2)}`
                          : `¥${Number(entry.price).toLocaleString('en-US')}`}
                    </td>
                    <td>
                      {entry.source ? (
                        <span className={cx(styles.tag, entry.source === 'MANUAL' && styles.tagManual)}>
                          {entry.source}
                        </span>
                      ) : (
                        <span className={styles.tagMissing}>none</span>
                      )}
                    </td>
                    <td className={styles.dim}>
                      {entry.asOf ? new Date(entry.asOf).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <div className={styles.overrideCell}>
                        <input
                          inputMode="decimal"
                          className={styles.input}
                          value={draft}
                          placeholder={entry.needsManual ? 'set price' : 'auto'}
                          onChange={(event) => {
                            setDrafts((previous) => ({ ...previous, [entry.symbol]: event.target.value }))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              save.mutate({ symbol: entry.symbol, price: draft || null })
                            }
                          }}
                          aria-label={`Manual price for ${entry.symbol}`}
                        />
                        <button
                          type="button"
                          className={styles.small}
                          onClick={() => {
                            save.mutate({ symbol: entry.symbol, price: draft || null })
                          }}
                        >
                          Save
                        </button>
                        {entry.manualOverride ? (
                          <ConfirmButton
                            confirmLabel="Clear?"
                            onConfirm={() => {
                              setDrafts((previous) => ({ ...previous, [entry.symbol]: '' }))
                              save.mutate({ symbol: entry.symbol, price: null })
                            }}
                          >
                            Clear
                          </ConfirmButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}

        {unpriced.length > 0 ? (
          <p className={styles.note}>
            {unpriced.length} position{unpriced.length === 1 ? '' : 's'} have no price at all, so
            they show no market value or unrealized P&L anywhere in the app. Entering a manual price
            fixes that — a manual value always wins over a fetched one.
          </p>
        ) : null}
      </Section>

      <Section
        title="Data sources"
        description="Check tests each source live. Nothing here is cached — it reflects the state right now."
      >
        <div className={styles.checkBar}>
          <button
            type="button"
            className={styles.small}
            disabled={check.isPending}
            onClick={() => {
              check.mutate()
            }}
          >
            {check.isPending ? 'Checking…' : 'Check connections'}
          </button>
          {check.isError ? (
            <span className={styles.tagMissing}>Check failed to run.</span>
          ) : null}
        </div>

        {check.data ? (
          <ul className={styles.checks}>
            {check.data.map((check) => (
              <li key={check.provider} className={styles.checkRow}>
                <span className={cx(styles.dot, styles[`dot${check.state}`])} aria-hidden="true" />
                <strong className={styles.checkName}>{check.provider}</strong>
                <span className={styles.checkState}>{STATE_LABEL[check.state]}</span>
                <span className={styles.checkDetail}>{check.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className={styles.info}>
          <dl>
            <dt>US equities</dt>
            <dd>Finnhub free tier — 60 calls/minute, US only.</dd>
            <dt>JP equities</dt>
            <dd>Best-effort; blocked frequently. Manual entry is the reliable path.</dd>
            <dt>Funds</dt>
            <dd>No free source for 基準価額. Manual entry only.</dd>
            <dt>USD/JPY</dt>
            <dd>open.er-api.com — free, no key, updated daily.</dd>
            <dt>US dividends</dt>
            <dd>
              Not in the trade-history or 取引残高報告書 exports. Rakuten publishes them in a
              separate 外国株式配当金計算書.
            </dd>
          </dl>
        </div>
      </Section>
    </>
  )
}
