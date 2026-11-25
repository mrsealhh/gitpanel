/**
 * 把 git 的英文报错翻译成「发生了什么 + 该怎么办」，避免用户一头雾水。
 * 只做展示层翻译，原始报错会完整记录到日志里方便复盘。
 */
export interface ExplainedError {
  /** 一句话说明原因 */
  summary: string
  /** 建议的下一步操作 */
  hint: string
}

interface Rule {
  test: RegExp
  summary: string | ((m: RegExpMatchArray) => string)
  hint: string
}

const RULES: Rule[] = [
  {
    test: /local changes to the following files would be overwritten|would be overwritten by checkout|commit your changes or stash them/i,
    summary: '当前有未提交的改动，切换/拉取会覆盖这些文件',
    hint: '先提交（或点「储藏」把改动收起来），再重试这个操作',
  },
  {
    test: /would be overwritten by merge/i,
    summary: '存在未提交改动，合并会覆盖这些文件',
    hint: '先提交或储藏改动，再拉取 / 合并',
  },
  {
    test: /You have not concluded your merge|MERGE_HEAD exists/i,
    summary: '上一次合并还没结束',
    hint: '先解决冲突并提交，或「中止」这次合并',
  },
  {
    test: /You are in the middle of a rebase|rebase in progress/i,
    summary: 'rebase 还在进行中',
    hint: '在顶部提示条里继续 / 跳过 / 中止 rebase',
  },
  {
    test: /no upstream branch|has no upstream branch|--set-upstream/i,
    summary: '这个分支还没有关联远端分支',
    hint: '直接点「推送」，GitPanel 会自动帮你设置上游',
  },
  {
    test: /non-fast-forward|failed to push some refs|Updates were rejected/i,
    summary: '远端有你本地没有的提交，直接推送会被拒绝',
    hint: '先「拉取」（Pull）合并远端改动，再推送',
  },
  {
    test: /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)/i,
    summary: '这台机器还没通过远端的身份验证',
    hint: '先在终端完成一次 git 登录（凭据管理器会记住），GitPanel 不保存账号密码',
  },
  {
    test: /Repository not found|not found/i,
    summary: '仓库地址不存在，或当前账号没有权限',
    hint: '检查远端地址和账号权限',
  },
  {
    test: /CONFLICT \((content|modify\/delete|add\/add)\)/i,
    summary: '有文件冲突需要先解决',
    hint: '在「工作区 → 冲突」里逐个解决，然后继续 / 提交',
  },
  {
    test: /index\.lock|Unable to create .*\.lock|Another git process/i,
    summary: '另一个 git 进程正在操作这个仓库（锁文件被占用）',
    hint: '关掉其他 Git 工具/终端里的 git 命令，稍后重试；确认没有进程后可删除 .git/index.lock',
  },
  {
    test: /pathspec .* did not match|did not match any file/i,
    summary: '要操作的文件/分支不存在',
    hint: '刷新一下列表，确认路径或名字没写错',
  },
  {
    test: /not a git repository/i,
    summary: '这个目录不是 git 仓库',
    hint: '确认选中的是仓库根目录（含 .git 的目录）',
  },
  {
    test: /detached HEAD|you are not currently on a branch/i,
    summary: '当前处于游离头指针状态（没在分支上）',
    hint: '先切回某个分支再操作',
  },
  {
    test: /cannot delete branch .* checked out|used by worktree/i,
    summary: '这个分支正在被当前目录或某个工作树使用',
    hint: '先切换到别的分支，或移除对应工作树后再删除',
  },
  {
    test: /Your branch is behind|need to pull/i,
    summary: '当前分支落后于远端',
    hint: '先拉取远端更新',
  },
  {
    test: /fatal: destination path .* already exists/i,
    summary: '目标目录已经存在内容',
    hint: '换一个空目录',
  },
  {
    test: /invalid reference|unknown revision/i,
    summary: '引用的分支或提交不存在',
    hint: '刷新后重新选择',
  },
]

export function explainGitError(raw: string): ExplainedError {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return { summary: '操作失败', hint: '展开日志查看更详细的信息' }

  for (const rule of RULES) {
    const m = text.match(rule.test)
    if (m) {
      return {
        summary: typeof rule.summary === 'function' ? rule.summary(m) : rule.summary,
        hint: rule.hint,
      }
    }
  }

  // 没命中规则：保留原始信息的第一行，避免完全丢失上下文
  const firstLine = String(raw).split('\n').find((l) => l.trim()) ?? text
  return {
    summary: firstLine.replace(/^(error|fatal|warning):\s*/i, '').slice(0, 160),
    hint: '展开日志可以看到完整的 git 输出',
  }
}
