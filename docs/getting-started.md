# 快速上手

从零到出包，走一遍完整流程。

---

## 0. 装好之后

打开 Operit 工具箱，找到 **ToolpkgDev**，点进去。

第一件事：进 **环境检查**。

它会检查四类东西：

| 检查项 | 说明 | 缺了会怎样 |
|---|---|---|
| `opm` 构建工具 | 打包和依赖管理 | 无法出包 |
| `tsc` 编译器 | TypeScript 编译 | TS 项目无法编译 |
| 目录可写 | `dev_package` 与 `cleanOnExit` | 项目建不出来 |
| `node.operit` 依赖 | 原生文件读写层 | 深层路径写入会静默失败 |

全绿就可以开工。有红的，按提示装对应工具。

---

## 1. 建项目

告诉 AI：

> 帮我建一个 ToolPkg 项目，包名 `com.example.myplugin`，用 TypeScript

AI 会调 `init`：

```
package_id: com.example.myplugin
type: toolpkg-ts
```

生成：

```
dev_package/com.example.myplugin/
├── storage.db          ← 虚拟文件系统（你的代码在这里面）
├── metadata.json       ← 项目元信息
├── .devtool/           ← 工具链临时目录
└── opt/                ← 导出落地区
```

数据库里的初始文件：

```
/mydata/manifest.json
/mydata/tsconfig.json
/mydata/src/main.ts
/mydata/src/packages/myplugin.ts
```

> **想让用户自己填参数？** 用 `init_questionnaire`，它返回一个表单，用户填完再建。

### 四种项目类型怎么选

| 类型 | 适合 | 能编译 TS | 能打包 |
|---|---|---|---|
| `js` | 单文件脚本 | — | — |
| `ts` | TypeScript 脚本 | ✓ | — |
| `toolpkg-js` | 完整插件，JS 写 | — | ✓ |
| `toolpkg-ts` | 完整插件，TS 写 | ✓ | ✓ |

**做完整插件就选 `toolpkg-ts`**，除非你明确只想用 JS。

---

## 2. 写代码

### 全量写

内容不多时直接写：

```
devtool:write
  package_id: com.example.myplugin
  path: /mydata/src/main.ts
  content: <完整文件内容>
  description: "初始化入口文件"
```

`write` 会**覆盖**整个文件。每次写入自动存一条快照。

### 局部改

已有文件只想改一段，用 `apply_file`：

```
devtool:apply_file
  package_id: com.example.myplugin
  path: /mydata/src/main.ts
  old: "// 这里原来是什么"
  new: "// 改成什么"
  description: "加上剪贴板工具"
```

**`old` 必须精确匹配且唯一命中**：

- 0 处匹配 → 报错（说明你记错了原文）
- 多处匹配 → 报错（需要传 `occurrence` 指定第几处）

这个严格性是故意的 —— 它保证「改 A 不会顺手碰到 B」。

### 先看清楚再改

改之前先读：

```
devtool:read  package_id=... path=/mydata/src/main.ts
```

文件大时按行切片：

```
devtool:read  package_id=... path=... offset=100 limit=50
```

想全局搜索：

```
devtool:grep  package_id=... pattern="registerToolPkg" include=ts
```

批量替换（**先预览**）：

```
devtool:sed  package_id=... find="旧" replace="新" paths=/mydata/src
             action=preview
```

`preview` 只返回 diff 不落库。确认没问题再改 `action=apply`，此时必须给 `description`。

---

## 3. 改坏了怎么办

### 立刻回退一步

```
devtool:history_preview  package_id=...
```

看变更流水，找到要退的那条，然后：

```
devtool:revert  package_id=... id=<记录id>
```

回滚本身也会记一条新记录，所以「回滚的回滚」也成立。

### 退回更早

```
devtool:revert_to  package_id=... from_id=<起点id> confirm=true
```

撤销该记录之后的所有变更。**不可逆，必须 `confirm=true`。**

### 重要节点存版本

自动快照是细粒度的、会被剪枝；重要节点应该存成版本：

```
devtool:stage   package_id=... action=add_all
devtool:commit  package_id=... display_version=1.0.0 description="第一个能跑的版本"
```

之后随时：

```
devtool:history_nodes   package_id=...                          # 看所有版本
devtool:diff            package_id=... display_version=1.0.0    # 和工作区比
devtool:rollback        package_id=... display_version=1.0.0 confirm=true
```

---

## 4. 编译

```
devtool:tsc  package_id=com.example.myplugin
```

成功：

```json
{ "ok": true, "exitCode": 0, "written": ["/mydata/dist/main.js"] }
```

失败：

```
编译失败（exitCode 2）：src/bad.ts(2,17): error TS2304: Cannot find name 'NotExistType'.
```

**失败时 `exitCode` 是真实退出码，`output` 是完整编译器输出**，包含文件、行、列、错误码 —— 直接拿去改就行。

产物写回虚拟文件系统，通常在 `/mydata/dist/`。

> **注意**：`tsc` 报错时仍可能产出部分 `.js` 文件（TypeScript 的默认行为）。
> 判断「编译成功」只看 `exitCode === 0`，不要看有没有产物。

---

## 5. 打包

```
devtool:opm_build  package_id=com.example.myplugin
```

流程：编译 → 校验 → 收集可达文件 → 打包。

产物路径在返回值的 `toolpkg_path`，同时回写到虚拟文件系统的 `/mydata/opmbuild/`。

想先干跑校验不产文件：

```
devtool:opm_verify  package_id=com.example.myplugin
```

---

## 6. 导出到物理目录

```
devtool:export  package_id=com.example.myplugin
```

虚拟 `/mydata/x` 会落到 `dev_package/com.example.myplugin/opt/mydata/x`。

**这一步是唯一会写你物理存储的动作**，前五步都只在数据库里操作。

---

## 完整示例

```
# 建项目
devtool:init  package_id=com.example.hello  type=toolpkg-ts

# 看模板长什么样
devtool:read  package_id=com.example.hello  path=/mydata/src/main.ts

# 写自己的入口
devtool:write  package_id=com.example.hello  path=/mydata/src/main.ts
  content=<内容>  description="写入口"

# 编译
devtool:tsc  package_id=com.example.hello

# 有错就改，对了就打包
devtool:opm_build  package_id=com.example.hello

# 存个版本
devtool:stage   package_id=com.example.hello  action=add_all
devtool:commit  package_id=com.example.hello  display_version=1.0.0

# 导出
devtool:export  package_id=com.example.hello
```

---

## 注意事项

- **所有路径用虚拟路径** `/mydata/...`，不是物理路径
- **写操作必须给 `description`** —— 这是给未来的你看的
- **`apply_file` 匹配严格**，`old` 要够长够独特
- **`tsc` 失败看 `exitCode`**，不要看有没有产物
- **只有 `export` / `upload` 会碰物理存储**，其余都在数据库里

---

# Getting Started

From zero to a built package.

## 0. After install

Open the Operit toolbox, find **ToolpkgDev**, and enter it. Start with **Environment Check**.

It verifies four things: `opm` availability, `tsc` availability, writable directories, and the
`node.operit` dependency. All green means you are ready.

## 1. Create a project

> Create a ToolPkg project named `com.example.myplugin`, in TypeScript.

The AI calls `init` with `type: toolpkg-ts`. This creates `storage.db`, `metadata.json`,
`.devtool/` and `opt/`, and seeds the virtual filesystem with:

```
/mydata/manifest.json
/mydata/tsconfig.json
/mydata/src/main.ts
/mydata/src/packages/myplugin.ts
```

Use `init_questionnaire` instead if you want the user to fill in the parameters themselves.

**Project types:** `js` and `ts` are plain scripts; `toolpkg-js` and `toolpkg-ts` are full
plugins. Only TS types support `tsc`; only toolpkg types support `opm_build`.

## 2. Write code

`write` replaces the whole file. `apply_file` replaces one exact fragment — it errors on zero
or multiple matches, which is deliberate: it guarantees a change to A cannot silently touch B.
Use `read` with `offset`/`limit` for large files, `grep` to search, and `sed` with
`action=preview` to see a diff before committing a bulk replace.

Every write records an auto snapshot automatically.

## 3. When you break something

- `history_preview` lists changes; `revert` undoes one; `revert_to` undoes everything from a
  point onward (irreversible, needs `confirm=true`).
- For milestones, use version snapshots: `stage` then `commit`. Browse with `history_nodes`,
  compare with `diff`, move with `rollback`.

## 4. Compile

`tsc` materializes the virtual tree, runs the compiler, and writes artifacts back.

On success: `{ "ok": true, "exitCode": 0 }`. On failure you get the real exit code and the
complete compiler output, including file, line, column and error code.

**Judge success by `exitCode === 0`, never by the presence of artifacts** — tsc emits partial
`.js` files even when type checking fails.

## 5. Package

`opm_build` compiles, validates, collects reachable files and packs. The artifact path is
returned as `toolpkg_path`. Use `opm_verify` for a dry run that writes nothing.

## 6. Export

`export` writes virtual files out to `opt/mydata/...`. **This is the only step that touches
physical storage** — everything before it happens inside the database.

## Notes

- Paths are virtual (`/mydata/...`), not physical.
- Writes require `description`.
- Only `export` and `upload` touch the real filesystem.