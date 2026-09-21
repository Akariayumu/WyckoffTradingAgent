import { supabase } from './supabase'
import { isPlanetMembershipActive } from '@wyckoff/shared'

export { isPlanetMembershipActive, planetMembershipToday } from '@wyckoff/shared'

export interface PlanetMembership {
  isActive: boolean
  expiresOn: string | null
  joinedAt: string | null
}

/** 自部署开关：VITE_MEMBERSHIP_MODE=off 时所有登录用户视为会员（需与 Worker 的 MEMBERSHIP_MODE 一致）。 */
export function planetMembershipDisabled(mode: unknown = import.meta.env.VITE_MEMBERSHIP_MODE): boolean {
  return String(mode ?? '').trim().toLowerCase() === 'off'
}

export async function getPlanetMembership(userId: string): Promise<PlanetMembership> {
  if (planetMembershipDisabled()) return { isActive: true, expiresOn: null, joinedAt: null }
  const { data, error } = await supabase
    .from('planet_members')
    .select('created_at, expires_on')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`会员状态读取失败：${error.message}`)
  if (!data) return { isActive: false, expiresOn: null, joinedAt: null }
  return {
    isActive: isPlanetMembershipActive(data.expires_on),
    expiresOn: typeof data.expires_on === 'string' ? data.expires_on : null,
    joinedAt: typeof data.created_at === 'string' ? data.created_at : null,
  }
}
