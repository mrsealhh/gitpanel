import type { RepoRef } from '../api/types'

/** 分支树的节点（按 / 分段，feature/a/b → feature > a > b） */
export interface TreeNode {
  /** 当前层级名字（单段） */
  seg: string
  /** 完整路径，例如 feature/a/b */
  path: string
  /** 该节点本身是不是一个真实的分支 / 标签 */
  ref?: RepoRef
  /** 挂在这个本地分支下的远端跟踪分支 */
  upstreams: RepoRef[]
  children: TreeNode[]
}

interface Item {
  name: string
  ref: RepoRef
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => a.seg.localeCompare(b.seg))
  for (const n of nodes) sortTree(n.children)
}

/** 把一串带 / 的引用名建成树 */
export function buildBranchTree(items: Item[], upstreams?: (name: string) => RepoRef[]): TreeNode[] {
  const roots: TreeNode[] = []
  for (const item of items) {
    const segs = item.name.split('/').filter(Boolean)
    let level = roots
    let acc = ''
    segs.forEach((seg, i) => {
      acc = acc ? `${acc}/${seg}` : seg
      let node = level.find((n) => n.seg === seg)
      if (!node) {
        node = { seg, path: acc, upstreams: [], children: [] }
        level.push(node)
      }
      if (i === segs.length - 1) {
        node.ref = item.ref
        node.upstreams = upstreams ? upstreams(item.name) : []
      }
      level = node.children
    })
  }
  sortTree(roots)
  return roots
}

/** 拍平成要渲染的行，顺手处理折叠 */
export interface FlatRow {
  node: TreeNode
  depth: number
  expanded: boolean
  hasChildren: boolean
}

export function flattenTree(
  nodes: TreeNode[],
  collapsed: Set<string>,
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    const expanded = hasChildren && !collapsed.has(node.path)
    out.push({ node, depth, expanded, hasChildren })
    if (expanded) flattenTree(node.children, collapsed, depth + 1, out)
  }
  return out
}

/** 过滤：保留命中节点及其祖先链 */
export function filterTree(nodes: TreeNode[], kw: string): TreeNode[] {
  const k = kw.toLowerCase()
  const walk = (list: TreeNode[]): TreeNode[] => {
    const kept: TreeNode[] = []
    for (const node of list) {
      const kids = walk(node.children)
      const hit = node.path.toLowerCase().includes(k)
      if (hit || kids.length) kept.push({ ...node, children: kids })
    }
    return kept
  }
  return walk(nodes)
}

/** 收集所有有子节点的路径（用于「展开全部」） */
export function collectParents(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length) {
      out.push(n.path)
      collectParents(n.children, out)
    }
  }
  return out
}
