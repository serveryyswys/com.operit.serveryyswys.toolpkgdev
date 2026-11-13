// 虚拟文件系统模型：文件条目、目录条目、变更类型

/** 变更类型：自动快照与版本快照共用 */
export type ChangeType = 'create' | 'modify' | 'delete';

/** 虚拟文件条目（对应 vfs_files 表的一行） */
export interface VfsFile {
  /** 虚拟路径，统一为无前导斜杠的相对路径，例如 mydata/src/main.ts */
  path: string;
  /** 是否二进制：1 = 内容是 base64，0 = 内容是 UTF-8 文本 */
  isBinary: number;
  /** 文件内容（文本或 base64） */
  content: string;
  /** 字节大小（估算，文本按 UTF-8 长度） */
  size: number;
  /** 内容 sha256，用于快速判断是否变更 */
  checksum: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后修改时间 */
  updatedAt: string;
}

/** 虚拟目录条目（对应 vfs_dirs 表）；用于保留空目录 */
export interface VfsDir {
  path: string;
  createdAt: string;
}

/** 自动快照记录（对应 autosnap_records） */
export interface AutoSnapRecord {
  id: number;
  /** 触发该变更的工具名 */
  tool: string;
  /** 操作描述（write/delete/apply_file/upload 必填） */
  description: string;
  /** 变更类型 */
  changeType: ChangeType;
  /** 受影响的文件路径 */
  path: string;
  /** 变更前内容（用于回滚），delete 时为完整内容，create 时为 null */
  beforeContent: string | null;
  beforeIsBinary: number | null;
  /** 变更后内容，delete 时为 null */
  afterContent: string | null;
  afterIsBinary: number | null;
  /** 变更前 checksum */
  beforeChecksum: string | null;
  /** 时间戳 */
  createdAt: string;
  /** 是否已被回滚 */
  reverted: number;
}

/** 虚拟环境里的一次目录扫描结果 */
export interface VirtualEntry {
  path: string;
  isDirectory: boolean;
  size: number;
}

/** 读写文件的结果 */
export interface ReadResult {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
  checksum: string;
  updatedAt: string;
}

/** grep 的匹配项 */
export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

/** sed 的替换规划 */
export interface SedPlanItem {
  path: string;
  /** 替换次数 */
  replacements: number;
  /** 替换前内容（preview 时用于 diff） */
  before: string;
  /** 替换后内容（preview 时用于 diff） */
  after: string;
}