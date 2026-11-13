// 全局路径与常量。零依赖层，其他层都从这里取路径与清单。
/** 本包名（路由、日志目录、注册中心都靠它拼，改包名只改这里一处） */
export const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';

/** Operit 公共下载根 */
export const OPERIT_ROOT = '/storage/emulated/0/Download/Operit';

/** 项目开发区根目录 */
export const DEV_PACKAGE_ROOT = OPERIT_ROOT + '/dev_package';

/** devtool 注册表目录 */
export const REGISTRY_ROOT = OPERIT_ROOT + '/@serveryyswys/devtool';

/** 注册表文件 */
export const REGISTRY_FILE = REGISTRY_ROOT + '/registry.json';

/** 项目内的固定文件名 */
export const DB_FILE = 'storage.db';
export const DEVTOOL_DIR = '.devtool';
export const METADATA_FILE = 'metadata.json';
export const OPT_DIR = 'opt';

/** 虚拟文件系统对外根。虚拟路径 /mydata/x 对应 opt/mydata/x */
export const VIRTUAL_ROOT_PREFIX = '/mydata';

/** tsc 临时落地目录（相对项目根） */
export const TSC_TMP_REL = DEVTOOL_DIR + '/tsc_tmp';

/** 二进制扩展名集合（沿用 snapshotver 判定思路） */
export const BINARY_EXT = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'avif',
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'bz2', 'xz', 'zst',
  'apk', 'dex', 'so', 'a', 'class', 'jar', 'db', 'sqlite', 'sqlite3', 'mdb',
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'bin', 'exe', 'dll', 'obj', 'o',
  'pyc', 'pyo', 'wasm', 'chc', 'dat', 'pak', 'idx', 'iso', 'img', 'keystore',
  'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'vsd', 'psd', 'ai', 'sketch',
  'war', 'ear', 'jad', 'pcap'
]);

/** 已知文本扩展名集合 */
export const TEXT_EXT = new Set<string>([
  'txt', 'md', 'markdown', 'json', 'json5', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx',
  'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'kts',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env', 'sh',
  'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'html', 'htm', 'css', 'scss', 'sass',
  'less', 'xml', 'svg', 'csv', 'tsv', 'log', 'gradle', 'gitignore', 'editorconfig',
  'dockerfile', 'makefile', 'vim', 'lua', 'pl', 'php', 'swift', 'dart'
]);

// ---- 许可证 ----

/** init 时可选的 SPDX 许可证清单 */
export interface LicenseChoice {
  spdx: string;
  label: string;
  /** 是否需要下载全文；false 表示不写 license 文件 */
  download: boolean;
}

export const LICENSE_CHOICES: LicenseChoice[] = [
  { spdx: 'MIT', label: 'MIT（最宽松，仅需保留版权声明）', download: true },
  { spdx: 'Apache-2.0', label: 'Apache-2.0（含专利授权）', download: true },
  { spdx: 'GPL-3.0-or-later', label: 'GPL-3.0-or-later（强 copyleft，允许升级）', download: true },
  { spdx: 'GPL-3.0-only', label: 'GPL-3.0-only（强 copyleft，锁定版本）', download: true },
  { spdx: 'LGPL-3.0-or-later', label: 'LGPL-3.0-or-later（弱 copyleft，可动态链接）', download: true },
  { spdx: 'AGPL-3.0-only', label: 'AGPL-3.0-only（网络服务也需开源）', download: true },
  { spdx: 'BSD-3-Clause', label: 'BSD-3-Clause（宽松，含禁止背书条款）', download: true },
  { spdx: 'ISC', label: 'ISC（等价 MIT，更简短）', download: true },
  { spdx: 'MPL-2.0', label: 'MPL-2.0（文件级 copyleft）', download: true },
  { spdx: 'Unlicense', label: 'Unlicense（放弃版权，进入公有领域）', download: true },
  { spdx: 'UNLICENSED', label: '不写许可证（不开源）', download: false }
];

/** 许可证全文来源（SPDX 官方 license-list-data） */
export const LICENSE_RAW_BASE =
  'https://raw.githubusercontent.com/spdx/license-list-data/main/text/';

/** SPDX 标识符 -> 许可证文本文件名 */
export const LICENSE_FILE_NAME: { [spdx: string]: string } = {
  'MIT': 'MIT.txt',
  'Apache-2.0': 'Apache-2.0.txt',
  'GPL-3.0-or-later': 'GPL-3.0-or-later.txt',
  'GPL-3.0-only': 'GPL-3.0-only.txt',
  'LGPL-3.0-or-later': 'LGPL-3.0-or-later.txt',
  'AGPL-3.0-only': 'AGPL-3.0-only.txt',
  'BSD-3-Clause': 'BSD-3-Clause.txt',
  'ISC': 'ISC.txt',
  'MPL-2.0': 'MPL-2.0.txt',
  'Unlicense': 'Unlicense.txt'
};

/** 工具层统一返回 */
export interface ToolOk<T> {
  success: true;
  message: string;
  data: T;
}

export interface ToolFail {
  success: false;
  message: string;
  data?: any;
}

export type ToolResult<T = any> = ToolOk<T> | ToolFail;