// 版本快照模型：移植 snapshotver 的时间线快照，全部落到本项目 storage.db

import type { ChangeType } from './fs';

export type { ChangeType };

/** 一个快照节点 */
export interface SnapshotNode {
  id: number;
  /** 单调递增的版本序号 */
  versionId: number;
  /** 对外显示版本号，例如 1.0.0，唯一 */
  displayVersion: string;
  description: string;
  author: string;
  createdAt: string;
  /** 父节点 id，首个节点为 null */
  parentId: number | null;
}

/** 快照内某个文件的状态记录 */
export interface SnapshotFileEntry {
  snapshotId: number;
  path: string;
  changeType: ChangeType;
  isBinary: number;
  content: string | null;
  checksum: string;
}

/** 暂存区条目（待提交的变更集合） */
export interface StagingEntry {
  path: string;
  isBinary: number;
  content: string | null;
  checksum: string | null;
  /** staged = 有内容待提交，deleted = 待删除 */
  state: 'staged' | 'deleted';
  updatedAt: string;
}

/** diff 结果的一行 */
export interface DiffFile {
  path: string;
  changeType: ChangeType;
  /** 文本文件的 unified diff；二进制为 null */
  patch: string | null;
}

/** diff 汇总 */
export interface DiffResult {
  from: string | null;
  to: string;
  added: number;
  modified: number;
  deleted: number;
  files: DiffFile[];
}