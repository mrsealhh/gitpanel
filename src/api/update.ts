export const APP_VERSION = '0.4.1'
export const REPO_URL = 'https://github.com/mrsealhh/gitpanel'
export const RELEASES_URL = `${REPO_URL}/releases`

export interface UpdateInfo {
  latest: string
  url: string
  notes: string
  newer: boolean
}

/** 语义化版本比较：a > b 返回正数 */
function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 检查 GitHub Releases 是否有新版本。
 * 未认证请求受 GitHub 限流（60 次/小时），只应在启动时或手动点击时调用。
 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/mrsealhh/gitpanel/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string }
    const latest = String(data.tag_name || '').replace(/^v/i, '')
    if (!latest) return null
    return {
      latest,
      url: data.html_url || RELEASES_URL,
      notes: (data.body || '').slice(0, 500),
      newer: compareVersion(latest, APP_VERSION) > 0,
    }
  } catch {
    return null
  }
}
