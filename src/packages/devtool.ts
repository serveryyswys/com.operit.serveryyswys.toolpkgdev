/*
METADATA
{
  "name": "devtool",
  "description": {
    "zh": "供 AI 使用的 Operit Package IDE，更安全的 Operit 插件开发工具集，从项目初始化，到代码编写，再到版本管理、构建打包，一站式完成所有开发工作。特点：采用虚拟空间，与用户物理空间隔离，保证便携性和灵活性；拥有自动快照功能，代码改错了？代码改炸了？没关系，回滚快照后又能继续工作。",
    "en": "Operit Package IDE for AI use - a safer plugin development toolkit that covers everything from project initialization to code writing, version control, and build packaging in one stop. Features: Uses virtual spaces to isolate from the user's physical space, ensuring portability and flexibility; includes automatic snapshot functionality - code error? Code crash? No worries, just roll back to a snapshot and pick up where you left off."
  },
  "enabledByDefault": true,
  "env": [],
  "tools": [
    {
      "name": "init",
      "description": {
        "zh": "初始化开发项目。在 dev_package/{package_id}/ 下生成 storage.db、.devtool/、metadata.json，写入对应类型模板（js / ts / toolpkg-js / toolpkg-ts），并登记到注册表。选开源许可证会下载 SPDX 官方全文写入 LICENSE。",
        "en": "Initialize a project: creates storage.db, .devtool/ and metadata.json, writes type templates, registers the project. Open-source licenses download the official SPDX text to LICENSE."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名，也是项目目录名", "en": "Package id / project dir name" }, "type": "string", "required": true },
        { "name": "type", "description": { "zh": "js / ts / toolpkg-js / toolpkg-ts", "en": "js / ts / toolpkg-js / toolpkg-ts" }, "type": "string", "required": true },
        { "name": "display_name", "description": { "zh": "显示名", "en": "Display name" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "插件描述", "en": "Description" }, "type": "string", "required": false },
        { "name": "author", "description": { "zh": "作者名", "en": "Author" }, "type": "string", "required": false },
        { "name": "license", "description": { "zh": "SPDX 标识，如 MIT / Apache-2.0；UNLICENSED 表示不写许可证", "en": "SPDX id; UNLICENSED for none" }, "type": "string", "required": false },
        { "name": "force", "description": { "zh": "项目已存在时是否覆盖", "en": "Overwrite existing" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "metadata",
      "description": {
        "zh": "读取或修改项目 metadata。可改：type（js/ts/toolpkg-js/toolpkg-ts）、display_name、description、author、license。不可改：包名/项目名（与目录路径绑定）、createdAt、schemaVersion。不传任何可改字段时为查询模式。",
        "en": "Read or update project metadata. Editable: type, display_name, description, author, license. Not editable: package id / project name (bound to directory path), createdAt, schemaVersion. With no editable field it acts as a query."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名（项目标识，不可改）", "en": "Package id (immutable project identifier)" }, "type": "string", "required": true },
        { "name": "type", "description": { "zh": "新的项目类型：js / ts / toolpkg-js / toolpkg-ts", "en": "New project type" }, "type": "string", "required": false },
        { "name": "display_name", "description": { "zh": "显示名", "en": "Display name" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "项目描述", "en": "Description" }, "type": "string", "required": false },
        { "name": "author", "description": { "zh": "作者", "en": "Author" }, "type": "string", "required": false },
        { "name": "license", "description": { "zh": "SPDX 许可证标识", "en": "SPDX license id" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "capabilities",
      "description": {
        "zh": "查看某项目的能力矩阵：tsc 是否可用（仅 ts / toolpkg-ts）、opm 是否可用（仅 toolpkg-js / toolpkg-ts），并说明不可用原因。",
        "en": "Show a project's capability matrix: whether tsc is available (ts / toolpkg-ts only) and opm is available (toolpkg-js / toolpkg-ts only), with reasons when unavailable."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "init_questionnaire",
      "description": {
        "zh": "生成初始化问卷。返回的 xml 字段可直接输出，由 Operit 渲染给用户填写，把项目参数决定权交给用户。",
        "en": "Generate an init questionnaire. Output the xml for Operit to render so the user decides the parameters."
      },
      "parameters": []
    },
    {
      "name": "status",
      "description": {
        "zh": "查看项目状态：metadata、注册情况、各路径、db 统计。",
        "en": "Show project status: metadata, registration, paths, db stats."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "list_projects",
      "description": {
        "zh": "列出注册表里所有由本工具创建的项目。",
        "en": "List all projects created by this toolkit."
      },
      "parameters": []
    },
    {
      "name": "destroy",
      "description": {
        "zh": "整包摧毁：删除项目目录（含 storage.db、.devtool、opt、metadata.json）并从注册表移除，不可恢复。默认走询问制：首次调用只生成确认请求并返回 confirm_id 与 XML；用户确认后再带 confirm_id 调用一次才真正执行。",
        "en": "Destroy a whole project: delete its directory (storage.db, .devtool, opt, metadata.json) and unregister it. Irreversible. Asks for confirmation by default: first call returns a confirm_id plus XML; call again with confirm_id after the user approves."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "confirm_id", "description": { "zh": "用户已批准的确认记录 id（首次调用不传）", "en": "Approved confirm id (omit on first call)" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "archive",
      "description": {
        "zh": "整包归档 / 取消归档。归档只写标记文件不动数据：归档后读类工具仍可用、写类工具会拒绝。mode=archive（默认）走询问制，mode=unarchive 直接执行。force=true 可跳过确认。",
        "en": "Archive or unarchive a project. Archiving only writes a marker: reads still work, writes are refused. mode=archive (default) asks for confirmation; mode=unarchive runs directly. force=true skips confirmation."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "mode", "description": { "zh": "archive（默认）/ unarchive", "en": "archive (default) / unarchive" }, "type": "string", "required": false },
        { "name": "note", "description": { "zh": "归档说明（可选）", "en": "Archive note" }, "type": "string", "required": false },
        { "name": "force", "description": { "zh": "跳过确认直接归档", "en": "Skip confirmation" }, "type": "boolean", "required": false },
        { "name": "confirm_id", "description": { "zh": "用户已批准的确认记录 id", "en": "Approved confirm id" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "read",
      "description": {
        "zh": "读取虚拟文件。文本支持 offset/limit 按行切片；二进制返回 base64 且 isBinary=true。",
        "en": "Read a virtual file. Text supports offset/limit; binary returns base64."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径，如 /mydata/src/main.ts", "en": "Virtual path" }, "type": "string", "required": true },
        { "name": "offset", "description": { "zh": "起始行（0 起，仅文本）", "en": "Start line (text only)" }, "type": "number", "required": false },
        { "name": "limit", "description": { "zh": "读取行数（仅文本）", "en": "Line count (text only)" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "write",
      "description": {
        "zh": "写入虚拟文件（自动记自动快照）。文本用 content，二进制用 content_base64。必须提供 description。",
        "en": "Write a virtual file (records autosnapshot). content for text, content_base64 for binary. description required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true },
        { "name": "content", "description": { "zh": "文本内容", "en": "Text content" }, "type": "string", "required": false },
        { "name": "content_base64", "description": { "zh": "二进制 base64", "en": "Binary base64" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "本次写入说明（必填）", "en": "Description (required)" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "delete",
      "description": {
        "zh": "删除虚拟文件或目录（自动记快照）。目录非空需 recursive=true。必须提供 description。",
        "en": "Delete a virtual file/dir (records autosnapshot). Non-empty dirs need recursive=true. description required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true },
        { "name": "description", "description": { "zh": "本次删除说明（必填）", "en": "Description (required)" }, "type": "string", "required": true },
        { "name": "recursive", "description": { "zh": "是否递归", "en": "Recursive" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "apply_file",
      "description": {
        "zh": "补丁式修改：把 old 片段替换为 new。0 处或多处匹配都报错，多处可用 occurrence 指定。必须提供 description。",
        "en": "Patch edit: replace old with new. Zero/multiple matches error; use occurrence. description required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true },
        { "name": "old", "description": { "zh": "原文片段", "en": "Original snippet" }, "type": "string", "required": true },
        { "name": "new", "description": { "zh": "新内容", "en": "New content" }, "type": "string", "required": false },
        { "name": "occurrence", "description": { "zh": "第几处（1 起）", "en": "Occurrence (1-based)" }, "type": "number", "required": false },
        { "name": "description", "description": { "zh": "本次修改说明（必填）", "en": "Description (required)" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "grep",
      "description": {
        "zh": "虚拟文件正则搜索（纯查询，不记快照），二进制自动跳过。",
        "en": "Regex search across virtual files (read-only). Binary skipped."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "pattern", "description": { "zh": "正则或字面量", "en": "Regex or literal" }, "type": "string", "required": true },
        { "name": "fixed", "description": { "zh": "字面量匹配", "en": "Literal" }, "type": "boolean", "required": false },
        { "name": "ignore_case", "description": { "zh": "忽略大小写", "en": "Case-insensitive" }, "type": "boolean", "required": false },
        { "name": "paths", "description": { "zh": "限定路径前缀", "en": "Path prefixes" }, "type": "string", "required": false },
        { "name": "include", "description": { "zh": "只搜这些扩展名", "en": "Include extensions" }, "type": "string", "required": false },
        { "name": "exclude", "description": { "zh": "排除这些扩展名", "en": "Exclude extensions" }, "type": "string", "required": false },
        { "name": "max_results", "description": { "zh": "匹配条数上限", "en": "Max matches" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "sed",
      "description": {
        "zh": "批量正则替换。action=preview 只返回 unified diff 不落库；action=apply 才写入且必须给 description。",
        "en": "Batch regex replace. preview returns a diff only; apply writes and requires description."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "find", "description": { "zh": "查找内容", "en": "Find" }, "type": "string", "required": true },
        { "name": "replace", "description": { "zh": "替换成", "en": "Replace" }, "type": "string", "required": false },
        { "name": "paths", "description": { "zh": "作用路径前缀", "en": "Target prefixes" }, "type": "string", "required": true },
        { "name": "action", "description": { "zh": "preview（默认）/ apply", "en": "preview (default) / apply" }, "type": "string", "required": false },
        { "name": "fixed", "description": { "zh": "字面量匹配", "en": "Literal" }, "type": "boolean", "required": false },
        { "name": "ignore_case", "description": { "zh": "忽略大小写", "en": "Case-insensitive" }, "type": "boolean", "required": false },
        { "name": "global", "description": { "zh": "全局替换", "en": "Replace all" }, "type": "boolean", "required": false },
        { "name": "include", "description": { "zh": "只处理这些扩展名", "en": "Include extensions" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "apply 时必填", "en": "Required in apply" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "list",
      "description": {
        "zh": "列虚拟目录；recursive=true 递归列出所有文件。",
        "en": "List a virtual directory; recursive lists all files."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true },
        { "name": "recursive", "description": { "zh": "是否递归", "en": "Recursive" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "stat",
      "description": {
        "zh": "查看虚拟路径元信息（存在性、目录标记、大小、checksum、时间）。",
        "en": "Show metadata of a virtual path."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "history",
      "description": {
        "zh": "查询自动快照变更流水（最新在前），可按 path 过滤。",
        "en": "Query autosnapshot history (newest first), filterable by path."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "只看该文件", "en": "Only this file" }, "type": "string", "required": false },
        { "name": "limit", "description": { "zh": "条数上限", "en": "Max records" }, "type": "number", "required": false },
        { "name": "offset", "description": { "zh": "偏移", "en": "Offset" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "history_preview",
      "description": {
        "zh": "自动快照预览：紧凑列出一条条变更，突出 id 与 description，附带变更类型、路径、尺寸变化。默认只看未回滚的。",
        "en": "Autosnapshot preview: a compact list highlighting id and description, with change type, path and size delta. Shows unreverted records by default."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "只看该文件的变更", "en": "Only this file" }, "type": "string", "required": false },
        { "name": "limit", "description": { "zh": "返回条数，默认 20", "en": "Max items, default 20" }, "type": "number", "required": false },
        { "name": "offset", "description": { "zh": "跳过前 N 条", "en": "Skip N items" }, "type": "number", "required": false },
        { "name": "only_active", "description": { "zh": "只看未回滚的，默认 true", "en": "Only unreverted, default true" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "autosnap_prune",
      "description": {
        "zh": "手动触发一次自动快照剪枝：超出保留上限的旧快照会被丢弃。平时每次写入后已自动剪枝，此工具用于手动整理。",
        "en": "Manually prune autosnapshots: records beyond the retention limit are dropped. Pruning already happens after every write; use this for manual cleanup."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "autosnap_retention",
      "description": {
        "zh": "查看或修改自动快照保留上限（默认 300 条）。传 limit 则修改并立即剪枝；不传则只查询。",
        "en": "View or change the autosnapshot retention limit (default 300). Passing limit updates it and prunes immediately; otherwise just reports."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "limit", "description": { "zh": "新的保留条数上限", "en": "New retention limit" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "show_record",
      "description": {
        "zh": "查看某条自动快照记录的 diff 与前后内容预览。",
        "en": "Show diff and previews of an autosnapshot record."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "id", "description": { "zh": "记录 id", "en": "Record id" }, "type": "number", "required": true }
      ]
    },
    {
      "name": "revert",
      "description": {
        "zh": "回滚某条自动快照，把文件恢复到那次变更之前。回滚本身也会记一条新记录。",
        "en": "Revert one autosnapshot record. The revert is also recorded."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "id", "description": { "zh": "记录 id", "en": "Record id" }, "type": "number", "required": true }
      ]
    },
    {
      "name": "revert_to",
      "description": {
        "zh": "批量回滚：撤销 id >= from_id 的全部自动快照变更（从新到旧）。不可逆，需 confirm=true。",
        "en": "Batch revert changes with id >= from_id (newest first). Irreversible; confirm=true required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "from_id", "description": { "zh": "起始记录 id", "en": "Start record id" }, "type": "number", "required": true },
        { "name": "confirm", "description": { "zh": "必须为 true", "en": "Must be true" }, "type": "boolean", "required": true }
      ]
    },
    {
      "name": "timeline",
      "description": {
        "zh": "自动快照时间线摘要（按天聚合变更条数）。",
        "en": "Autosnapshot timeline summary (changes per day)."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "limit", "description": { "zh": "最多天数", "en": "Max days" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "stage",
      "description": {
        "zh": "版本快照暂存区：action=add_all / add（需 path）/ remove（需 path）/ show / clear。",
        "en": "Version-snapshot staging: add_all / add (path) / remove (path) / show / clear."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "action", "description": { "zh": "add_all / add / remove / show / clear", "en": "add_all / add / remove / show / clear" }, "type": "string", "required": false },
        { "name": "path", "description": { "zh": "add/remove 的虚拟路径", "en": "Path for add/remove" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "commit",
      "description": {
        "zh": "把暂存区提交为版本快照节点。display_version 必须唯一，例如 1.0.0。",
        "en": "Commit staging into a version snapshot node. display_version must be unique."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "显示版本号", "en": "Display version" }, "type": "string", "required": true },
        { "name": "description", "description": { "zh": "版本说明", "en": "Version note" }, "type": "string", "required": false },
        { "name": "author", "description": { "zh": "作者", "en": "Author" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "history_nodes",
      "description": {
        "zh": "分页列出历史版本节点（最新在前）。",
        "en": "Page through version nodes (newest first)."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "page", "description": { "zh": "页码，默认 1", "en": "Page, default 1" }, "type": "number", "required": false },
        { "name": "limit", "description": { "zh": "每页条数，默认 10", "en": "Page size, default 10" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "files_at",
      "description": {
        "zh": "列出某版本里的全部文件。",
        "en": "List all files in a version."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "显示版本号", "en": "Display version" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "read_at",
      "description": {
        "zh": "读取某版本中指定文件的内容。",
        "en": "Read a file's content at a version."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "显示版本号", "en": "Display version" }, "type": "string", "required": true },
        { "name": "path", "description": { "zh": "虚拟路径", "en": "Virtual path" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "diff",
      "description": {
        "zh": "只给 display_version 时对比该版本与当前工作区；给 left_version + right_version 时做区间对比。",
        "en": "Diff a version vs working tree, or compare two versions."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "对比版本号", "en": "Version to diff" }, "type": "string", "required": false },
        { "name": "left_version", "description": { "zh": "区间左边界", "en": "Interval left" }, "type": "string", "required": false },
        { "name": "right_version", "description": { "zh": "区间右边界", "en": "Interval right" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "rollback",
      "description": {
        "zh": "把虚拟文件系统回滚到指定版本并删除其后节点。不可逆，需 confirm=true。",
        "en": "Roll back to a version and drop later nodes. Irreversible; confirm=true required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "目标版本号", "en": "Target version" }, "type": "string", "required": true },
        { "name": "confirm", "description": { "zh": "必须为 true", "en": "Must be true" }, "type": "boolean", "required": true },
        { "name": "keep_history", "description": { "zh": "保留后续节点（默认删除）", "en": "Keep later nodes" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "pull",
      "description": {
        "zh": "把某历史版本的文件树拉到物理目录，不改变当前项目。",
        "en": "Pull a version's tree to a physical directory without changing the project."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "display_version", "description": { "zh": "显示版本号", "en": "Display version" }, "type": "string", "required": true },
        { "name": "output_path", "description": { "zh": "输出目录绝对路径", "en": "Output dir path" }, "type": "string", "required": true }
      ]
    },
    {
      "name": "tsc",
      "description": {
        "zh": "编译 TS 项目：虚拟文件落地到 .devtool/tsc_tmp，隐藏执行器跑 tsc，产物回写虚拟文件系统，再清理临时目录。",
        "en": "Compile TS: materialize into .devtool/tsc_tmp, run tsc via hidden executor, save products back, then clean up."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "extra_args", "description": { "zh": "额外 tsc 参数", "en": "Extra tsc args" }, "type": "string", "required": false },
        { "name": "timeout_ms", "description": { "zh": "超时毫秒，默认 180000", "en": "Timeout ms" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "tsc_check",
      "description": {
        "zh": "检查 tsc 是否可用及版本。",
        "en": "Check tsc availability and version."
      },
      "parameters": []
    },
    {
      "name": "upload",
      "description": {
        "zh": "把物理文件上传进虚拟文件系统（自动识别文本/二进制，记自动快照）。必须提供 description。",
        "en": "Upload a physical file (auto text/binary detection, records autosnapshot). description required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "local_path", "description": { "zh": "源文件绝对路径", "en": "Source file path" }, "type": "string", "required": true },
        { "name": "virtual_path", "description": { "zh": "目标虚拟路径", "en": "Target virtual path" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "说明（必填）", "en": "Description (required)" }, "type": "string", "required": true },
        { "name": "overwrite", "description": { "zh": "是否覆盖", "en": "Overwrite" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "upload_dir",
      "description": {
        "zh": "递归上传物理目录到虚拟文件系统，保留结构。",
        "en": "Recursively upload a physical directory."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "local_dir", "description": { "zh": "源目录绝对路径", "en": "Source dir" }, "type": "string", "required": true },
        { "name": "virtual_dir", "description": { "zh": "目标虚拟目录，默认 /mydata", "en": "Target virtual dir" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "说明（必填）", "en": "Description (required)" }, "type": "string", "required": true },
        { "name": "overwrite", "description": { "zh": "是否覆盖", "en": "Overwrite" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "export",
      "description": {
        "zh": "把虚拟文件导出到 opt 物理落地区：虚拟 /mydata/x 落在 {项目根}/opt/mydata/x。目标已存在默认失败，overwrite=true 才覆盖。",
        "en": "Export virtual files into opt: /mydata/x lands at {project}/opt/mydata/x. Existing targets fail unless overwrite=true."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "virtual_path", "description": { "zh": "要导出的虚拟路径，默认整个 /mydata", "en": "Virtual path to export" }, "type": "string", "required": false },
        { "name": "target_dir", "description": { "zh": "目标虚拟目录，默认 /mydata/export", "en": "Target virtual dir" }, "type": "string", "required": false },
        { "name": "overwrite", "description": { "zh": "是否覆盖", "en": "Overwrite" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "import",
      "description": {
        "zh": "从 opt 物理落地区导入回虚拟文件系统。",
        "en": "Import from opt back into the virtual filesystem."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "physical_path", "description": { "zh": "opt 下相对或绝对路径", "en": "Path under opt" }, "type": "string", "required": true },
        { "name": "virtual_dir", "description": { "zh": "目标虚拟目录", "en": "Target virtual dir" }, "type": "string", "required": false },
        { "name": "description", "description": { "zh": "说明（必填）", "en": "Description (required)" }, "type": "string", "required": true },
        { "name": "overwrite", "description": { "zh": "是否覆盖", "en": "Overwrite" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "list_opt",
      "description": {
        "zh": "列出 opt 物理落地区内容。",
        "en": "List the opt area."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "sub_path", "description": { "zh": "opt 下子路径", "en": "Sub path" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "purge_autosnap",
      "description": {
        "zh": "清空全部自动快照记录。不可逆，需 confirm=true。",
        "en": "Purge all autosnapshots. Irreversible; confirm=true required."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "confirm", "description": { "zh": "必须为 true", "en": "Must be true" }, "type": "boolean", "required": true }
      ]
    },
    {
      "name": "opm_init",
      "description": {
        "zh": "opm 集成：初始化 npm 工程。先落地虚拟文件、跑 opm、再回写。",
        "en": "opm integration: init npm project (materialize, run opm, write back)."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "name", "description": { "zh": "package.json 包名", "en": "Package name" }, "type": "string", "required": false },
        { "name": "version", "description": { "zh": "初始版本", "en": "Initial version" }, "type": "string", "required": false },
        { "name": "source", "description": { "zh": "normal / cch / npm", "en": "normal / cch / npm" }, "type": "string", "required": false },
        { "name": "registry", "description": { "zh": "自定义 registry", "en": "Custom registry" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "opm_search",
      "description": {
        "zh": "opm 集成：在 registry 中搜索包。",
        "en": "opm integration: search packages in a registry."
      },
      "parameters": [
        { "name": "keyword", "description": { "zh": "关键词", "en": "Keyword" }, "type": "string", "required": false },
        { "name": "registry", "description": { "zh": "registry URL", "en": "Registry URL" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "opm_install",
      "description": {
        "zh": "opm 集成：安装依赖（清单回写虚拟文件系统，node_modules 不写回）。",
        "en": "opm integration: install packages (manifests written back; node_modules not)."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "packages", "description": { "zh": "包规格，空格或逗号分隔", "en": "Package specs" }, "type": "string", "required": false },
        { "name": "tgz_path", "description": { "zh": "本地 tgz 路径", "en": "Local tgz path" }, "type": "string", "required": false },
        { "name": "global", "description": { "zh": "是否全局安装", "en": "Global install" }, "type": "boolean", "required": false },
        { "name": "save", "description": { "zh": "是否写入 dependencies", "en": "Save to dependencies" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "opm_remove",
      "description": {
        "zh": "opm 集成：卸载依赖。",
        "en": "opm integration: remove packages."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名（全局模式可不传）", "en": "Package id (optional for global)" }, "type": "string", "required": false },
        { "name": "packages", "description": { "zh": "要卸载的包名", "en": "Packages to remove" }, "type": "string", "required": true },
        { "name": "global", "description": { "zh": "全局卸载", "en": "Global remove" }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "opm_license",
      "description": {
        "zh": "opm 集成：生成 LICENSE 并给入口源码加 SPDX 头。",
        "en": "opm integration: generate LICENSE and stamp SPDX headers."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "type", "description": { "zh": "SPDX 标识，如 MIT", "en": "SPDX id" }, "type": "string", "required": true },
        { "name": "author", "description": { "zh": "版权人", "en": "Copyright holder" }, "type": "string", "required": false },
        { "name": "yearrange", "description": { "zh": "年份或区间", "en": "Year range" }, "type": "string", "required": false },
        { "name": "overwrite", "description": { "zh": "覆盖已有 LICENSE", "en": "Overwrite LICENSE" }, "type": "boolean", "required": false },
        { "name": "custom_content", "description": { "zh": "自定义许可证正文", "en": "Custom license text" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "opm_changelog",
      "description": {
        "zh": "opm 集成：生成/更新 CHANGELOG（英文，Keep a Changelog 规范）。",
        "en": "opm integration: generate/update CHANGELOG (English, Keep a Changelog)."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "version", "description": { "zh": "语义化版本或 unreleased", "en": "Semver or unreleased" }, "type": "string", "required": true },
        { "name": "description", "description": { "zh": "版本简述（英文）", "en": "Version summary (English)" }, "type": "string", "required": false },
        { "name": "content", "description": { "zh": "详细内容对象", "en": "Detailed content object" }, "type": "object", "required": false }
      ]
    },
    {
      "name": "opm_build",
      "description": {
        "zh": "opm 集成：打包成 .toolpkg。产物回写进虚拟文件系统的 mydata/opmbuild。同时会提取 npm 依赖（node_modules + package.json + package-lock.json + .npmrc）进 db，便于下次构建直接复用。",
        "en": "opm integration: build a .toolpkg; products written back to mydata/opmbuild. Also extracts npm dependencies (node_modules + package.json + package-lock.json + .npmrc) into the db for reuse in later builds."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "skip_compile", "description": { "zh": "跳过编译", "en": "Skip compile" }, "type": "boolean", "required": false },
        { "name": "out_name", "description": { "zh": "产物名", "en": "Output name" }, "type": "string", "required": false },
        { "name": "out_dir", "description": { "zh": "产物目录", "en": "Output dir" }, "type": "string", "required": false },
        { "name": "extra_files", "description": { "zh": "额外打包路径", "en": "Extra paths" }, "type": "string", "required": false },
        { "name": "PACKINFO", "description": { "zh": "打包信息核对配置", "en": "PACKINFO config" }, "type": "object", "required": false },
        { "name": "USECHANGELOG", "description": { "zh": "是否打包 CHANGELOG", "en": "Include CHANGELOG" }, "type": "object", "required": false },
        { "name": "extract_node_modules", "description": { "zh": "是否把 node_modules 一起提取进 db，默认 true", "en": "Extract node_modules into db, default true" }, "type": "boolean", "required": false },
        { "name": "dependency_max_mb", "description": { "zh": "依赖提取体积上限（MB），默认 100", "en": "Dependency extraction size cap in MB, default 100" }, "type": "number", "required": false }
      ]
    },
    {
      "name": "opm_verify",
      "description": {
        "zh": "opm 集成：校验工程，不产出文件。",
        "en": "opm integration: verify the project without producing files."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "skip_compile", "description": { "zh": "跳过编译", "en": "Skip compile" }, "type": "boolean", "required": false },
        { "name": "extra_files", "description": { "zh": "额外路径", "en": "Extra paths" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "opm_pack",
      "description": {
        "zh": "opm 集成：打成 npm 兼容的 .tgz。",
        "en": "opm integration: pack into a npm-compatible .tgz."
      },
      "parameters": [
        { "name": "package_id", "description": { "zh": "插件包名", "en": "Package id" }, "type": "string", "required": true },
        { "name": "out_dir", "description": { "zh": "产物目录", "en": "Output dir" }, "type": "string", "required": false },
        { "name": "out_name", "description": { "zh": "产物名", "en": "Output name" }, "type": "string", "required": false }
      ]
    },
    {
      "name": "opm_version",
      "description": {
        "zh": "opm 集成：列出已装包与版本。",
        "en": "opm integration: list installed packages and versions."
      },
      "parameters": [
        { "name": "project_dir", "description": { "zh": "项目目录（物理）", "en": "Physical project dir" }, "type": "string", "required": false },
        { "name": "include_global", "description": { "zh": "包含全局包", "en": "Include global" }, "type": "boolean", "required": false }
      ]
    }
  ]
}
*/

// 工具分发：METADATA 里声明的每个 name 都要在这里挂上实现。
// ToolPkg 的要求是 exports.<toolName> 即工具入口，宿主按 METADATA 的名字调用。

import * as projectTools from '../tools/projectTools';
import * as snapshotTools from '../tools/snapshotTools';
import * as buildTools from '../tools/buildTools';
import * as opmTools from '../tools/opmTools';
import * as lifecycleTools from '../tools/lifecycleTools';

// ---- 项目与文件 ----
export const init = projectTools.init;
export const init_questionnaire = projectTools.initQuestionnaire;
export const status = projectTools.status;
export const metadata = projectTools.metadata;
export const capabilities = projectTools.capabilities;
export const list_projects = projectTools.listProjects;
export const read = projectTools.read;
export const write = projectTools.write;
export const deleteFile = projectTools.del;
export const apply_file = projectTools.applyFile;
export const grep = projectTools.grep;
export const sed = projectTools.sed;
export const list = projectTools.list;
export const stat = projectTools.stat;

// ---- 自动快照 ----
export const history = snapshotTools.history;
export const history_preview = snapshotTools.historyPreview;
export const autosnap_prune = snapshotTools.autosnapPrune;
export const autosnap_retention = snapshotTools.autosnapRetention;
export const show_record = snapshotTools.showRecord;
export const revert = snapshotTools.revert;
export const revert_to = snapshotTools.revertTo;
export const timeline = snapshotTools.timeline;

// ---- 版本快照 ----
export const stage = snapshotTools.stage;
export const commit = snapshotTools.commit;
export const history_nodes = snapshotTools.historyNodes;
export const files_at = snapshotTools.filesAt;
export const read_at = snapshotTools.readAt;
export const diff = snapshotTools.diff;
export const rollback = snapshotTools.rollback;
export const pull = snapshotTools.pull;

// ---- 编译与传输 ----
export const tsc = buildTools.tsc;
export const tsc_check = buildTools.tscCheck;
export const upload = buildTools.upload;
export const upload_dir = buildTools.uploadDir;
export const exportFiles = buildTools.exportFiles;
export const importFiles = buildTools.importFiles;
export const list_opt = buildTools.listOpt;
export const purge_autosnap = buildTools.purgeAutoSnap;

// ---- opm 集成 ----
export const opm_init = opmTools.opmInit;
export const opm_search = opmTools.opmSearch;
export const opm_install = opmTools.opmInstall;
export const opm_remove = opmTools.opmRemove;
export const opm_license = opmTools.opmLicense;
export const opm_changelog = opmTools.opmChangelog;
export const opm_build = opmTools.opmBuild;
export const opm_verify = opmTools.opmVerify;
export const opm_pack = opmTools.opmPack;
export const opm_version = opmTools.opmVersion;

// ---- 生命周期（整包级） ----
export const destroy = lifecycleTools.destroy;
export const archive = lifecycleTools.archive;

// 注意：METADATA 里的 "delete" / "export" / "import" 是保留字，
// ToolPkg 的 exports 上直接写这些名字会与 JS 语法冲突，
// 因此导出名用 deleteFile / exportFiles / importFiles，
// 再用下面的显式赋值把 METADATA 名字映射到真实函数。
const exportsAny: any = exports;
exportsAny['delete'] = projectTools.del;
exportsAny['export'] = buildTools.exportFiles;
exportsAny['import'] = buildTools.importFiles;
