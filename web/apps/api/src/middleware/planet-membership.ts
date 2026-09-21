import { createMiddleware } from 'hono/factory'
import { isPlanetMembershipActive } from '@wyckoff/shared'
import type { Env } from '../app'
import { createUserSupabase, type AuthContext } from './auth'

export const planetMemberMiddleware = createMiddleware<{
  Bindings: Env
  Variables: { auth: AuthContext }
}>(async (c, next) => {
  const auth = c.get('auth')
  const supabase = createUserSupabase(c.env, auth.accessToken)
  if (!(await isActivePlanetMember(supabase, auth.userId, c.env))) {
    return c.json({ error: 'Planet membership required' }, 403)
  }
  await next()
})

export async function isActivePlanetMember(
  supabase: ReturnType<typeof createUserSupabase>,
  userId: string,
  env: Pick<Env, 'MEMBERSHIP_MODE'>,
): Promise<boolean> {
  // 自部署开关：off 时所有已登录用户视为会员，不再查询 planet_members。
  if (membershipDisabled(env)) return true
  const { data, error } = await supabase
    .from('planet_members')
    .select('expires_on')
    .eq('user_id', userId)
    .limit(1)
  if (error || !Array.isArray(data)) return false
  return data.some((row) => isPlanetMembershipActive(row.expires_on))
}

export function membershipDisabled(env: Pick<Env, 'MEMBERSHIP_MODE'>): boolean {
  return env.MEMBERSHIP_MODE?.trim().toLowerCase() === 'off'
}
