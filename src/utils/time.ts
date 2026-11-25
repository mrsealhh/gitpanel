export function relativeTime(unix: number): string {
  if (!unix) return ''
  const diff = Date.now() / 1000 - unix
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} days ago`
  return formatDate(unix)
}

/** 系统内统一日期格式：yyyy-MM-dd HH:mm（本地时区） */
export function formatDate(unix: number): string {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
