# 权限确认

无法撤销的操作，AI 不能自己动手。

---

## 为什么要有这个

AI 很能干，但它不承担后果。删掉一个写了三天的项目，对它来说只是一次成功的函数调用；对你来说是从头再来。

所以这个插件拦了一道：**凡是做了就回不来的操作，必须你点头。**

---

## 哪些操作会被拦

| 操作 | 触发条件 |
|---|---|
| `destroy` 整包摧毁 | **总是** |
| `archive` 归档 | **总是**（除非传 `force=true`） |
| `delete` 删目录 | 目录内文件数超过阈值（默认 20） |
| `rollback` 回滚 | 跨过的版本数超过阈值（默认 3） |
| `revert_to` 批量回滚 | **总是** |

阈值可以在 **基础配置** 里改。

> 注意：`delete` 只拦**目录**删除且超过文件数阈值。删单个文件不拦，因为单文件可以靠快照恢复。

---

## 完整流程

```
① AI 调用 devtool:destroy  package_id=com.example.demo
        │
        ▼
② 工具不执行，只生成一条待确认记录
   返回：need_confirm=true, confirm_id="cmwfxxx", xml="<devtool_check>..."
        │
        ▼
③ AI 把 XML 原样输出到聊天里
   <devtool_check>{"id":"cmwfxxx","packageId":"com.example.demo"}</devtool_check>
        │
        ▼
④ 客户端渲染成确认框
        │
        ├── 用户点【驳回】─► status=rejected ─► 什么都不发生
        │
        └── 用户点【确认】─► status=approved
                │
                ▼
        ⑤ AI 带 confirm_id 重新调用
           devtool:destroy  package_id=...  confirm_id=cmwfxxx
                │
                ▼
        ⑥ 校验通过 → 真正执行 → status=done
```

**关键点：批准 ≠ 执行。** 用户点确认只是把记录状态改成 `approved`，真正的动作发生在 AI 拿着 `confirm_id` 重新调用的那一刻。

为什么要这样设计？因为「用户点了按钮」和「AI 知道用户点了按钮」是两件事。中间必须有一步让 AI 重新发起，否则 AI 会以为还在等，而用户以为已经完事了。

---

## 确认框长什么样

```
┌─────────────────────────────────┐
│                                 │
│      需要你批准                  │  ← 主标题，可自定义
│                                 │
│   该操作涉及大量不可逆操作，     │  ← 小字，可自定义
│        请谨慎选择                │
│                                 │
│   ┌───────────┐ ┌───────────┐   │
│   │   确认     │ │   驳回     │   │  ← 确认是红色
│   └───────────┘ └───────────┘   │
│                                 │
│  *若无法点击，请移步至「待确认操作」│  ← 固定第三行
│                                 │
└─────────────────────────────────┘
```

主标题和提示文字可以在 **基础配置** 里改默认值，也可以单次调用时通过 `title` / `hint` 覆盖。

---

## 兜底：待确认操作页面

Operit 有个老问题：**会话太长时，聊天里的 XML 按钮不一定点得动。**

所以确认框底部永远有一行小字，指向 **待确认操作** 页面。那里：

- 列出所有 `pending` 状态的记录
- 每条都带同样的【确认】【驳回】按钮
- 附带完整历史（已批准、已驳回、已完成的都留着）

**聊天里点不动，去那里点，效果完全一样。**

---

## 跳过确认

输入菜单里有一个开关：**跳过危险操作确认**。

打开后所有操作直接执行，不生成确认请求。

**它是给测试用的，默认关闭。** 生产环境打开它等于拆掉刹车。

打开后 `destroy` 之类的工具会立刻执行 —— 因为没有记录，也就没有 `confirm_id` 可传。

---

## 给 AI 的说明

**当工具返回 `need_confirm` 时：**

1. **不要重试**，重试只会生成新的确认请求
2. **把返回的 `xml` 字段原样输出到回复里**，它会渲染成确认框
3. **告诉用户你在等什么** —— 比如「需要你批准摧毁 com.example.demo，2 个文件」
4. **等用户回复**，用户批准后客户端会发一条消息给你
5. **带上 `confirm_id` 重新调用原工具**

**当用户驳回时：**

记录状态变成 `rejected`。不要反复请求同一个操作，除非用户明确改变主意。

**当 `confirm_id` 无效或过期时：**

工具会返回「记录已失效」。此时重新调用一次（不带 `confirm_id`）即可生成新请求。

---

## 数据结构

待确认记录落在：

```
/Download/Operit/cleanOnExit/<项目名>/pending/<id>.json
```

内容：

```json
{
  "id": "cmwfxxx",
  "action": "destroy",
  "summary": "摧毁项目 com.example.demo（2 个文件，1.5 KB）",
  "detail": "项目目录：...\n虚拟文件：2 个 / 1.5 KB\n...",
  "packageId": "com.example.demo",
  "payload": { "tool": "devtool", "action": "destroy", "params": {...} },
  "status": "pending",
  "createdAt": "2026-11-14T00:16:26.193Z",
  "updatedAt": null
}
```

`status` 五态：

| 状态 | 含义 |
|---|---|
| `pending` | 等用户处理 |
| `approved` | 用户已批准，等 AI 执行 |
| `rejected` | 用户驳回 |
| `done` | 已执行完成 |
| `failed` | 执行失败 |

> 记录放在 `cleanOnExit` 是刻意的：它们是短期数据，宿主清理时跟着消失正合适。
> **但这也意味着重启 Operit 后未处理完的请求会消失** —— 想保留就尽快处理。

---

## 常见问题

**Q：为什么我点了确认，它没反应？**

确认只是改状态。AI 需要重新调用一次才真的执行。如果你看到「已批准」但动作没发生，说明 AI 还没发起第二次调用 —— 提醒它一下。

**Q：点了驳回，为什么首页还显示待确认？**

已经修复了。旧版本会把已处理的记录当成待确认显示，现在只看 `pending` 状态。

**Q：能批量处理吗？**

目前不行，得一条条点。批量批准本身就很危险，故意没做。

**Q：阈值设成多少合适？**

默认值（删除 20 个文件、跨 3 个版本回滚）适合大多数情况。如果你经常要批量删小目录，可以调高；如果你很谨慎，可以调到 1。

---

# Consent Gate

Operations that cannot be undone require your approval.

## Why

The AI is capable, but it does not bear the consequences. Deleting a project that took three
days is just a successful function call to it; to you it is starting over.

So the plugin intercepts: **anything that cannot be undone needs your approval first.**

## What gets blocked

| Operation | Trigger |
|---|---|
| `destroy` | **Always** |
| `archive` | **Always** (unless `force=true`) |
| `delete` | Directory deletions above the file-count threshold (default 20) |
| `rollback` | Rollbacks spanning more than the version threshold (default 3) |
| `revert_to` | **Always** |

Single-file deletion is not blocked — snapshots can restore it.

## The handshake

```
AI calls destroy
   → no execution; a pending record is created
   → returns need_confirm + confirm_id + XML
AI emits the XML into the chat
   → client renders a confirmation block
User taps 确认 or 驳回
   → 驳回: status=rejected, nothing happens
   → 确认: status=approved
AI calls again **with** confirm_id
   → validated → executed → status=done
```

**Approval is not execution.** Tapping the button only flips the record to `approved`; the
action happens when the AI re-issues the call carrying that `confirm_id`. Without that second
step, the AI would still be waiting while the user believes it is done.

## The fallback panel

Operit has a long-standing issue: in very long conversations, XML buttons sometimes stop
responding. The confirmation block therefore always carries a line pointing at the **Pending
Confirmations** panel, which lists every pending record with the same buttons plus full history.

## Bypass

The input-menu switch **Skip confirmation** disables the gate entirely. It exists for testing
and is off by default. With it on, destructive tools execute immediately — no record, therefore
no `confirm_id`.

## For AIs

When a tool returns `need_confirm`:

1. **Do not retry** — a retry just creates another pending record.
2. **Emit the returned `xml` verbatim** into your reply.
3. **Tell the user what you are waiting for**, concretely.
4. **Wait.** After approval the client sends you a message.
5. **Call the original tool again with `confirm_id`.**

If the record is rejected, do not keep asking unless the user changes their mind. If the
`confirm_id` is reported invalid, call once more without it to mint a fresh request.

## Storage

Records live under `cleanOnExit/<project>/pending/<id>.json` with a five-state lifecycle:
`pending → approved|rejected`, then `approved → done|failed`.

That directory is deliberately volatile: these are short-lived records. **A restart clears
unhandled requests** — handle them promptly.