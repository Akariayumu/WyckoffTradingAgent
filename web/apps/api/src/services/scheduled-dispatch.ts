import type { Env } from '../app'

type ScheduledWorkflow = {
  workflow: string
  hour: number
  minute: number
  weekdays?: readonly number[]
  day?: number
  inputs?: Record<string, string>
}

const WEEKDAYS = [1, 2, 3, 4, 5]
const SATURDAY = [6]
const FRIDAY = [5]
const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4]
const MONDAY_TO_THURSDAY = [1, 2, 3, 4]

// All times and weekdays are UTC. One minute-level Cron stays within the Free plan limit.
export const SCHEDULED_WORKFLOWS: readonly ScheduledWorkflow[] = [
  { workflow: 'premarket_risk.yml', hour: 0, minute: 20, weekdays: WEEKDAYS },
  { workflow: 'regime_forward_eval.yml', hour: 1, minute: 40, weekdays: SATURDAY },
  { workflow: 'exit_attribution.yml', hour: 2, minute: 10, weekdays: SATURDAY },
  { workflow: 'db_maintenance.yml', hour: 22, minute: 20, weekdays: FRIDAY },
  { workflow: 'gate_alpha_eval.yml', hour: 2, minute: 40, weekdays: SATURDAY },
  { workflow: 'ranker_weight_eval.yml', hour: 2, minute: 55, weekdays: SATURDAY },
  { workflow: 'trigger_weight_eval.yml', hour: 3, minute: 35, weekdays: SATURDAY },
  { workflow: 'momentum_regime_eval.yml', hour: 3, minute: 40, weekdays: SATURDAY },
  { workflow: 'factor_ic_eval.yml', hour: 5, minute: 10, weekdays: SATURDAY },
  {
    workflow: 'review_shadow_backtest.yml', hour: 5, minute: 40, weekdays: SATURDAY,
    inputs: { max_artifacts: '40', snapshot_trading_days: '60' },
  },
  { workflow: 'nav_snapshot.yml', hour: 8, minute: 5, weekdays: WEEKDAYS },
  { workflow: 'sector_continuity.yml', hour: 8, minute: 10, weekdays: WEEKDAYS },
  { workflow: 'wyckoff_funnel_hk.yml', hour: 8, minute: 35, weekdays: WEEKDAYS },
  { workflow: 'wyckoff_funnel.yml', hour: 9, minute: 17, weekdays: SUNDAY_TO_THURSDAY },
  { workflow: 'review_list_replay.yml', hour: 11, minute: 25, weekdays: WEEKDAYS },
  { workflow: 'star_history.yml', hour: 12, minute: 0, day: 8 },
  { workflow: 'theme_radar.yml', hour: 13, minute: 10, weekdays: FRIDAY, inputs: { with_news: 'true' } },
  { workflow: 'pattern_forward_eval.yml', hour: 14, minute: 10, day: 6 },
  {
    workflow: 'signal_feedback.yml', hour: 15, minute: 30, weekdays: MONDAY_TO_THURSDAY,
    inputs: { skip_weekly_reflection: 'true' },
  },
  { workflow: 'signal_feedback.yml', hour: 15, minute: 30, weekdays: FRIDAY },
  { workflow: 'recommendation_tracking_reprice.yml', hour: 15, minute: 0, weekdays: WEEKDAYS },
  { workflow: 'artifact_cleanup.yml', hour: 19, minute: 30 },
  { workflow: 'wyckoff_funnel_us.yml', hour: 21, minute: 35, weekdays: WEEKDAYS },
]

const DEFAULT_REF = 'self-host'
const WORKER_CRON = '* * * * *'

export async function dispatchScheduledWorkflow(
  cron: string,
  scheduledTime: number,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (cron !== WORKER_CRON) {
    console.warn(`[scheduled-dispatch] 未登记的 cron：${cron}`)
    return
  }
  const date = new Date(scheduledTime)
  const workflows = SCHEDULED_WORKFLOWS.filter(
    ({ hour, minute, weekdays, day }) =>
      date.getUTCHours() === hour && date.getUTCMinutes() === minute &&
      (!weekdays || weekdays.includes(date.getUTCDay())) &&
      (!day || date.getUTCDate() === day),
  )
  if (workflows.length === 0) return

  const token = env.GITHUB_DISPATCH_TOKEN?.trim()
  const repo = env.GITHUB_DISPATCH_REPO?.trim()
  if (!token || !repo) {
    throw new Error('[scheduled-dispatch] 未配置 GITHUB_DISPATCH_TOKEN / GITHUB_DISPATCH_REPO')
  }
  const ref = env.GITHUB_DISPATCH_REF?.trim() || DEFAULT_REF
  for (const { workflow, inputs } of workflows) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'wyckoff-api-cron',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref, ...(inputs ? { inputs } : {}) }),
      },
    )
    if (!response.ok) {
      throw new Error(`[scheduled-dispatch] ${workflow} 触发失败：${response.status} ${await response.text()}`)
    }
    console.info(`[scheduled-dispatch] 已触发 ${repo}/${workflow}@${ref}`)
  }
}
