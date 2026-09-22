import type { Env } from '../app'

// GitHub Actions 的 schedule 在自部署仓库上常晚 4~7 小时，改由 Worker Cron 准点发起
// workflow_dispatch。键必须与 wrangler.toml [triggers].crons 逐字一致（UTC）。
export const SCHEDULED_WORKFLOWS: Record<string, string> = {
  // 北京时间周日到周四 17:17，与 wyckoff_funnel.yml 原 schedule 一致。
  '17 9 * * SUN-THU': 'wyckoff_funnel.yml',
  // 北京时间工作日 08:20：premarket_risk.yml 的设计主路径就是外部 dispatch，schedule 只带 --backstop 兜底。
  '20 0 * * MON-FRI': 'premarket_risk.yml',
}

const DEFAULT_REF = 'self-host'

export async function dispatchScheduledWorkflow(
  cron: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const workflow = SCHEDULED_WORKFLOWS[cron]
  if (!workflow) {
    console.warn(`[scheduled-dispatch] 未登记的 cron：${cron}`)
    return
  }
  const token = env.GITHUB_DISPATCH_TOKEN?.trim()
  const repo = env.GITHUB_DISPATCH_REPO?.trim()
  if (!token || !repo) {
    console.warn('[scheduled-dispatch] 未配置 GITHUB_DISPATCH_TOKEN / GITHUB_DISPATCH_REPO，跳过')
    return
  }
  const ref = env.GITHUB_DISPATCH_REF?.trim() || DEFAULT_REF
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
      body: JSON.stringify({ ref }),
    },
  )
  if (!response.ok) {
    // 抛出让 Cron 记为失败，在 Workers Logs 里可见；GitHub 侧的 schedule 仍会兜底。
    throw new Error(`[scheduled-dispatch] ${workflow} 触发失败：${response.status} ${await response.text()}`)
  }
  console.info(`[scheduled-dispatch] 已触发 ${repo}/${workflow}@${ref}`)
}
