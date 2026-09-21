import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchValueSnapshotWithFetch, resolveProxyUpstream } from '@wyckoff/shared'

describe('resolveProxyUpstream', () => {
  const tushare = new URL('https://api.tushare.pro')

  it('leaves non-Tushare targets and unconfigured deployments untouched', () => {
    const tickflow = new URL('https://api.tickflow.org')
    expect(resolveProxyUpstream(tickflow, 'https://relay.example/')).toBe(tickflow)
    expect(resolveProxyUpstream(tushare, '')).toBe(tushare)
    expect(resolveProxyUpstream(tushare, undefined)).toBe(tushare)
  })

  it('redirects official Tushare requests to the configured https relay', () => {
    expect(resolveProxyUpstream(tushare, ' https://relay.example/ ')?.href).toBe('https://relay.example/')
  })

  it('rejects non-https or malformed relay configuration', () => {
    expect(resolveProxyUpstream(tushare, 'http://relay.example/')).toBeNull()
    expect(resolveProxyUpstream(tushare, 'not a url')).toBeNull()
  })
})

describe('Tushare value snapshot ordering', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the latest report period even when the upstream returns ascending rows', async () => {
    const fields = ['ts_code', 'end_date', 'ann_date', 'roe', 'grossprofit_margin']
    const items = [
      ['600519.SH', '19981231', '19990301', null, null],
      ['600519.SH', '20260630', '20260801', 17.1, 91.0],
      ['600519.SH', '20260630', '20260828', 17.9543, 91.3],
      ['600519.SH', '20251231', '20260320', 36.2, 91.9],
    ]
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const target = new Headers(init?.headers).get('X-Target-URL')
      if (target === 'https://api.tickflow.org') return new Response('{"code":"NO_FINANCIAL_PERMISSION"}', { status: 403 })
      return Response.json({ code: 0, data: { fields, items } })
    }) as unknown as typeof fetch

    const snapshot = await fetchValueSnapshotWithFetch(fetcher, '600519', { tickflow: 'tf-key', tushare: 'ts-token' })

    expect(snapshot.source).toBe('tushare')
    expect(snapshot.metrics?.period_end).toBe('2026-06-30')
    expect(snapshot.metrics?.roe).toBe(17.9543)
  })
})
