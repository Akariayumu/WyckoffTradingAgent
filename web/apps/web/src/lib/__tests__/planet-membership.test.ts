import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPlanetMembership, isPlanetMembershipActive, planetMembershipDisabled, planetMembershipToday } from '../planet-membership'

const from = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { from } }))

describe('planet membership expiry', () => {
  it('treats null and blank expiry as permanent', () => {
    expect(isPlanetMembershipActive(null, '2026-06-30')).toBe(true)
    expect(isPlanetMembershipActive('', '2026-06-30')).toBe(true)
    expect(isPlanetMembershipActive('   ', '2026-06-30')).toBe(true)
  })

  it('keeps membership active through its expiry date', () => {
    expect(isPlanetMembershipActive('2026-06-30', '2026-06-30')).toBe(true)
    expect(isPlanetMembershipActive('2026-07-01', '2026-06-30')).toBe(true)
  })

  it('rejects expired or malformed expiry values', () => {
    expect(isPlanetMembershipActive('2026-06-29', '2026-06-30')).toBe(false)
    expect(isPlanetMembershipActive('20260630', '2026-06-30')).toBe(false)
    expect(isPlanetMembershipActive('2026-13-01', '2026-06-30')).toBe(false)
    expect(isPlanetMembershipActive('2026-02-30', '2026-06-30')).toBe(false)
  })

  it('uses the Asia/Shanghai calendar day on both sides of midnight', () => {
    expect(planetMembershipToday(new Date('2026-06-30T15:59:59Z'))).toBe('2026-06-30')
    expect(planetMembershipToday(new Date('2026-06-30T16:00:00Z'))).toBe('2026-07-01')
  })
})

describe('self-host membership switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    from.mockReset()
  })

  it('only disables membership for an explicit off value', () => {
    expect(planetMembershipDisabled('off')).toBe(true)
    expect(planetMembershipDisabled(' OFF ')).toBe(true)
    for (const mode of [undefined, null, '', 'on', 'false', '0']) expect(planetMembershipDisabled(mode)).toBe(false)
  })

  it('grants membership without querying planet_members when VITE_MEMBERSHIP_MODE=off', async () => {
    vi.stubEnv('VITE_MEMBERSHIP_MODE', 'off')
    await expect(getPlanetMembership('user-1')).resolves.toEqual({ isActive: true, expiresOn: null, joinedAt: null })
    expect(from).not.toHaveBeenCalled()
  })

  it('still queries planet_members when the switch is not off', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) })
    await expect(getPlanetMembership('user-1')).resolves.toMatchObject({ isActive: false })
    expect(from).toHaveBeenCalledWith('planet_members')
  })
})
