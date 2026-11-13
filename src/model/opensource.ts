// SPDX-FileCopyrightText: 2026 yyswys-yjyj
// SPDX-License-Identifier: GPL-3.0-or-later
//
// 开源许可清单：本项目实际使用 / 依赖的第三方作品。
//
// 【只列我们真正用到的】
//   这份清单不是「把能想到的开源项目都写上」，而是逐条对着代码核过的。
//   没引入的（比如 overmem 用的 OkHttp、segmentit 中文分词）一律不列，
//   列了就是虚假披露，比不列更糟。
//
// 【三种关系要分清】
//   1) 直接依赖：代码里 require / import，运行时真的跑（node.operit、TypeScript、SQLite）
//   2) 工具集成：不链接其代码，但把它的能力重写成自己的工具，运行时调它（opm）
//   3) 设计参照：读过它的实现与踩坑记录并借鉴，代码不互相调用（version_snapshot）
//   三者披露措辞必须不同，否则等于把"参考"说成"依赖"，对原作者不公。
//
// 核对依据：
//   - @serveryyswys/node.operit   → package.json dependencies，util/files.ts 里 require 它（Apache-2.0）
//   - TypeScript                  → package.json devDependencies，tsc 编译（Apache-2.0）
//   - Android SQLite              → util/sqlite.ts 里 Java.type('android.database.sqlite.SQLiteDatabase')
//   - OperitPackageManager (opm)  → src/tools/opmTools.ts 整套照其能力重写，运行时调用（GPL-3.0-or-later）
//   - version_snapshot            → util/sqlite.ts 头注释明确写了"沿用 snapshotver 踩过的坑"（GPL-3.0）
//   - AndroidX Compose Material3  → ctx.UI.* 全部走宿主 Compose DSL
//   - AndroidX Material Icons     → ctx.UI.Icon({ name: '...' })
//   - QuickJS                     → Operit 内部 JS 运行时，我们的 dist/*.js 在它上面跑
//   - Operit AI                   → 宿主平台本身

/** 许可证类型（决定徽标配色） */
export type LicenseKind = 'GPL-3.0' | 'LGPL-3.0' | 'Apache-2.0' | 'MIT';

/** 一个第三方作品的披露信息 */
export interface LibInfo {
  /** 作品名 */
  name: string;
  /** 版权人 */
  author: string;
  /** SPDX 标识或简写 */
  license: string;
  /** 徽标配色用的许可证类别 */
  kind: LicenseKind;
  /** 在本项目里干什么用的（措辞必须准确反映真实关系） */
  usage: string;
  /** 主页 / 仓库（可选，有就渲染成可点的行） */
  url?: string;
}

/** 分区：本项目 / 宿主平台 / 直接依赖 / 工具与参照 / 经平台间接使用 */
export interface LibSection {
  /** 分区标题 */
  title: string;
  /** 标题图标（m3 图标名） */
  icon: string;
  /** 标题强调色（不给就用主题色） */
  color?: string;
  /** 分区说明（可选） */
  note?: string;
  items: LibInfo[];
}

/** 本项目信息 */
export const SELF_INFO = {
  name: 'ToolpkgDev',
  packageId: 'com.operit.serveryyswys.toolpkgdev',
  author: 'Copyright (C) 2026 yyswys-yjyj',
  license: 'GPL-3.0-or-later',
  version: '1.0.0',
  repoUrl: 'https://github.com/serveryyswys',
  desc: '给 AI 用的一整套完整 Toolpkg IDE：虚拟文件系统存于 storage.db，自带细粒度自动快照、版本快照、tsc 编译、opm 打包集成与询问制危险操作守卫。'
};

/** 开源许可分区清单 */
export const LIB_SECTIONS: LibSection[] = [
  {
    title: '宿主平台',
    icon: 'smart_toy',
    color: '#FF6640',
    items: [
      {
        name: 'Operit AI',
        author: 'Copyright (C) AAswordman',
        license: 'LGPL-3.0-only',
        kind: 'LGPL-3.0',
        usage: '宿主平台。本插件的 ToolPkg 运行时、Compose DSL 界面、Hook 注册与工具调用全部由它提供。',
        url: 'https://github.com/AAswordman/Operit'
      }
    ]
  },
  {
    title: '直接依赖',
    icon: 'link',
    note: '代码中直接引用、运行时真实执行的库。',
    items: [
      {
        name: '@serveryyswys/node.operit',
        author: 'Copyright (C) 2026 serveryyswys',
        license: 'Apache-2.0',
        kind: 'Apache-2.0',
        usage: '运行时依赖。为 Operit 的 CommonJS 运行时补齐 Node 核心能力；本项目用它提供的原生 fs 层读写虚拟文件、日志与 pending 记录，绕开宿主 fs 垫片写深路径静默失败的问题。',
        url: 'https://github.com/serveryyswys/node.operit'
      },
      {
        name: 'TypeScript',
        author: 'Copyright Microsoft Corporation',
        license: 'Apache-2.0',
        kind: 'Apache-2.0',
        usage: '开发语言与编译器。本项目源码全部用 TypeScript 编写，经 tsc 编译为 JavaScript 后打进 toolpkg。',
        url: 'https://github.com/microsoft/TypeScript'
      },
      {
        name: 'Android SQLite',
        author: 'Copyright The Android Open Source Project',
        license: 'Apache-2.0',
        kind: 'Apache-2.0',
        usage: '本地数据库引擎。项目的虚拟文件系统、自动快照、版本快照全部持久化在 storage.db 中，经 Java Bridge 调用 SQLiteDatabase。',
        url: 'https://developer.android.com/reference/android/database/sqlite/package-summary'
      }
    ]
  },
  {
    title: '工具集成与设计参照',
    icon: 'build',
    color: '#7E57C2',
    note: '这两个项目的代码不与本项目互相链接，但本项目的构建链与快照能力建立在其公开设计与踩坑记录之上，特此致谢。',
    items: [
      {
        name: 'OperitPackageManager (opm)',
        author: 'Copyright (C) serveryyswys / yyswys-yjyj',
        license: 'GPL-3.0-or-later',
        kind: 'GPL-3.0',
        usage: '构建工具集成。本项目的 opm_* 系列工具（init / install / build / verify / pack / license / changelog / version）照其能力重写，运行时调用其命令行与工具链接口完成编译、校验与打包。',
        url: 'https://github.com/yyswys-yjyj/OperitPackageManager'
      },
      {
        name: 'com.operit.version_snapshot',
        author: 'Copyright (C) yyswys-yjyj',
        license: 'GPL-3.0',
        kind: 'GPL-3.0',
        usage: '设计参照。本项目的自动快照与版本快照机制借鉴了它的数据模型与实现思路；util/sqlite.ts 中关于 SQLite 参数绑定与 BigInt 往返的处理，明确沿用了它踩过的坑。代码层面不互相调用。',
        url: 'https://github.com/yyswys-yjyj/com.operit.version_snapshot'
      }
    ]
  },
  {
    title: '经平台间接使用',
    icon: 'extension',
    note: '以下组件由 Operit 平台内部使用，本插件通过其接口间接受益，此处仅作透明披露。',
    items: [
      {
        name: 'AndroidX Compose Material3',
        author: 'Copyright Google LLC / The Android Open Source Project',
        license: 'Apache-2.0',
        kind: 'Apache-2.0',
        usage: 'Compose DSL 底层 UI 组件（Card、Button、LazyColumn、Switch、TextField 等），本插件所有界面都建立在它之上。',
        url: 'https://developer.android.com/jetpack/compose'
      },
      {
        name: 'AndroidX Material Icons',
        author: 'Copyright Google LLC',
        license: 'Apache-2.0',
        kind: 'Apache-2.0',
        usage: '图标资源。ctx.UI.Icon({ name: \'...\' }) 的图标名全部来自这套图标集。',
        url: 'https://fonts.google.com/icons'
      },
      {
        name: 'QuickJS',
        author: 'Copyright Fabrice Bellard and Charlie Gordon',
        license: 'MIT',
        kind: 'MIT',
        usage: 'Operit 内部 JavaScript 运行时。本插件编译后的 dist/*.js 在其上执行。',
        url: 'https://quickjs.org/'
      }
    ]
  }
];

/** 完整许可证文本的外链 */
export const LICENSE_LINKS = [
  { label: 'GNU GPL v3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.txt' },
  { label: 'GNU LGPL v3.0', url: 'https://www.gnu.org/licenses/lgpl-3.0.txt' },
  { label: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.txt' },
  { label: 'MIT License', url: 'https://opensource.org/licenses/MIT' }
];

/** 许可证 → 徽标配色 */
export function licenseColor(kind: LicenseKind): string {
  if (kind === 'GPL-3.0') return '#C62828';
  if (kind === 'LGPL-3.0') return '#FF6640';
  if (kind === 'Apache-2.0') return '#1565C0';
  return '#2E7D32'; // MIT
}
