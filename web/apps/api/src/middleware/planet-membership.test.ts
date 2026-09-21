import { describe, expect, it, vi } from 'vitest'
import { isActivePlanetMember } from './planet-membership'

describe('planet membership middleware lookup', () => {
  it('reads the planet_members contract and accepts an active member', async () => {
    const query = mockQuery({ data: [{ expires_on: '2999-12-31' }], error: null })

    await expect(isActivePlanetMember(query.client as never, 'user-1', {})).resolves.toBe(true)
    expect(query.from).toHaveBeenCalledWith('planet_members')
    expect(query.select).toHaveBeenCalledWith('expires_on')
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('fails closed for missing, expired, malformed, or failed lookups', async () => {
    const cases = [
      { data: [], error: null },
      { data: [{ expires_on: '2000-01-01' }], error: null },
      { data: [{ expires_on: '29991231' }], error: null },
      { data: [{ expires_on: '2999-99-99' }], error: null },
      { data: null, error: { message: 'denied' } },
    ]
    for (const result of cases) {
      await expect(isActivePlanetMember(mockQuery(result).client as never, 'user-1', {})).resolves.toBe(false)
    }
  })

  it('treats every signed-in user as a member without querying when MEMBERSHIP_MODE=off', async () => {
    for (const mode of ['off', ' OFF ']) {
      const query = mockQuery({ data: [], error: null })
      await expect(isActivePlanetMember(query.client as never, 'user-1', { MEMBERSHIP_MODE: mode })).resolves.toBe(true)
      expect(query.from).not.toHaveBeenCalled()
    }
  })

  it('keeps enforcing membership for any other MEMBERSHIP_MODE value', async () => {
    for (const mode of [undefined, '', 'on', 'false', '0']) {
      const query = mockQuery({ data: [], error: null })
      await expect(isActivePlanetMember(query.client as never, 'user-1', { MEMBERSHIP_MODE: mode })).resolves.toBe(false)
      expect(query.from).toHaveBeenCalledWith('planet_members')
    }
  })
})

function mockQuery(result: { data: unknown; error: unknown }) {
  const from = vi.fn()
  const select = vi.fn()
  const eq = vi.fn()
  const limit = vi.fn().mockResolvedValue(result)
  const client = { from }
  from.mockReturnValue({ select })
  select.mockReturnValue({ eq })
  eq.mockReturnValue({ limit })
  return { client, from, select, eq }
}
