# 界面说明

七个页面，各管一摊。

入口只有一个：Operit 工具箱 → **ToolpkgDev** → 首页。其余页面都从首页进。

---

## 首页

进门第一眼。

**显示什么**

- 待确认横幅（有 pending 记录时才出现，排在最前）
- 项目数、权限开关状态、当前阈值摘要

**四个入口**

| 卡片 | 去哪 |
|---|---|
| 环境检查 | 自检工具链 |
| 基础配置 | 改阈值和各种开关 |
| 待确认操作 | 处理等待批准的危险操作 |
| 运行日志 | 看运行记录 |
| 关于 | 版本与致谢 |

右上角有刷新按钮。

---

## 环境检查

回答一个问题：**这台机器现在能不能正常构建？**

**检查五项**

| 项目 | 查什么 | 失败意味着 |
|---|---|---|
| `opm` | 包是否装、能否调用 | 打不了包 |
| `tsc` | 编译器是否可用、版本号 | TS 项目编译不了 |
| `dev_package` 可写 | 写一个探针文件再删掉 | 项目建不出来 |
| `cleanOnExit` 可写 | 同上 | 确认记录存不下 |
| `node.operit` | 依赖是否能 require 到 | 深层路径写入会静默失败 |

**三种状态**

- 绿：通过
- 红：失败，附原因
- 灰：还没跑

进页面会自动跑一次，右上角可以手动重跑。跑的时候按钮会置灰转圈。

---

## 基础配置

改行为的地方。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| 跳过危险操作确认 | 关 | 打开后所有操作直接执行，**测试用** |
| 删除目录文件数阈值 | 20 | 超过这个数要确认 |
| 回滚版本跨度阈值 | 3 | 跨过这么多版本要确认 |
| 依赖提取体积上限 | 100 MB | 超过就拒绝提取 |
| 快照保留条数 | 300 | 超出自动剪枝 |
| 确认框主标题 | 需要你批准 | 可自定义 |
| 确认框提示文字 | 该操作涉及大量不可逆操作，请谨慎选择 | 可自定义 |

改完立即生效，不需要重启。

底部有「恢复默认」。

> 数值项会自动兜底：填负数或非数字会回到默认值，不会存进去。

---

## 待确认操作

**聊天里点不动确认框时的兜底。**

**页面结构**

1. 当前待确认的那个（如果有）—— 完整确认框，带按钮
2. 历史记录 —— 已驳回、已批准、已完成的都在这

每条记录显示：动作类型、状态、摘要、创建时间。

点任一条可以切到它。

**状态颜色**

- `pending` 橙
- `approved` 绿
- `rejected` 红
- `done` 灰
- `failed` 红

**注意**：批准后动作不会立刻执行 —— AI 还需要带着 `confirm_id` 再调一次。详见 [consent.md](consent.md)。

---

## 运行日志

出问题来看这里。

**三块内容**

1. **会话列表** —— 按「第几次启动」分组，固定高度约三行，多的在里面滑
2. **文件路径与大小** —— 当前日志在哪、多大
3. **日志正文** —— 按等级上色

**会话列表怎么读**

```
第 6 轮  · 11-14 00:16 · 42 行
第 5 轮  · 11-14 00:08 · 18 行 · 警告
第 3 轮  · 11-13 23:52 · 9 行 · 错误
```

- 左侧圆点：红=这轮有 ERROR，黄=有 WARN，灰=没事
- 点一行切到那轮

**三个按钮**

| 按钮 | 作用 |
|---|---|
| 刷新 | 重新读日志 |
| 复制 | 整个会话复制到剪贴板 |
| 清空 | 清空日志文件 |

**底部**有个 ASCII 猫，点一下换台词。

---

## 关于

看身份的地方。

- 身份卡：名称、版本、描述
- 技术信息：包名、许可证、版本、作者、工具数、界面数
- 能力概览：一句话说清这插件能干什么
- 两个入口：开源许可、仓库

---

## 开源许可

披露用了哪些开源作品。

**分区**

| 分区 | 内容 |
|---|---|
| 本项目 | ToolpkgDev 自己（GPL-3.0-or-later） |
| 宿主平台 | Operit AI |
| 直接依赖 | `node.operit`、TypeScript、Android SQLite |
| 工具集成与设计参照 | OperitPackageManager、version_snapshot |
| 经平台间接使用 | Compose Material3、Material Icons、QuickJS |

每条带许可证徽标、版权人、用途说明，有主页的可以点开。

底部有完整许可证文本的外链，以及无担保声明。

> 这份清单**只列真实用到的**。没引入的一律不列 —— 虚假披露比不披露更糟。

---

## 页面之间怎么走

```
首页 ─┬─► 环境检查
      ├─► 基础配置
      ├─► 待确认操作
      ├─► 运行日志
      └─► 关于 ──► 开源许可
```

**页面里没有返回箭头**，返回用系统返回键。

这是刻意的：Operit 的 `ctx.navigate` 只有 push 没有 pop，页内再画一个返回会把首页压到栈顶，按系统返回键又回到本页 —— 用户会看到两个返回。

---

# UI Panels

Seven panels, each with one job. The only entry point is the Operit toolbox → **ToolpkgDev**
→ home.

## Home

Pending banner (only when a request is waiting), project count, bypass state and threshold
summary, plus entry cards to every other panel.

## Environment Check

Answers one question: can this device build right now?

Checks `opm`, `tsc`, writability of `dev_package` and `cleanOnExit`, and whether
`node.operit` can be required. Runs on load; the top-right button re-runs it.

## Settings

Bypass switch, delete threshold, rollback threshold, dependency ceiling, snapshot retention,
and the default confirmation title and hint. Changes take effect immediately. Numeric fields
fall back to defaults rather than storing invalid values.

## Pending Confirmations

The fallback when in-chat XML buttons stop responding. Shows the current pending request with
full buttons, plus complete history with status colouring.

**Approving does not execute** — the AI still has to call again with `confirm_id`.

## Logs

A session list (fixed height, roughly three rows, internally scrollable), the file path and
size, and the log body colour-coded by level. Each session row carries a health dot: red for
errors, yellow for warnings. Buttons: refresh, copy, clear.

## About / Licenses

Identity, technical info, capability summary, and the open-source attribution list. The licence
page only lists components actually used — undisclosed or falsely disclosed dependencies are
both worse than an honest short list.

## Navigation

Panels never draw a back arrow. Operit's `ctx.navigate` only pushes; drawing a back arrow that
navigates to home would push home onto the stack, and the system back button would then return
to the panel — the user would perceive two backs. Return with the system back key.