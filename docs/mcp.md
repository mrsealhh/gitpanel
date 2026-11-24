# GitPanel MCP 接入指南

`gitpanel-mcp.exe` 是一个 **stdio MCP 服务端**，把 GitPanel 的仓库能力开放给第三方 AI
（Claude Desktop / Cursor / Continue / 任何支持 MCP 的客户端），让模型能直接读你的仓库并执行常见 Git 操作。

## 1. 拿到可执行文件

安装版会把 `gitpanel-mcp.exe` 放在安装目录（与 `gitpanel.exe` 同级），无需额外构建。

从源码自己编也可以：

```powershell
cargo build --release -p gitpanel-mcp
# 产物：C:\cargo-target\gitpanel\release\gitpanel-mcp.exe（约 2 MB，单文件，无依赖）
```

## 2. 配置客户端

Claude Desktop：编辑 `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gitpanel": {
      "command": "C:\\Program Files\\GitPanel\\gitpanel-mcp.exe"
    }
  }
}
```

Cursor：`.cursor/mcp.json`（项目级）或全局 `~/.cursor/mcp.json`，格式相同。

重启客户端后，工具列表里会出现 `repo_info`、`graph`、`worktree_status`… 共 22 个工具。

## 3. 可用工具

**只读**

| 工具 | 说明 |
|---|---|
| `repo_info` | 路径、当前分支、refs |
| `graph` | 提交图（含泳道布局），可指定 limit / tip |
| `commit_detail` | 单提交详情 + 文件变更统计 |
| `file_diff` | 某文件在某个提交里的前后全文 |
| `file_history` | 单文件历史（跟随重命名） |
| `working_status` | 已暂存 / 未暂存 / 未跟踪 / 冲突 |
| `branches` | 分支、远端、标签 |
| `worktrees` | 所有并行副本：分支、脏文件、是否已合回主干 |
| `repo_health` | 体积、pack、大对象、gc 建议 |
| `reflog` | HEAD 变更历史 |

**写操作**（默认开启，可用只读模式关闭）

| 工具 | 说明 |
|---|---|
| `stage` / `unstage` | 暂存 / 取消暂存 |
| `commit` | 提交（支持 amend / addAll） |
| `create_branch` / `checkout` / `merge_branch` | 分支操作 |
| `worktree_add` / `worktree_remove` | 工作树管理 |
| `stash_create` / `stash_action` | 暂存区（stash） |
| `tag_create` | 标签 |
| `reset_to` | soft / mixed / hard 重置（自动打安全网快照） |

## 4. 安全建议

- **只读模式**：给「只需要看代码」的会话配置
  ```json
  { "command": "…\\gitpanel-mcp.exe", "env": { "GITPANEL_MCP_READ_ONLY": "1" } }
  ```
- MCP 与服务端一样**不保存任何凭据**，走本机 git 已有的配置和凭据管理器。
- 写操作（`reset_to`、`merge_branch` 等）执行前会创建 `refs/gitpanel/snapshots/*` 快照，
  出问题可以在客户端的「安全网」里一键回滚。
- 建议先只给 `worktree_add` 这类「开副本」的工具权限，验证稳定后再放开提交类操作。

## 5. 典型用法

```
你：看一下 rebase-lab 这个仓库现在有几个并行工作树，各自在做什么
AI → worktrees(path="…/rebase-lab")
   ← [{ branch: "feat/ai-1", dirty: 2, merged: false, … }]

你：给 feat/ai-1 那个副本提交一下，信息用 "fix: 登录超时"
AI → working_status(path="…/rebase-lab-wt1")
   → stage(files=["src/login.ts"])
   → commit(message="fix: 登录超时")
```

## 6. 自检

```powershell
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' |
  & .\gitpanel-mcp.exe
```

应返回 `serverInfo: { name: "gitpanel" }`。
