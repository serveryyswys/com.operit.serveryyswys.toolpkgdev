// 自动快照业务：变更流水查询、单条回滚、批量回滚、导出到目录
//
// 与版本快照的区别：
//   - 自动快照是「每次改动都记」的细粒度流水，给 AI 一个改错就后悔的机会
//   - 版本快照是显式提交的时间线节点，用于里程碑
// 两者共用 unifiedDiff 与 base64 方案，但数据表完全独立。

import { openProjectDb } from '../storage/database';
import * as autoSnap from '../storage/autoSnapDao';
import * as vfs from '../storage/vfsDao';
import { normalizeVirtualPath, virtualToPhysical, projectOptDir } from '../util/paths';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import { nowIso } from '../util/time';
import { unifiedDiff } from '../util/diff';
import { mkdirp, writeText, writeBinaryB64 } from '../util/files';
import type { AutoSnapRecord } from '../model/fs';

/** 自动快照默认保留上限 */
export const DEFAULT_AUTOSNAP_LIMIT = 300;

/**
 * 追加一条自动快照并在超出上限时自动剪枝。
 * 所有会写 autosnap_records 的地方都应走这里，保证容量不会无限增长。
 */
export function appendWithPrune(db: any, input: any, limit?: number): number {
  const id = autoSnap.appendRecord(db, input);
  const max = limit && limit > 0
    ? limit
    : autoSnap.getRetentionLimit(db, DEFAULT_AUTOSNAP_LIMIT);
  autoSnap.pruneOldest(db, max);
  return id;
}

/** 读取当前保留上限 */
export async function getRetentionLimit(packageId: string): Promise<number> {
  const db = await openProjectDb(packageId);
  return autoSnap.getRetentionLimit(db, DEFAULT_AUTOSNAP_LIMIT);
}

/** 设置保留上限（立即对现有数据执行一次剪枝） */
export async function setRetentionLimit(packageId: string, limit: number): Promise<{ limit: number; pruned: number }> {
  if (!limit || limit <= 0) throw new Error('保留上限必须是正整数');
  const db = await openProjectDb(packageId);
  autoSnap.setRetentionLimit(db, limit);
  const pruned = autoSnap.pruneOldest(db, limit);
  return { limit: limit, pruned: pruned };
}

/** 手动触发一次剪枝 */
export async function pruneNow(packageId: string): Promise<{ limit: number; pruned: number; remain: number }> {
  const db = await openProjectDb(packageId);
  const limit = autoSnap.getRetentionLimit(db, DEFAULT_AUTOSNAP_LIMIT);
  const pruned = autoSnap.pruneOldest(db, limit);
  const remain = autoSnap.countRecords(db);
  return { limit: limit, pruned: pruned, remain: remain };
}

export interface HistoryQuery {
  path?: string;
  limit?: number;
  offset?: number;
}

/** 查询变更流水 */
export async function history(packageId: string, q?: HistoryQuery): Promise<{
  total: number;
  records: Array<{
    id: number;
    tool: string;
    description: string;
    changeType: string;
    path: string;
    createdAt: string;
    reverted: boolean;
    beforeSize: number;
    afterSize: number;
  }>;
}> {
  const db = await openProjectDb(packageId);
  const limit = q && q.limit ? Math.min(500, Math.max(1, q.limit)) : 50;
  const offset = q && q.offset ? Math.max(0, q.offset) : 0;

  let records: AutoSnapRecord[];
  let total: number;
  if (q && q.path) {
    const p = normalizeVirtualPath(q.path);
    records = autoSnap.listByPath(db, p, limit);
    total = autoSnap.countRecords(db, p);
  } else {
    records = autoSnap.listRecent(db, limit, offset);
    total = autoSnap.countRecords(db);
  }

  const out = records.map(function (r) {
    return {
      id: r.id,
      tool: r.tool,
      description: r.description,
      changeType: r.changeType,
      path: r.path,
      createdAt: r.createdAt,
      reverted: r.reverted === 1,
      beforeSize: r.beforeContent ? (r.beforeIsBinary === 1 ? b64ByteLength(r.beforeContent) : r.beforeContent.length) : 0,
      afterSize: r.afterContent ? (r.afterIsBinary === 1 ? b64ByteLength(r.afterContent) : r.afterContent.length) : 0
    };
  });

  return { total: total, records: out };
}

/** 查看某条记录的 diff（文本才给 patch） */
export async function showRecord(packageId: string, id: number): Promise<{
  record: AutoSnapRecord;
  diff: string | null;
  beforePreview: string | null;
  afterPreview: string | null;
}> {
  const db = await openProjectDb(packageId);
  const r = autoSnap.getRecord(db, id);
  if (!r) throw new Error('自动快照记录不存在: ' + id);

  const isText = (r.beforeIsBinary !== 1) && (r.afterIsBinary !== 1);
  let patch: string | null = null;
  if (isText) {
    patch = unifiedDiff(r.beforeContent || '', r.afterContent || '', r.path);
  }
  return {
    record: r,
    diff: patch,
    beforePreview: previewText(r.beforeContent, r.beforeIsBinary),
    afterPreview: previewText(r.afterContent, r.afterIsBinary)
  };
}

function previewText(content: string | null, isBinary: number | null): string | null {
  if (content === null) return null;
  if (isBinary === 1) return '[binary base64 ' + b64ByteLength(content) + ' bytes]';
  const lines = content.split('\n');
  if (lines.length <= 20) return content;
  return lines.slice(0, 20).join('\n') + '\n... (' + (lines.length - 20) + ' more lines)';
}

/**
 * 回滚单条记录：把路径恢复到该次变更「之前」的状态。
 * - create -> 删除该文件
 * - modify -> 恢复 before 内容
 * - delete -> 重建文件并写入 before 内容
 * 回滚本身也会生成一条新的自动快照（changeType 反向），保证可追溯。
 */
export async function revertRecord(packageId: string, id: number): Promise<{
  id: number;
  path: string;
  action: string;
  newAutoSnapId: number;
}> {
  const db = await openProjectDb(packageId);
  const r = autoSnap.getRecord(db, id);
  if (!r) throw new Error('自动快照记录不存在: ' + id);
  if (r.reverted === 1) throw new Error('该记录已被回滚过: ' + id);

  const now = nowIso();
  const current = vfs.getFile(db, r.path);

  if (r.changeType === 'create') {
    // 建出来的 -> 删掉
    if (!current) throw new Error('文件已不存在，无需回滚: ' + r.path);
    const newId = appendWithPrune(db, {
      tool: 'autosnap.revert',
      description: '回滚 #' + id + '：撤销新建 ' + r.path,
      changeType: 'delete',
      path: r.path,
      beforeContent: current.content,
      beforeIsBinary: current.isBinary,
      afterContent: null,
      afterIsBinary: null,
      beforeChecksum: current.checksum,
      afterChecksum: null,
      createdAt: now
    });
    vfs.deleteFile(db, r.path);
    autoSnap.markReverted(db, id);
    return { id: id, path: r.path, action: 'deleted', newAutoSnapId: newId };
  }

  if (r.changeType === 'modify' || r.changeType === 'delete') {
    const beforeContent = r.beforeContent === null ? '' : r.beforeContent;
    const beforeIsBinary = r.beforeIsBinary === null ? 0 : r.beforeIsBinary;
    const size = beforeIsBinary === 1 ? b64ByteLength(beforeContent) : utf8ByteLength(beforeContent);
    const checksum = sha256Hex(beforeIsBinary === 1 ? 'b64:' + beforeContent : beforeContent);

    const newId = appendWithPrune(db, {
      tool: 'autosnap.revert',
      description: '回滚 #' + id + '：恢复 ' + r.path,
      changeType: current ? 'modify' : 'create',
      path: r.path,
      beforeContent: current ? current.content : null,
      beforeIsBinary: current ? current.isBinary : null,
      afterContent: beforeContent,
      afterIsBinary: beforeIsBinary,
      beforeChecksum: current ? current.checksum : null,
      afterChecksum: checksum,
      createdAt: now
    });

    vfs.putFile(db, r.path, beforeIsBinary, beforeContent, size, checksum, now, !current);
    autoSnap.markReverted(db, id);
    return { id: id, path: r.path, action: current ? 'restored' : 'recreated', newAutoSnapId: newId };
  }

  throw new Error('未知的变更类型: ' + r.changeType);
}

/**
 * 批量回滚到某条记录之前：
 * 把 id 大于等于 fromId 的所有记录按「从新到旧」依次反向回滚。
 */
export async function revertToBefore(packageId: string, fromId: number): Promise<{
  revertedCount: number;
  details: Array<{ id: number; path: string; action: string; error?: string }>;
}> {
  const db = await openProjectDb(packageId);
  const all = autoSnap.listRecent(db, 10000, 0);
  // 取 id >= fromId 的记录，按 id 升序（先回滚最旧的？不，回滚要从新到旧）
  const targets = all.filter(function (r) { return r.id >= fromId && r.reverted !== 1; });
  targets.sort(function (a, b) { return b.id - a.id; });

  const details: Array<{ id: number; path: string; action: string; error?: string }> = [];
  let revertedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const res = await revertRecord(packageId, t.id);
      details.push({ id: t.id, path: res.path, action: res.action });
      revertedCount++;
    } catch (e) {
      details.push({ id: t.id, path: t.path, action: 'failed', error: String(e && (e as any).message ? (e as any).message : e) });
    }
  }
  return { revertedCount: revertedCount, details: details };
}

/**
 * 导出自动快照到物理目录（opt 之下）。
 * 可以选择：某个时间点之前的状态 / 某个文件的最新状态 / 全部文件。
 */
export async function exportSnapshot(
  packageId: string,
  options: {
    /** 导出到虚拟路径下的目录，默认 /mydata/export */
    targetDir?: string;
    /** 仅导出指定路径前缀的文件 */
    prefix?: string;
    /** 覆盖已存在文件 */
    overwrite?: boolean;
  }
): Promise<{
  targetDir: string;
  physicalRoot: string;
  written: string[];
  skipped: string[];
}> {
  const db = await openProjectDb(packageId);
  const targetDir = options.targetDir ? normalizeVirtualPath(options.targetDir) : 'mydata/export';
  const physicalRoot = virtualToPhysical(packageId, targetDir);
  mkdirp(physicalRoot);

  const all = vfs.listAllFiles(db);
  const written: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    if (options.prefix && f.path.indexOf(options.prefix) !== 0) continue;

    // 相对路径：去掉 mydata/ 前缀后放进目标目录
    const rel = f.path.replace(/^mydata\//, '');
    const abs = physicalRoot + '/' + rel;

    // 源目录本身不带 overwrite 判断时直接写
    try {
      const parent = abs.slice(0, abs.lastIndexOf('/'));
      if (parent) mkdirp(parent);
      if (f.isBinary === 1) {
        writeBinaryB64(abs, f.content);
      } else {
        writeText(abs, f.content);
      }
      written.push(rel);
    } catch (e) {
      skipped.push(rel + ' (' + String(e && (e as any).message ? (e as any).message : e) + ')');
    }
  }

  return { targetDir: targetDir, physicalRoot: physicalRoot, written: written, skipped: skipped };
}

/** 时间线摘要 */
export async function timeline(packageId: string, limit?: number): Promise<Array<{ day: string; count: number }>> {
  const db = await openProjectDb(packageId);
  return autoSnap.timelineSummary(db, limit || 30);
}

/**
 * 自动快照预览：紧凑列表，突出 id 与 description。
 * 给「改错了想回滚」的场景用——先看一眼有哪些变更，再决定回滚哪一条。
 */
export async function preview(
  packageId: string,
  options?: {
    /** 只看某个路径的变更 */
    path?: string;
    /** 返回条数，默认 20 */
    limit?: number;
    /** 跳过前 N 条 */
    offset?: number;
    /** 只看未回滚的（默认 true） */
    onlyActive?: boolean;
  }
): Promise<{
  total: number;
  shown: number;
  items: Array<{
    id: number;
    description: string;
    tool: string;
    changeType: string;
    path: string;
    createdAt: string;
    reverted: boolean;
    /** 变更摘要，如 "+120B" / "-56B" / "+120B -40B" */
    sizeDelta: string;
    /** 单行预览：变更类型 + 路径 + 尺寸变化 */
    summary: string;
  }>;
}> {
  const db = await openProjectDb(packageId);
  const limit = options && options.limit && options.limit > 0 ? Math.min(200, options.limit) : 20;
  const offset = options && options.offset && options.offset > 0 ? options.offset : 0;
  const onlyActive = options && options.onlyActive === false ? false : true;

  let records: AutoSnapRecord[];
  let total: number;
  if (options && options.path) {
    const p = normalizeVirtualPath(options.path);
    records = autoSnap.listByPath(db, p, limit + offset);
    total = autoSnap.countRecords(db, p);
  } else {
    records = autoSnap.listRecent(db, limit + offset, 0);
    total = autoSnap.countRecords(db);
  }

  // 过滤已回滚的
  if (onlyActive) {
    records = records.filter(function (r) { return r.reverted !== 1; });
  }
  // 应用 offset / limit
  records = records.slice(offset, offset + limit);

  const sizeOf = function (content: string | null, isBinary: number | null): number {
    if (!content) return 0;
    return isBinary === 1 ? b64ByteLength(content) : content.length;
  };

  const items = records.map(function (r) {
    const beforeSz = sizeOf(r.beforeContent, r.beforeIsBinary);
    const afterSz = sizeOf(r.afterContent, r.afterIsBinary);
    const delta = afterSz - beforeSz;

    let sizeDelta: string;
    if (r.changeType === 'create') sizeDelta = '+' + afterSz + 'B';
    else if (r.changeType === 'delete') sizeDelta = '-' + beforeSz + 'B';
    else sizeDelta = (delta >= 0 ? '+' : '') + delta + 'B';

    const typeLabel = r.changeType === 'create' ? '新增' : (r.changeType === 'delete' ? '删除' : '修改');
    const summary = '#' + r.id + ' [' + typeLabel + '] ' + r.path + ' (' + sizeDelta + ') — ' + r.description;

    return {
      id: r.id,
      description: r.description,
      tool: r.tool,
      changeType: r.changeType,
      path: r.path,
      createdAt: r.createdAt,
      reverted: r.reverted === 1,
      sizeDelta: sizeDelta,
      summary: summary
    };
  });

  return { total: total, shown: items.length, items: items };
}

/** 清空自动快照（危险，工具层需 confirm） */
export async function purge(packageId: string): Promise<{ removed: number }> {
  const db = await openProjectDb(packageId);
  const before = autoSnap.countRecords(db);
  autoSnap.purge(db);
  return { removed: before };
}