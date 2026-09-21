import { describe, expect, it } from 'vitest'
import { allowedOrigins, createApiApp } from './app'

describe('self-host CORS origins', () => {
  it('appends comma-separated CORS_ALLOWED_ORIGINS to the defaults', () => {
    const origins = allowedOrigins({ CORS_ALLOWED_ORIGINS: ' https://my.pages.dev/ ,https://wkf.example.com,, ' })
    expect(origins).toContain('https://wyckoff-analysis.pages.dev')
    expect(origins).toContain('https://my.pages.dev')
    expect(origins).toContain('https://wkf.example.com')
    expect(origins).not.toContain('')
  })

  it('reflects configured origins and rejects unknown ones', async () => {
    const app = createApiApp()
    const env = { CORS_ALLOWED_ORIGINS: 'https://my.pages.dev' }
    const allowed = await app.request('/api/health', { headers: { Origin: 'https://my.pages.dev' } }, env)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://my.pages.dev')
    const denied = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } }, env)
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
