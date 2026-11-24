use std::collections::HashMap;
use std::time::Instant;

use git_core::{graph, RawCommit, Repo};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.first().map(|s| s.as_str()) == Some("--synth") {
        let n: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(100_000);
        run_synthetic(n);
        return Ok(());
    }

    let mut it = args.into_iter();
    let path = match it.next() {
        Some(p) => p,
        None => {
            eprintln!("usage:");
            eprintln!("  perf-probe <repo-path> [limit] [tip]   # 真实仓库性能");
            eprintln!("  perf-probe --synth [N]                 # 纯布局算法基准（默认 10 万）");
            std::process::exit(2);
        }
    };
    let limit: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(2000);
    let tip = it.next().unwrap_or_default();

    let t0 = Instant::now();
    let repo = Repo::open(&path)?;
    println!(
        "open            : {:>9.2} ms  {}",
        t0.elapsed().as_secs_f64() * 1000.0,
        repo.path().display()
    );

    let t1 = Instant::now();
    let info = repo.info()?;
    println!(
        "refs            : {:>9.2} ms  {} refs, head={}",
        t1.elapsed().as_secs_f64() * 1000.0,
        info.refs.len(),
        info.branch
    );

    let t2 = Instant::now();
    let page = repo.graph_page(0, limit, &tip)?;
    let ms = t2.elapsed().as_secs_f64() * 1000.0;
    let per_row = if page.rows.is_empty() {
        0.0
    } else {
        ms / page.rows.len() as f64
    };
    println!(
        "walk+layout     : {:>9.2} ms  {} rows, {} lanes, {:.3} ms/row",
        ms,
        page.rows.len(),
        page.lane_count,
        per_row
    );

    let t3 = Instant::now();
    if let Some(first) = page.rows.first() {
        let d = repo.commit_detail(&first.oid)?;
        println!(
            "commit detail   : {:>9.2} ms  {} files, +{} -{}",
            t3.elapsed().as_secs_f64() * 1000.0,
            d.files.len(),
            d.additions,
            d.deletions
        );
    }

    Ok(())
}

/// 纯算法基准：不碰磁盘，只测「提交 -> 泳道线段」这一步。
/// 这是 10 万提交 KPI 的关键，与仓库在 SSD 还是 HDD 无关。
fn run_synthetic(n: usize) {
    let mut commits: Vec<RawCommit> = Vec::with_capacity(n);
    for i in 0..n {
        let mut parents = Vec::new();
        if i + 1 < n {
            parents.push(format!("{:040x}", i + 1));
        }
        // 每 17 个提交制造一次分叉/合并，天然产生多条泳道
        if i % 17 == 0 && i + 3 < n {
            parents.push(format!("{:040x}", i + 3));
        }
        commits.push(RawCommit {
            oid: format!("{:040x}", i),
            parents,
            author: "bench".to_string(),
            email: "b@x.io".to_string(),
            time: (n - i) as i64,
            summary: format!("commit {i}"),
        });
    }

    let badges: HashMap<String, Vec<git_core::RefBadge>> = HashMap::new();
    let t0 = Instant::now();
    let (rows, lanes) = graph::layout(&commits, &badges);
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "layout synth    : {:>9.2} ms  {} rows, {} lanes, {:.4} ms/row",
        ms,
        rows.len(),
        lanes,
        ms / rows.len() as f64
    );
    println!(
        "                  segments: {}",
        rows.iter().map(|r| r.segments.len()).sum::<usize>()
    );
}
