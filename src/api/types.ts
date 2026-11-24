// 前后端共享的数据契约（唯一真源）
// 与 crates/git-core/src/model.rs 一一对应

export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

export interface RefBadge {
  name: string
  kind: RefKind
}

/** 行内线段：x 为泳道下标，y 为行内相对位置（0=顶, 0.5=节点, 1=底） */
export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  /** true = 贝塞尔曲线（合并/分叉），false = 直线 */
  curve: boolean
  color: number
}

export interface CommitRow {
  oid: string
  short: string
  parents: string[]
  lane: number
  color: number
  author: string
  email: string
  /** unix 秒 */
  time: number
  refs: RefBadge[]
  summary: string
  segments: Segment[]
}

export interface GraphPage {
  rows: CommitRow[]
  nextOffset: number
  done: boolean
  laneCount: number
  total: number
}

export interface RepoRef extends RefBadge {
  oid: string
}

export interface RepoInfo {
  path: string
  name: string
  branch: string
  headOid: string
  refs: RepoRef[]
}

export interface ChangedFile {
  path: string
  additions: number
  deletions: number
  status: string
}

export interface CommitDetail {
  oid: string
  short: string
  author: string
  email: string
  time: number
  parents: string[]
  refs: RefBadge[]
  summary: string
  body: string
  files: ChangedFile[]
  additions: number
  deletions: number
}

/** 单个文件的「父版本 / 当前版本」全文，用于并排合并视图 */
export interface FileDiff {
  path: string
  oldText: string
  newText: string
  isBinary: boolean
  truncated: boolean
}

/** 插件/自定义命令（来自 .gitpanel/commands.json） */
export interface PluginCommand {
  id: string
  title: string
  description?: string
  /** repo = 仓库级配置，user = 用户级配置 */
  source: string
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface RemoteInfo {
  name: string
  url: string
  /** 可点击的网页地址，如 https://github.com/owner/repo */
  web?: string
}
