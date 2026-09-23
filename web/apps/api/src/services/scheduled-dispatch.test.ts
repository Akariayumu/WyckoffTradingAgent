import { describe, expect, it, vi } from 'vitest'
import { dispatchScheduledWorkflow, SCHEDULED_WORKFLOWS } from './scheduled-dispatch'

const env = {
  GITHUB_DISPATCH_TOKEN: 'ghp_test',
  GITHUB_DISPATCH_REPO: 'owner/repo',
}
const cron = '* * * * *'

async function dispatchedAt(iso: string, configuredEnv = env) {
  const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
  await dispatchScheduledWorkflow(cron, Date.parse(iso), configuredEnv, fetchImpl)
  return (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => ({
    workflow: url.split('/').at(-2),
    body: JSON.parse(init.body as string),
  }))
}

describe('dispatchScheduledWorkflow', () => {
  it('covers every GitHub workflow previously scheduled by GitHub Actions', () => {
    expect(new Set(SCHEDULED_WORKFLOWS.map(({ workflow }) => workflow)).size).toBe(22)
  })

  it.each([
    ['2026-09-23T00:20:00Z', 'premarket_risk.yml'],
    ['2026-09-26T01:40:00Z', 'regime_forward_eval.yml'],
    ['2026-09-26T02:40:00Z', 'gate_alpha_eval.yml'],
    ['2026-09-26T02:55:00Z', 'ranker_weight_eval.yml'],
    ['2026-09-26T03:35:00Z', 'trigger_weight_eval.yml'],
    ['2026-09-26T03:40:00Z', 'momentum_regime_eval.yml'],
    ['2026-09-26T05:10:00Z', 'factor_ic_eval.yml'],
    ['2026-09-23T08:05:00Z', 'nav_snapshot.yml'],
    ['2026-09-23T08:10:00Z', 'sector_continuity.yml'],
    ['2026-09-23T08:35:00Z', 'wyckoff_funnel_hk.yml'],
    ['2026-09-23T09:17:00Z', 'wyckoff_funnel.yml'],
    ['2026-09-27T09:17:00Z', 'wyckoff_funnel.yml'],
    ['2026-09-23T11:25:00Z', 'review_list_replay.yml'],
    ['2026-09-26T02:10:00Z', 'exit_attribution.yml'],
    ['2026-09-25T22:20:00Z', 'db_maintenance.yml'],
    ['2026-09-23T15:00:00Z', 'recommendation_tracking_reprice.yml'],
    ['2026-09-23T21:35:00Z', 'wyckoff_funnel_us.yml'],
    ['2026-10-06T14:10:00Z', 'pattern_forward_eval.yml'],
    ['2026-10-08T12:00:00Z', 'star_history.yml'],
    ['2026-09-23T19:30:00Z', 'artifact_cleanup.yml'],
  ])('dispatches %s to %s', async (time, workflow) => {
    expect((await dispatchedAt(time)).map((dispatch) => dispatch.workflow)).toContain(workflow)
  })

  it('preserves the scheduled inputs for the weekly radar and shadow backtest', async () => {
    expect(await dispatchedAt('2026-09-25T13:10:00Z')).toEqual([{
      workflow: 'theme_radar.yml', body: { ref: 'self-host', inputs: { with_news: 'true' } },
    }])
    expect(await dispatchedAt('2026-09-26T05:40:00Z')).toEqual([{
      workflow: 'review_shadow_backtest.yml',
      body: { ref: 'self-host', inputs: { max_artifacts: '40', snapshot_trading_days: '60' } },
    }])
  })

  it('keeps weekly reflection on Friday and manual runs only', async () => {
    expect(await dispatchedAt('2026-09-24T15:30:00Z')).toEqual([{
      workflow: 'signal_feedback.yml',
      body: { ref: 'self-host', inputs: { skip_weekly_reflection: 'true' } },
    }])
    expect(await dispatchedAt('2026-09-25T15:30:00Z')).toEqual([{
      workflow: 'signal_feedback.yml', body: { ref: 'self-host' },
    }])
  })

  it('uses the scheduled UTC date, including when invocation is delayed', async () => {
    expect(await dispatchedAt('2026-09-25T15:30:00Z')).toHaveLength(1)
    expect(await dispatchedAt('2026-09-26T15:30:00Z')).toHaveLength(0)
    expect(await dispatchedAt('2026-09-24T09:17:00Z')).toHaveLength(1)
    expect(await dispatchedAt('2026-09-25T09:17:00Z')).toHaveLength(0)
  })

  it('skips idle minutes and rejects missing credentials on due minutes', async () => {
    const fetchImpl = vi.fn()
    await dispatchScheduledWorkflow(cron, Date.parse('2026-09-23T08:06:00Z'), {}, fetchImpl)
    await expect(dispatchScheduledWorkflow(cron, Date.parse('2026-09-23T08:05:00Z'), {}, fetchImpl))
      .rejects.toThrow('GITHUB_DISPATCH_TOKEN')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws when GitHub rejects a dispatch', async () => {
    const fetchImpl = vi.fn(async () => new Response('Bad credentials', { status: 401 }))
    await expect(dispatchScheduledWorkflow(cron, Date.parse('2026-09-23T08:05:00Z'), env, fetchImpl))
      .rejects.toThrow('401')
  })
})
