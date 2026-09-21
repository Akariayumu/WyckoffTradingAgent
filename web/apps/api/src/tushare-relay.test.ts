import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../../functions/api/llm-proxy/[[path]]'
import { createToolFetch } from './routes/chat'

const TUSHARE_BODY = JSON.stringify({ api_name: 'daily', token: 't', params: {}, fields: '' })

function mockUpstream() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ code: 0, data: { fields: [], items: [] } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function proxyContext(env: Record<string, string>, target = 'https://api.tushare.pro') {
  const request = new Request('https://wyckoff.pages.dev/api/llm-proxy/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Target-URL': target, Origin: 'https://wyckoff.pages.dev' },
    body: TUSHARE_BODY,
  })
  return { request, env } as unknown as Parameters<typeof onRequest>[0]
}

afterEach(() => vi.unstubAllGlobals())

describe('Pages llm-proxy Tushare relay', () => {
  it('forwards Tushare requests to TUSHARE_API_URL when configured', async () => {
    const fetchMock = mockUpstream()
    const response = await onRequest(proxyContext({ TUSHARE_API_URL: 'https://relay.example/' }))
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://relay.example/')
  })

  it('keeps the official endpoint when no relay is configured', async () => {
    const fetchMock = mockUpstream()
    await onRequest(proxyContext({}))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.tushare.pro/')
  })

  it('does not reroute other providers and rejects an unsafe relay setting', async () => {
    const fetchMock = mockUpstream()
    await onRequest(proxyContext({ TUSHARE_API_URL: 'https://relay.example/' }, 'https://api.tickflow.org'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.tickflow.org/')

    const rejected = await onRequest(proxyContext({ TUSHARE_API_URL: 'http://relay.example/' }))
    expect(rejected.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Worker reading-room tool fetch Tushare relay', () => {
  const init = { method: 'POST', headers: { 'X-Target-URL': 'https://api.tushare.pro' }, body: TUSHARE_BODY }

  it('uses the same relay rule as the Pages proxy', async () => {
    const fetchMock = mockUpstream()
    await createToolFetch({ TUSHARE_API_URL: 'https://relay.example/' })('/api/llm-proxy/', init)
    await createToolFetch({})('/api/llm-proxy/', init)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['https://relay.example/', 'https://api.tushare.pro/'])
  })

  it('refuses to forward with an unsafe relay setting', async () => {
    const fetchMock = mockUpstream()
    const response = await createToolFetch({ TUSHARE_API_URL: 'ftp://relay.example/' })('/api/llm-proxy/', init)
    expect(response.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
