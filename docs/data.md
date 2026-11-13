# 数据与配置

文件都在哪，怎么备份，怎么迁移。

---

## 三个目录，三种命运

| 路径 | 存什么 | 宿主清理时 |
|---|---|---|
| `Download/Operit/@serveryyswys/devtool/` | 项目清单、设置、日志 | **保留** |
| `Download/Operit/dev_package/<项目名>/` | 项目本体 | **保留** |
| `Download/Operit/cleanOnExit/<项目名>/` | 会话锁、待确认记录 | **清掉** |

前两个是持久数据，可以放心。第三个是短期数据，本来就是要被清掉的。

---

## 注册中心

```
Download/Operit/@serveryyswys/devtool/
├── registry.json     ← 项目清单
├── settings.json     ← 全局配置
└── logs/
    └── devtool.log   ← 运行日志
```

### registry.json

记录「这个插件创建了哪些项目」。

```json
{
  "version": 1,
  "entries": [
    {
      "packageId": "com.example.demo",
      "type": "toolpkg-ts",
      "path": "/storage/emulated/0/Download/Operit/dev_package/com.example.demo",
      "createdAt": "2026-11-14 00:16:26",
      "updatedAt": "2026-11-14 00:16:26"
    }
  ]
}
```

**注意时间是空格分隔的**（`2026-11-14 00:16:26`），不是标准 ISO 格式。自己写脚本读的时候要处理一下。

`list_projects` 读的就是这个文件。删掉某个条目 = 该项目从「项目列表」里消失（但目录还在）。

### settings.json

全局配置，所有项目共用。

```json
{
  "deleteDirFileCount": 20,
  "rollbackVersionSpan": 3,
  "dependencyMaxMb": 100,
  "autosnapRetention": 300,
  "confirmTitle": "需要你批准",
  "confirmHint": "该操作涉及大量不可逆操作，请谨慎选择"
}
```

缺字段会用默认值补齐，所以手改时不用全写。

### logs/devtool.log

运行时日志。

**结构**

```
===== SESSION {"idx":3,"startedAt":"2026-11-14 00:16:26.193"} =====
============================================================
ToolpkgDev v1.0.0 — 安全的 Operit 插件开发环境
Powered by Serveryyswys
============================================================
  /\_/\
 ( o.o )
  > ^ <  日志是写给未来的自己看的
============================================================
[2026-11-14 00:16:26.266] [INFO] [Main] ===== registerToolPkg 开始 =====
[2026-11-14 00:16:26.269] [DEBUG] [Main] 注册 UI 路由…
...
```

- 每次 Operit 启动写一条 `SESSION` 头
- 时间戳是**本地时间**，不是 UTC
- 超过 2 MB 自动轮转到 `devtool.1.log`
- 日志页按 `SESSION` 头切分轮次

---

## 项目目录

```
Download/Operit/dev_package/<项目名>/
├── storage.db          ← 虚拟文件系统 + 快照（核心数据）
├── metadata.json       ← 项目元信息
├── .devtool/           ← 工具链临时目录，可删
│   └── tsc_tmp/        ← 编译时临时落地，跑完自动清理
└── opt/                ← 导出落地区
    └── mydata/         ← export 出来的文件
```

**`storage.db` 才是你的代码。** 它是个 SQLite 数据库，里面装：

- 文件树和文件内容
- 自动快照（每次写入一条）
- 版本快照（commit 的节点）

想手动看看里面有什么，用 `list` / `read` 工具，或者把 db 拷出来用 SQLite 工具打开。

### metadata.json

```json
{
  "packageId": "com.example.demo",
  "type": "toolpkg-ts",
  "displayName": "示例项目",
  "description": "...",
  "author": "...",
  "license": "MIT",
  "createdAt": "2026-11-14 00:16:26",
  "schemaVersion": 1
}
```

`type` / `displayName` / `description` / `author` / `license` 可以改（用 `metadata` 工具）。

包名、`createdAt`、`schemaVersion` 不能改。

---

## 短期数据

```
Download/Operit/cleanOnExit/<项目名>/
└── pending/
    └── <确认id>.json
```

以及本插件自己的：

```
Download/Operit/cleanOnExit/com.operit.serveryyswys.toolpkgdev/
└── .devtool.sessionlock      ← 会话锁
```

### 会话锁为什么放这儿

它记录「本次 Operit 会话是否已经打过日志横幅」。

**必须跟着宿主清理一起消失**，否则下次启动时锁还在，就会被判定为「本次会话已打过」，日志里永远只有一条 SESSION 头，会话切换功能失效。

日志是持久数据，锁是易失数据 —— 两者生命周期相反，不能住一起。

### 待确认记录

重启 Operit 会清掉未处理完的确认请求。看到确认框尽快处理。

---

## 备份

### 备份单个项目

拷这两个：

```
dev_package/<项目名>/storage.db
dev_package/<项目名>/metadata.json
```

`storage.db` 就是全部内容。`.devtool/` 和 `opt/` 都是可再生的。

### 备份全部

拷整个 `@serveryyswys/devtool/` + 整个 `dev_package/`。

### 注意

`storage.db` 运行时会被占用。**先停掉 Operit 再拷**，否则可能拷到写一半的状态。

---

## 迁移

### 换设备

1. 旧设备拷出 `dev_package/<项目名>/`
2. 新设备放到同路径
3. **手动补一条 `registry.json` 记录**，否则 `list_projects` 看不到它

或者更简单：拷出 db 后用 `init` 在新设备建个空项目，再把文件 `upload` 进去。

### 只想要代码

用 `export` 把虚拟文件写到 `opt/`，然后拷 `opt/` 目录。这是最干净的方式 —— 拿到的是真实的文件，不是数据库。

---

## 配置改错了怎么办

**基础配置**页面底部有「恢复默认」。

或者直接删 `settings.json` —— 下次读取时会用默认值重建。

---

## 日志太大怎么办

日志页有「清空」按钮。

或者直接删：

```
@serveryyswys/devtool/logs/devtool.log
@serveryyswys/devtool/logs/devtool.1.log
```

日志文件是独立追加的，删掉不影响任何功能（下次运行会重新创建）。

---

## 快照太多怎么办

```
devtool:autosnap_retention  package_id=... limit=100
```

改小后会立即剪枝。

或者手动触发一次：

```
devtool:autosnap_prune  package_id=...
```

平时每次写入都会自动剪枝，不需要手动管。

---

# Data & Settings

Three directories, three different fates.

| Path | Contents | Survives host cleanup |
|---|---|---|
| `Download/Operit/@serveryyswys/devtool/` | Registry, settings, logs | **Yes** |
| `Download/Operit/dev_package/<name>/` | Project data | **Yes** |
| `Download/Operit/cleanOnExit/<name>/` | Session lock, pending records | **No** |

## Registry directory

`registry.json` lists every project this plugin created. Note that timestamps are
space-separated (`2026-11-14 00:16:26`), not ISO — handle that when scripting against it.

`settings.json` holds global configuration shared by all projects. Missing fields fall back to
defaults, so you never need to write the whole file.

`logs/devtool.log` is append-only, rotates at 2 MB, and uses local timestamps. Each Operit
session writes a `SESSION` header, which is what the logs panel splits on.

## Project directory

`storage.db` **is** your code: file tree, contents, auto snapshots and version snapshots. It is
a SQLite database. `.devtool/` and `opt/` are both regenerable.

`metadata.json` can have its type, display name, description, author and licence changed
through the `metadata` tool. Package name, `createdAt` and `schemaVersion` are immutable.

## Volatile data

Pending confirmations and the session lock live under `cleanOnExit`.

**The session lock belongs there on purpose.** It records whether the current Operit session
has already written a log banner, and it must be cleared along with the host's cleanup.
Keeping it elsewhere would leave it permanently set, so every session would think the banner
was already written — and the logs would never gain a second session. Persistent data and
volatile data have opposite lifecycles and must not share a directory.

A restart clears unhandled confirmations. Handle them promptly.

## Backup

To back up a project, copy `storage.db` and `metadata.json`. To back up everything, copy the
registry directory and `dev_package/`.

`storage.db` is held open while the app runs — **stop Operit before copying**, or you may
capture a half-written state.

## Migration

After copying a project to a new device, you must also add an entry to `registry.json`,
otherwise `list_projects` will not see it. Alternatively, `init` an empty project on the new
device and `upload` the files into it.

To extract plain files rather than a database, use `export` — it writes real files to `opt/`.

## Resetting

Delete `settings.json` to restore defaults; delete the log files to reclaim space. Neither
affects functionality.