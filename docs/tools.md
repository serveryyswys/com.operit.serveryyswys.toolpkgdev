# 工具参考

50 个工具的完整说明，按用途分组。

所有工具都属于 `devtool` 子包，调用形式为 `devtool:<工具名>`。

---

## 通用约定

**所有工具都要 `package_id`**（标明操作哪个项目），只有少数例外会在下表注明。

**路径是虚拟路径**，以 `/mydata` 开头，不是物理路径。

**写操作必须给 `description`** —— 它会出现在快照记录里，是给未来的你看的。

---

## 一、项目管理

| 工具 | 说明 |
|---|---|
| `init` | 建项目：生成 `storage.db`、`.devtool/`、`metadata.json`，写入模板，登记注册表 |
| `init_questionnaire` | 同上，但返回表单 XML，让用户自己填参数 |
| `metadata` | 读或改：`type` / `display_name` / `description` / `author` / `license` |
| `capabilities` | 该项目能用哪些工具链，不能用时说明原因 |
| `status` | 元信息、注册状态、各路径、数据库统计 |
| `list_projects` | 注册表里的全部项目（**不需要 package_id**） |
| `destroy` | 整包摧毁 —— **询问制** |
| `archive` | 归档 / 取消归档；归档后读可用、写拒绝 |

### init

```
package_id:  项目包名，也是目录名
type:        js / ts / toolpkg-js / toolpkg-ts
display_name 显示名（可选）
description  描述（可选）
author       作者（可选）
license      SPDX 标识（可选）；UNLICENSED 表示不写许可证
force        目录已存在时是否覆盖
```

选开源许可证会下载 SPDX 官方全文写入 `LICENSE`。

### metadata

不传任何可改字段 = 查询模式。

**不可改**：包名、`createdAt`、`schemaVersion`。

### capabilities

返回矩阵：`tsc` 是否可用（仅 `ts` / `toolpkg-ts`）、`opm` 是否可用（仅 `toolpkg-js` / `toolpkg-ts`），以及不可用时的具体原因。

### destroy

```
package_id:  要摧毁的项目
confirm_id:  用户已批准的确认记录 id（首次调用不传）
```

首次调用只生成确认请求、返回 `confirm_id` 和 XML。用户确认后再带 `confirm_id` 调一次才真正执行。详见 [consent.md](consent.md)。

### archive

```
mode:        archive（默认）走询问制 / unarchive 直接执行
note:        归档说明（可选）
force:       true 跳过确认
confirm_id:  用户已批准的确认记录 id
```

---

## 二、虚拟文件系统

| 工具 | 说明 |
|---|---|
| `read` | 读文件：文本按行切片，二进制返回 base64 |
| `write` | 写文件（文本或 base64），自动记快照 |
| `delete` | 删文件或目录，自动记快照 |
| `apply_file` | 精确片段替换：0 处或多处匹配都报错 |
| `grep` | 正则搜索整个虚拟树 |
| `sed` | 批量正则替换；`preview` 只返回 diff |
| `list` | 列目录，可递归 |
| `stat` | 存在性、是否目录、大小、checksum、时间 |

### read

```
path:     虚拟路径，如 /mydata/src/main.ts
offset:   起始行（0 起，仅文本）
limit:    读取行数（仅文本）
```

二进制文件返回 `content` 为 base64 且 `isBinary: true`。

### write

```
path:            虚拟路径
content:         文本内容
content_base64:  二进制内容（与 content 二选一）
description:     本次写入说明（必填）
```

**覆盖整个文件**。想局部改请用 `apply_file`。

### apply_file

```
path:        虚拟路径
old:         原文片段（必须精确且唯一匹配）
new:         新内容
occurrence:  第几处（1 起），用于多处匹配时指定
description: 本次修改说明（必填）
```

**为什么这么严格**：0 处匹配说明你记错了原文，静默失败会让你以为改成功了；多处匹配说明这段文本不唯一，硬改会误伤别处。两种情况都该报错，让人和 AI 都停下来重新确认。

### grep

```
pattern:      正则或字面量
fixed:        字面量匹配（不走正则）
ignore_case:  忽略大小写
paths:        限定路径前缀
include:      只搜这些扩展名
exclude:      排除这些扩展名
max_results:  匹配条数上限
```

纯查询，不记快照。

### sed

```
find:         查找内容
replace:      替换成
paths:        作用路径前缀
action:       preview（默认）/ apply
fixed:        字面量匹配
ignore_case:  忽略大小写
global:       全局替换
include:      只处理这些扩展名
description:  action=apply 时必填
```

---

## 三、自动快照（每次写入）

| 工具 | 说明 |
|---|---|
| `history` | 变更流水，最新在前，可按 path 过滤 |
| `history_preview` | 紧凑列表，突出 id、说明、变更类型、尺寸变化 |
| `show_record` | 单条记录的 diff 与前后内容预览 |
| `revert` | 回滚单条变更（回滚本身也记一条） |
| `revert_to` | 撤销 `id >= from_id` 的全部变更 —— **需 `confirm=true`** |
| `timeline` | 按天聚合的变更摘要 |
| `autosnap_prune` | 手动剪枝，丢弃超出上限的旧记录 |
| `autosnap_retention` | 查看或修改保留上限（默认 300） |
| `purge_autosnap` | 清空全部自动快照 —— **需 `confirm=true`** |

### history / history_preview

```
path:    只看该文件（可选）
limit:   返回条数
offset:  跳过前 N 条
only_active:  只看未回滚的，默认 true（仅 history_preview）
```

### revert_to

```
from_id:  起始记录 id
confirm:  必须为 true
```

从新到旧撤销。**不可逆。**

---

## 四、版本快照

| 工具 | 说明 |
|---|---|
| `stage` | 暂存区：`add_all` / `add` / `remove` / `show` / `clear` |
| `commit` | 提交为版本节点（显示版本号必须唯一） |
| `history_nodes` | 分页列出历史版本，最新在前 |
| `files_at` | 某版本的文件树 |
| `read_at` | 读某版本中的某个文件 |
| `diff` | 版本 vs 工作区，或两版本互比 |
| `rollback` | 回滚到某版本并删除其后节点 —— **需 `confirm=true`** |
| `pull` | 把某版本的文件树拉到物理目录，不改工作区 |

### stage

```
action:  add_all / add / remove / show / clear
path:    add 或 remove 时的虚拟路径
```

### commit

```
display_version:  显示版本号，必须唯一，如 1.0.0
description:      版本说明（可选）
author:           作者（可选）
```

### diff

```
display_version:  对比该版本与当前工作区
left_version:     区间左边界（与 right_version 配合）
right_version:    区间右边界
```

### rollback

```
display_version:  目标版本号
confirm:          必须为 true
keep_history:     保留后续节点（默认删除）
```

### pull

```
display_version:  显示版本号
output_path:      输出目录绝对路径
```

不改变当前项目，只是导出。

---

## 五、编译与传输

| 工具 | 说明 |
|---|---|
| `tsc` | 编译 TS 项目：落地虚拟文件 → 跑编译 → 产物回写 → 清理 |
| `tsc_check` | 检查 `tsc` 是否可用及版本 |
| `upload` | 物理文件上传进虚拟文件系统，自动识别文本/二进制 |
| `upload_dir` | 递归上传物理目录，保留结构 |
| `export` | 虚拟文件导出到 `opt/` 物理落地区 |
| `import` | 从 `opt/` 导回虚拟文件系统 |
| `list_opt` | 列 `opt/` 内容 |

### tsc

```
extra_args:  额外 tsc 参数
timeout_ms:  超时毫秒，默认 180000
```

**只能用于 `ts` / `toolpkg-ts` 项目**，其他类型会直接报错。

返回：

```json
{
  "ok": true,
  "exitCode": 0,
  "output": "",
  "written": ["mydata/dist/main.js"],
  "durationMs": 873,
  "cleaned": true
}
```

失败时：

```json
{
  "ok": false,
  "exitCode": 2,
  "output": "src/bad.ts(2,17): error TS2304: Cannot find name 'NotExistType'.",
  "written": ["mydata/dist/bad.js"]
}
```

> **`exitCode` 才是判定标准。** 编译失败时 tsc 仍会输出部分 `.js`，`written` 非空不代表成功。

工作流程：虚拟文件落地到 `.devtool/tsc_tmp/`，在真实目录里跑 tsc，产物读回来写入 `storage.db`，最后清理临时目录。

### upload / upload_dir

```
local_path:    源文件绝对路径（upload）
local_dir:     源目录绝对路径（upload_dir）
virtual_path:  目标虚拟路径
virtual_dir:   目标虚拟目录，默认 /mydata
description:   说明（必填）
overwrite:     是否覆盖
```

### export / import

```
# export
virtual_path:  要导出的虚拟路径，默认整个 /mydata
target_dir:    目标虚拟目录，默认 /mydata/export
overwrite:     是否覆盖

# import
physical_path: opt 下相对或绝对路径
virtual_dir:   目标虚拟目录
description:   说明（必填）
overwrite:     是否覆盖
```

`export` 是**唯一会写你物理存储的常规工具**。

---

## 六、opm 集成

| 工具 | 说明 |
|---|---|
| `opm_init` | 初始化 npm 工程 |
| `opm_search` | 在 registry 中搜索包 |
| `opm_install` | 安装依赖（清单回写，`node_modules` 不写回） |
| `opm_remove` | 卸载依赖 |
| `opm_license` | 生成 LICENSE 并给入口源码加 SPDX 头 |
| `opm_changelog` | 生成或更新 CHANGELOG |
| `opm_build` | 打包成 `.toolpkg` |
| `opm_verify` | 校验工程，不产出文件 |
| `opm_pack` | 打成 npm 兼容的 `.tgz` |
| `opm_version` | 列出已装包与版本 |

### opm_build

```
skip_compile:           跳过编译
out_name:               产物名
out_dir:                产物目录
extra_files:            额外打包路径
PACKINFO:               打包信息核对配置
USECHANGELOG:           是否打包 CHANGELOG
extract_node_modules:   是否把 node_modules 提取进库，默认 true
dependency_max_mb:      依赖提取体积上限（MB），默认 100
```

流程：编译 → 校验 → 可达性分析 → 打包。产物回写到虚拟文件系统的 `mydata/opmbuild/`。

### PACKINFO

给市场审核用的核对文件，可选。结构：

```json
{ "enable": true, "license": "GPL-3.0-or-later", "author": "yyy" }
```

`enable: true` 才生成。字段顺序固定：`name → description → id → version → author → license → dependencies`。依赖由可达性分析自动收集，不用手填。

### opm_version

```
project_dir:     物理项目目录（可选，注意这是物理路径）
include_global:  一并列出全局包
```

---

## 七、参数速查

| 参数 | 类型 | 出现在 |
|---|---|---|
| `package_id` | string | 几乎所有工具 |
| `path` / `virtual_path` | string | 文件类工具 |
| `description` | string | 所有写操作（必填） |
| `confirm` | boolean | `revert_to` / `rollback` / `purge_autosnap` |
| `confirm_id` | string | `destroy` / `archive` |
| `overwrite` | boolean | `upload` / `export` / `import` |
| `recursive` | boolean | `delete` / `list` |
| `legend_version` | string | 版本类工具 |

---

# Tools Reference

All 50 tools, grouped by purpose. Every tool belongs to the `devtool` subpackage
and is called as `devtool:<name>`.

## Conventions

- Every tool takes `package_id` unless noted.
- Paths are **virtual** (`/mydata/...`), never physical.
- Write operations require `description`; it shows up in snapshot records.

## Project lifecycle

`init`, `init_questionnaire`, `metadata`, `capabilities`, `status`, `list_projects`,
`destroy`, `archive`.

`destroy` and `archive` go through the consent gate — see [consent.md](consent.md).

## Virtual filesystem

`read`, `write`, `delete`, `apply_file`, `grep`, `sed`, `list`, `stat`.

`apply_file` errors on zero or multiple matches by design: a silent no-op would let the caller
believe a change landed, and an ambiguous match would damage an unrelated region.

## Auto snapshots

`history`, `history_preview`, `show_record`, `revert`, `revert_to`, `timeline`,
`autosnap_prune`, `autosnap_retention`, `purge_autosnap`.

Every write records one automatically. `revert_to` and `purge_autosnap` are irreversible and
require `confirm=true`.

## Version snapshots

`stage`, `commit`, `history_nodes`, `files_at`, `read_at`, `diff`, `rollback`, `pull`.

Auto snapshots are fine-grained and get pruned; versions are milestones and persist.
`rollback` is irreversible and requires `confirm=true`.

## Compile and transfer

`tsc`, `tsc_check`, `upload`, `upload_dir`, `export`, `import`, `list_opt`.

`tsc` works only on `ts` / `toolpkg-ts` projects. **Judge success by `exitCode === 0`, not by
whether artifacts were produced** — tsc emits partial `.js` files even when type checking
fails.

`export` is the only routine tool that writes to physical storage.

## opm integration

`opm_init`, `opm_search`, `opm_install`, `opm_remove`, `opm_license`, `opm_changelog`,
`opm_build`, `opm_verify`, `opm_pack`, `opm_version`.

`opm_build` accepts `PACKINFO` to emit a market audit file and `USECHANGELOG` to bundle the
changelog. Dependencies in PACKINFO are derived from reachability analysis — do not fill them
in by hand.