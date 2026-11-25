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
  /** true 表示还有没取完的行（配合 hasMore） */
  truncated: boolean
  oldTotalLines: number
  newTotalLines: number
  /** 本次返回的起始行（0 基） */
  oldFrom: number
  newFrom: number
  hasMore: boolean
  oldBytes: number
  newBytes: number
}

/** cherry-pick / revert 的进行中状态 */
export interface SequenceStatus {
  /** '' / 'cherry-pick' / 'revert' */
  kind: string
  inProgress: boolean
  conflicted: StatusFile[]
  pending: number
}

/** 项目内的一个文件 / 目录（文件面板用） */
export interface FsEntry {
  name: string
  /** 相对仓库根的路径，统一用 / */
  path: string
  isDir: boolean
  size: number
}

/** 读到的文本文件（编辑用） */
export interface FileText {
  file: string
  content: string
  size: number
  isBinary: boolean
  truncated: boolean
  /** utf8 / utf8bom / other（other 只读，避免写回改坏编码） */
  encoding: string
  editable: boolean
  lines: number
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

/* ── 工作区 ── */

export interface StatusFile {
  path: string
  status: string
  origPath?: string
}

export interface WorktreeStatus {
  branch: string
  oid: string
  ahead: number
  behind: number
  staged: StatusFile[]
  unstaged: StatusFile[]
  untracked: StatusFile[]
  conflicted: StatusFile[]
  clean: boolean
}

export interface Snapshot {
  ref: string
  label: string
  oid: string
  short: string
  time: number
  subject: string
}

export interface SyncResult {
  ok: boolean
  output: string
  snapshot?: string | null
}

/* ── 冲突 ── */

export interface ConflictBlock {
  type: 'text' | 'conflict'
  text?: string
  ours?: string
  theirs?: string
  base?: string | null
  oursLabel?: string
  theirsLabel?: string
}

export interface ConflictDetail {
  path: string
  base: string
  ours: string
  theirs: string
  working: string
  hasMarkers: boolean
  blocks: ConflictBlock[]
}

/* ── 暂存 / 标签 / reflog ── */

export interface Stash {
  index: number
  ref: string
  time: number
  message: string
}

export interface StashDiff {
  ref: string
  files: { path: string; additions: number; deletions: number }[]
  patch: string
}

export interface TagInfo {
  name: string
  annotated: boolean
  time: number
  subject: string
  oid: string
}

export interface ReflogEntry {
  oid: string
  short: string
  selector: string
  time: number
  action: string
}

export interface MergeResult {
  ok: boolean
  conflicts: boolean
  output: string
  snapshot?: string | null
  conflicted?: StatusFile[]
}

/* ── 交互式 rebase ── */

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface RebaseCommit {
  oid: string
  short: string
  subject: string
  author: string
  time: number
}

export interface RebaseStep {
  oid: string
  action: RebaseAction
  subject?: string
}

export interface RebaseOutcome {
  ok: boolean
  conflicts: boolean
  output: string
  snapshot?: string | null
}

export interface RebaseStatus {
  inProgress: boolean
  stopped: boolean
  subject: string
  conflicts: boolean
  conflicted: StatusFile[]
}

/* ── 工作树 ── */

export interface WorktreeInfo {
  path: string
  head: string
  short: string
  branch: string
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
  isCurrent: boolean
  exists: boolean
  dirty: number
  ahead: number
  behind: number
  lastCommit: number
  aiHints: string[]
  merged: boolean
}

/* ── 文件历史 / Blame / 体检 ── */
export interface FileHistoryEntry {
  oid: string
  short: string
  subject: string
  author: string
  time: number
}

export interface BlameLine {
  line: number
  oid: string
  short: string
  author: string
  time: number
  content: string
}

export interface LargeObject {
  oid: string
  short: string
  size: number
}

export interface RepoHealth {
  gitSize: number
  packSize: number
  packCount: number
  looseObjects: number
  inPack: number
  garbage: number
  commits: number
  branches: number
  tags: number
  files: number
  largeObjects: LargeObject[]
  suggestions: string[]
}

/* ── 工作树元数据 / 多仓库看板 ── */

export interface WorktreeMeta {
  agent: string
  note: string
  task: string
  createdAt: number
  lastUsedAt: number
}

export interface RepoOverview {
  path: string
  name: string
  exists: boolean
  branch: string
  ahead: number
  behind: number
  dirty: number
  lastCommit: number
  worktrees: number
  error?: string | null
}
