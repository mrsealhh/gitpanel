// 泳道布局：与 crates/git-core/src/graph.rs 保持同一套算法
// 说明：这是开发期的参考实现（Node），正式运行由 Rust 内核产出同样结构。

const PALETTE_SIZE = 10

function fnv1a(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % PALETTE_SIZE
}

/** 颜色绑定 ref 名，保证同一分支跨页、跨过滤都同色 */
function brandColor(name) {
  return fnv1a(name)
}

/**
 * @param {{oid:string,parents:string[],author:string,email:string,time:number,summary:string}[]} commits
 * @param {Map<string,{name:string,kind:string}[]>} badgesByOid
 */
export function layout(commits, badgesByOid) {
  /** @type {({expects:string,color:number}|null)[]} */
  const lanes = []
  const rows = []
  let laneCount = 0

  const alloc = () => {
    const idx = lanes.indexOf(null)
    if (idx >= 0) return idx
    lanes.push(null)
    return lanes.length - 1
  }

  for (const c of commits) {
    const badges = badgesByOid.get(c.oid) || []
    let nodeLane = -1
    const mergeHits = []

    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i]
      if (l && l.expects === c.oid) {
        if (nodeLane === -1) nodeLane = i
        else mergeHits.push(i)
      }
    }

    let color
    if (nodeLane === -1) {
      nodeLane = alloc()
      color = badges.length ? brandColor(badges[0].name) : fnv1a(c.oid)
      lanes[nodeLane] = { expects: c.oid, color }
    } else {
      color = lanes[nodeLane].color
    }

    // ── 上半段：行顶 → 节点
    const segments = []
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i]
      if (!l) continue
      if (i === nodeLane) {
        segments.push({ x1: i, y1: 0, x2: i, y2: 0.5, curve: false, color: l.color })
      } else if (mergeHits.includes(i)) {
        segments.push({ x1: i, y1: 0, x2: nodeLane, y2: 0.5, curve: true, color: l.color })
      } else {
        segments.push({ x1: i, y1: 0, x2: i, y2: 1, curve: false, color: l.color })
      }
    }

    for (const i of mergeHits) lanes[i] = null

    // ── 下半段：节点 → 父提交
    if (c.parents.length === 0) {
      lanes[nodeLane] = null
    } else {
      lanes[nodeLane] = { expects: c.parents[0], color }
      segments.push({ x1: nodeLane, y1: 0.5, x2: nodeLane, y2: 1, curve: false, color })

      for (let p = 1; p < c.parents.length; p++) {
        const target = c.parents[p]
        let li = -1
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] && lanes[i].expects === target) {
            li = i
            break
          }
        }
        if (li === -1) {
          li = alloc()
          lanes[li] = { expects: target, color }
        }
        segments.push({ x1: nodeLane, y1: 0.5, x2: li, y2: 1, curve: li !== nodeLane, color })
      }
    }

    laneCount = Math.max(laneCount, lanes.length)
    rows.push({
      oid: c.oid,
      short: c.oid.slice(0, 7),
      parents: c.parents,
      lane: nodeLane,
      color,
      author: c.author,
      email: c.email,
      time: c.time,
      summary: c.summary,
      refs: badges,
      segments,
    })
  }

  return { rows, laneCount }
}
