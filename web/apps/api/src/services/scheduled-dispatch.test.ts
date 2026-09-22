import { describe, expect, it, vi } from 'vitest'
import { dispatchScheduledWorkflow } from './scheduled-dispatch'

const env = {
  GITHUB_DISPATCH_TOKEN: 'ghp_test',
  GITHUB_DISPATCH_REPO: 'owner/repo',
}

describe('dispatchScheduledWorkflow', () => {
  it('dispatches the mapped workflow on the configured ref', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    await dispatchScheduledWorkflow('17 9 * * SUN-THU', { ...env, GITHUB_DISPATCH_REF: 'main' }, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/wyckoff_funnel.yml/dispatches')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test')
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'main' })
  })

  it('defaults the ref to self-host', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    await dispatchScheduledWorkflow('17 9 * * SUN-THU', env, fetchImpl)

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'self-host' })
  })

  it('skips unknown crons and missing credentials without calling GitHub', async () => {
    const fetchImpl = vi.fn()

    await dispatchScheduledWorkflow('0 0 * * *', env, fetchImpl)
    await dispatchScheduledWorkflow('17 9 * * SUN-THU', {}, fetchImpl)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws when GitHub rejects the dispatch', async () => {
    const fetchImpl = vi.fn(async () => new Response('Bad credentials', { status: 401 }))

    await expect(dispatchScheduledWorkflow('17 9 * * SUN-THU', env, fetchImpl)).rejects.toThrow('401')
  })
})
