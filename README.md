# GitPanel

本地、离线、轻量的 Git 可视化管理面板。分支树 / 历史提交 / 分支管理 / 常用操作，全功能一次到位。

![提交图](docs/screenshot-graph.png)

![并排 Diff](docs/screenshot-diff.png)

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 |
| Git 内核 | Rust（`crates/git-core`，libgit2 先行，接口可平滑替换为 gix） |
| 前端 | Vue 3 + Vite + TypeScript + Tailwind CSS |
| 提交图 | Canvas 2D 自绘（只画可视区，10 万提交仍 60fps） |
| 列表 | 自研虚拟滚动（固定行高 26/28px） |

## 目录

```
crates/git-core       Git 内核：打开仓库 / 提交遍历 / 泳道布局 / 提交详情
crates/perf-probe     性能基准 CLI（先用它验证大仓库，再谈 UI）
devserver/            开发期数据桥：直接调本机 git，输出与 Rust 内核一致的契约
src/                  Vue 3 前端
src/api/              数据适配层（前端唯一数据入口）
scripts/              开发与维护脚本
```

## 快速开始

### 1. 前端 + 开发数据桥（不需要 Rust）

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

打开 http://127.0.0.1:5273 ，在顶部输入任意本机仓库路径即可浏览分支树，点右侧文件列表进入并排 Diff。

> 想分开跑：`node devserver/server.mjs`（端口 7717）+ `pnpm dev`（端口 5273）。
>
> 端口 5173 是 vite 默认端口，本机常被其他项目占用，这里固定用 5273。

### 2. Rust 内核

```powershell
cargo test -p git-core          # 泳道布局单测
cargo run -p perf-probe -- F:\gitlab\gitpanel 5000
```

编译产物统一输出到 `C:\cargo-target\gitpanel`（见 `.cargo/config.toml`），避免机械盘的随机小文件读写瓶颈。

```powershell
cargo ck                        # = cargo check，日常快速校验
powershell -ExecutionPolicy Bypass -File scripts/clean-target.ps1 -Clean   # 清理编译产物
```

## 数据契约

前端只认 `src/api/types.ts`，与 `crates/git-core/src/model.rs` 一一对应。
浏览器态走 `devserver/` 的 HTTP 桥，Tauri 态换成 `invoke()`，**界面代码零改动**。

## 性能基线（本机 i5-13400 / 32G / 项目在机械盘、target 在 SSD）

真实仓库 `postsharp`（318 提交 / 156 refs，机械盘）：

| 操作 | 首次（冷） | 热 |
|---|---|---|
| 打开仓库 | 11 ms | 11 ms |
| 读取 refs | 39 ms | 23 ms |
| 提交遍历 + 泳道布局 | 73 ms | 35 ms |
| 提交详情（含 diff 统计） | 250 ms | 19 ms |
| 单文件全文对比（file diff） | — | 0.27 ms |

纯布局算法（合成 10 万提交，不碰磁盘）：

```
layout synth : 188–283 ms   100000 rows, 223531 segments
```

前端产物：`87 KB JS + 20 KB CSS`（gzip 34 KB + 5 KB）。

## 当前进度

- [x] 仓库打开 / 分支标签
- [x] 提交图（泳道布局 + Canvas 渲染 + 虚拟滚动）
- [x] 提交列表 / 详情 / 文件变更统计
- [x] Rust 内核 + 布局单测 + 性能基准 CLI
- [x] Diff 查看（CodeMirror 6 并排 + 折叠未变更区 + 按扩展名懒加载语法高亮）
- [ ] 分支 / 暂存 / 提交 / 推拉
- [ ] 冲突解决 / 交互式 rebase / 安全网快照
- [ ] Tauri 打包

## 设计文档

见 `C:\Users\Administrator\Desktop\AICoding\autofix\Git可视化管理面板-技术选型与架构设计.md`
