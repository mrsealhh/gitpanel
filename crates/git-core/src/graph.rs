use std::collections::HashMap;

use crate::model::{CommitRow, RawCommit, RefBadge, Segment};

const PALETTE_SIZE: u8 = 10;

#[derive(Clone)]
struct Lane {
    /// 该泳道正在等待的提交 oid
    expects: String,
    color: u8,
}

fn fnv1a(s: &str) -> u8 {
    let mut h: u32 = 2166136261;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(16777619);
    }
    (h % PALETTE_SIZE as u32) as u8
}

fn alloc(lanes: &mut Vec<Option<Lane>>) -> usize {
    if let Some(i) = lanes.iter().position(|l| l.is_none()) {
        i
    } else {
        lanes.push(None);
        lanes.len() - 1
    }
}

#[allow(clippy::too_many_arguments)]
fn seg(x1: f32, y1: f32, x2: f32, y2: f32, curve: bool, color: u8) -> Segment {
    Segment {
        x1,
        y1,
        x2,
        y2,
        curve,
        color,
    }
}

/// 泳道布局：一遍 O(n) 扫描，产出每行可直接绘制的线段。
/// 与 devserver/layout.mjs 保持完全一致的算法，两边结果必须逐字段相同。
pub fn layout(
    commits: &[RawCommit],
    badges: &HashMap<String, Vec<RefBadge>>,
) -> (Vec<CommitRow>, usize) {
    let mut lanes: Vec<Option<Lane>> = Vec::new();
    let mut rows: Vec<CommitRow> = Vec::with_capacity(commits.len());
    let mut lane_count: usize = 1;

    for c in commits {
        let empty: Vec<RefBadge> = Vec::new();
        let badges_here = badges.get(&c.oid).unwrap_or(&empty);

        // 1. 找出所有正在等待这条提交的泳道
        let mut node_lane: Option<usize> = None;
        let mut merge_hits: Vec<usize> = Vec::new();
        for i in 0..lanes.len() {
            if let Some(l) = &lanes[i] {
                if l.expects == c.oid {
                    match node_lane {
                        None => node_lane = Some(i),
                        Some(_) => merge_hits.push(i),
                    }
                }
            }
        }

        // 2. 没有泳道等待它 => 分支尖端，开新泳道
        let color: u8;
        let nl: usize;
        match node_lane {
            Some(i) => {
                nl = i;
                color = lanes[i].as_ref().unwrap().color;
            }
            None => {
                nl = alloc(&mut lanes);
                color = match badges_here.first() {
                    Some(b) => fnv1a(&b.name),
                    None => fnv1a(&c.oid),
                };
                lanes[nl] = Some(Lane {
                    expects: c.oid.clone(),
                    color,
                });
            }
        }

        // 3. 上半段：行顶 -> 节点
        let mut segments: Vec<Segment> = Vec::new();
        for i in 0..lanes.len() {
            let Some(l) = &lanes[i] else { continue };
            if i == nl {
                segments.push(seg(i as f32, 0.0, i as f32, 0.5, false, l.color));
            } else if merge_hits.contains(&i) {
                segments.push(seg(i as f32, 0.0, nl as f32, 0.5, true, l.color));
            } else {
                segments.push(seg(i as f32, 0.0, i as f32, 1.0, false, l.color));
            }
        }

        // 4. 汇入的泳道释放
        for i in &merge_hits {
            lanes[*i] = None;
        }

        // 5. 下半段：节点 -> 父提交
        if c.parents.is_empty() {
            lanes[nl] = None;
        } else {
            lanes[nl] = Some(Lane {
                expects: c.parents[0].clone(),
                color,
            });
            segments.push(seg(nl as f32, 0.5, nl as f32, 1.0, false, color));

            for p in 1..c.parents.len() {
                let target = &c.parents[p];
                let mut found: Option<usize> = None;
                for i in 0..lanes.len() {
                    if let Some(l) = &lanes[i] {
                        if &l.expects == target {
                            found = Some(i);
                            break;
                        }
                    }
                }
                let li = match found {
                    Some(i) => i,
                    None => {
                        let i = alloc(&mut lanes);
                        lanes[i] = Some(Lane {
                            expects: target.clone(),
                            color,
                        });
                        i
                    }
                };
                segments.push(seg(nl as f32, 0.5, li as f32, 1.0, li != nl, color));
            }
        }

        lane_count = lane_count.max(lanes.len());

        rows.push(CommitRow {
            oid: c.oid.clone(),
            short: c.oid.chars().take(7).collect(),
            parents: c.parents.clone(),
            lane: nl,
            color,
            author: c.author.clone(),
            email: c.email.clone(),
            time: c.time,
            refs: badges_here.clone(),
            summary: c.summary.clone(),
            segments,
        });
    }

    (rows, lane_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(oid: &str, parents: &[&str]) -> RawCommit {
        RawCommit {
            oid: oid.to_string(),
            parents: parents.iter().map(|s| s.to_string()).collect(),
            author: "a".into(),
            email: "a@b.c".into(),
            time: 0,
            summary: oid.into(),
        }
    }

    #[test]
    fn linear_history_stays_on_one_lane() {
        let commits = vec![raw("c3", &["c2"]), raw("c2", &["c1"]), raw("c1", &[])];
        let (rows, lanes) = layout(&commits, &HashMap::new());
        assert_eq!(rows.len(), 3);
        assert_eq!(lanes, 1);
        assert!(rows.iter().all(|r| r.lane == 0));
    }

    #[test]
    fn merge_opens_and_closes_lane() {
        // m -> (a, b); a -> root; b -> root
        let commits = vec![
            raw("m", &["a", "b"]),
            raw("a", &["root"]),
            raw("b", &["root"]),
            raw("root", &[]),
        ];
        let (rows, lanes) = layout(&commits, &HashMap::new());
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[1].lane, 0);
        assert_eq!(rows[2].lane, 1);
        assert!(lanes >= 2);
        assert_eq!(rows[3].lane, 0);
    }

    #[test]
    fn branch_tip_gets_its_own_lane() {
        // 两个互不相关的尖端
        let commits = vec![raw("x", &["r"]), raw("y", &["r"]), raw("r", &[])];
        let (rows, lanes) = layout(&commits, &HashMap::new());
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[1].lane, 1);
        assert!(lanes >= 2);
    }
}
