use std::time::Instant;

use git_core::Repo;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = match args.next() {
        Some(p) => p,
        None => {
            eprintln!("usage: perf-probe <repo-path> [limit] [tip]");
            std::process::exit(2);
        }
    };
    let limit: u32 = args
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);
    let tip = args.next().unwrap_or_default();

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
