# ToolpkgDev 文档

给 AI 用的一整套完整 Toolpkg IDE。

---

## 文档结构

| 文档 | 内容 | 适合谁 |
|---|---|---|
| [快速上手](getting-started.md) | 装好之后第一步做什么，从建项目到出包 | 所有人 |
| [工具参考](tools.md) | 50 个工具的完整说明，按用途分组 | 需要查具体参数时 |
| [权限确认](consent.md) | 询问制守卫怎么工作，什么时候会拦住你 | 想知道「为什么它不让我删」 |
| [界面说明](ui.md) | 七个页面的用途与操作 | 第一次打开面板时 |
| [数据与配置](data.md) | 文件存在哪、怎么配、怎么备份 | 想备份或迁移项目 |
| [常见问题](faq.md) | 出错怎么办、能做什么不能做什么 | 遇到问题时 |

---

## 一分钟了解

ToolpkgDev 把 Operit 插件的开发流程收进一个地方：

```
建项目  →  写代码  →  存快照  →  编译  →  打包
  ↑          ↓          ↓
  └── 回滚 ──┴──────────┘
```

三个关键点：

**① 文件不落地**
所有代码存在 `storage.db` 里，不散落在你的文件夹中。碰不到你的真实文件，也就不会误删。

**② 每步都能退回去**
每改一次自动存快照；重要节点另存版本。改坏了随时回滚，不用从头再来。

**③ 危险操作先问你**
删除整包、批量回滚这类无法撤销的操作，AI 不能自己动手，必须你点「确认」。

---

## 如果你是 AI

这份文档也是给 AI 读的。

- **工具怎么调** → [tools.md](tools.md)，每个工具都有参数表
- **为什么被拦下了** → [consent.md](consent.md)，以及如何继续
- **约定与边界** → 每个文档末尾都有「注意事项」

---

# ToolpkgDev Documentation

A complete Toolpkg IDE for AI use.

## Structure

| Document | Contents | For |
|---|---|---|
| [Getting Started](getting-started.md) | From install to a built package | Everyone |
| [Tools Reference](tools.md) | All 50 tools, grouped by purpose | When you need exact parameters |
| [Consent Gate](consent.md) | How the guard works, when it blocks you | "Why won't it let me delete this?" |
| [UI Panels](ui.md) | What each of the seven panels does | First time opening the toolbox |
| [Data & Settings](data.md) | Where files live, how to configure and back up | Backing up or migrating |
| [FAQ](faq.md) | What to do when something breaks | Troubleshooting |

## In one minute

ToolpkgDev folds the whole Operit plugin workflow into one place:

```
init  →  write  →  snapshot  →  compile  →  package
  ↑        ↓          ↓
  └─ rollback ────────┘
```

Three things matter:

**Nothing touches your disk.** Code lives in `storage.db`. It cannot clobber your real files.

**Everything is reversible.** Every write is snapshotted; important points become versions.

**Irreversible actions ask first.** Deleting a project or mass-rolling back requires your approval.

## If you are an AI

This documentation is written for you too. Start with [tools.md](tools.md) for exact
parameters, and [consent.md](consent.md) when a call comes back asking for confirmation.