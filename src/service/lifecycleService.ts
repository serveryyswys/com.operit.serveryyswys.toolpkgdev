// 整包级操作：摧毁（destroy）与归档（archive / unarchive）
//
// 与 delete 的区别：
//   delete   删虚拟文件系统里的某个文件/目录
//   destroy  删掉整个项目（物理目录 + storage.db + 注册表条目），不可恢复
//
// destroy 是所有工具里破坏力最大的一个，必须走确认制。
// 本文件只做业务；「要不要确认」由工具层根据 settings 判定后决定。

import { openProjectDb, closeProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import * as snapshotDao from '../storage/snapshotDao';
import * as autoSnapDao from '../storage/autoSnapDao';
import { exists, readText, writeText, remove, mkdirp, listDir } from '../util/files';
import { projectRoot, projectMetadataPath, assertSafePackageId } from '../util/paths';
import { REGISTRY_FILE } from '../model/constants';
import type { ProjectMetadata } from '../model/project';
import { nowIso } from '../util/time';
import { saveRegistryFile } from './registryIO';

/** 归档标记文件（放在项目根下） */
export const ARCHIVE_MARKER = '.devtool_archived.json';

export interface ArchiveMarker {
  archived: boolean;
  archivedAt: string;
  /** 归档原因（用户可选填） */
  note?: string;
}

/** 摧毁前的预估信息：让用户在确认框里看到会失去什么 */
export interface DestroyPreview {
  packageId: string;
  projectPath: string;
  /** 虚拟文件数 */
  fileCount: number;
  /** 虚拟文件总字节 */
  totalBytes: number;
  /** 版本快照数 */
  snapshotCount: number;
  /** 自动快照条数 */
  autoSnapCount: number;
  /** opt 物理落地区文件数 */
  optFileCount: number;
  /** 项目是否已归档 */
  archived: boolean;
  /** 是否存在 metadata.json */
  hasMetadata: boolean;
}

/** 统计 opt 目录下的文件数（浅递归，用于确认框展示） */
function countOptFiles(root: string): number {
  const opt = root.replace(/\/+$/, '') + '/opt';
  if (!exists(opt)) return 0;
  let n = 0;
  try {
    const walk = function (dir: string, depth: number): void {
      if (depth > 8) return;
      const entries = listDir(dir);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.isDirectory) walk(dir.replace(/\/+$/, '') + '/' + e.name, depth + 1);
        else n++;
      }
    };
    walk(opt, 0);
  } catch (err) {
    return n;
  }
  return n;
}

/** 摧毁前预览：读到多少算多少，读不到的项按 0 处理 */
export async function previewDestroy(packageId: string): Promise<DestroyPreview> {
  const id = assertSafePackageId(packageId);
  const root = projectRoot(id);

  let fileCount = 0;
  let totalBytes = 0;
  let snapshotCount = 0;
  let autoSnapCount = 0;

  try {
    const db = await openProjectDb(id);
    const s = vfs.stats(db);
    fileCount = s.files;
    totalBytes = s.bytes;
    try { snapshotCount = snapshotDao.countNodes(db); } catch (e) { snapshotCount = 0; }
    try { autoSnapCount = autoSnapDao.countRecords(db); } catch (e) { autoSnapCount = 0; }
  } catch (e) {
    // db 不存在或打不开：预览按 0
  }

  return {
    packageId: id,
    projectPath: root,
    fileCount: fileCount,
    totalBytes: totalBytes,
    snapshotCount: snapshotCount,
    autoSnapCount: autoSnapCount,
    optFileCount: countOptFiles(root),
    archived: isArchived(id),
    hasMetadata: exists(projectMetadataPath(id))
  };
}

/** 真正执行摧毁：关 db -> 删物理目录 -> 摘注册表 */
export async function destroyProject(packageId: string): Promise<{
  packageId: string;
  removedPath: string;
  unregistered: boolean;
}> {
  const id = assertSafePackageId(packageId);
  const root = projectRoot(id);

  // 1) 先关数据库连接，否则 Android 上文件可能被占用
  try { closeProjectDb(id); } catch (e) { /* 未打开时忽略 */ }

  // 2) 删物理目录（整棵，含 storage.db / .devtool / opt / metadata.json）
  const existed = exists(root);
  if (existed) {
    remove(root, true);
  }
  if (exists(root)) {
    throw new Error('项目目录删除失败（可能被占用）：' + root);
  }

  // 3) 摘注册表
  const unregistered = unregisterFromAll(id);

  return { packageId: id, removedPath: root, unregistered: unregistered };
}

/** 从注册表移除条目（内部实现，避免循环依赖） */
function unregisterFromAll(packageId: string): boolean {
  try {
    if (!exists(REGISTRY_FILE)) return false;
    const raw = readText(REGISTRY_FILE);
    const reg = JSON.parse(raw);
    if (!reg || !Array.isArray(reg.entries)) return false;
    const before = reg.entries.length;
    reg.entries = reg.entries.filter(function (e: any) {
      return String(e && e.packageId) !== packageId;
    });
    if (reg.entries.length === before) return false;
    saveRegistryFile(reg);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 归档 ----------

/** 判断项目是否已归档 */
export function isArchived(packageId: string): boolean {
  const id = assertSafePackageId(packageId);
  const p = projectRoot(id).replace(/\/+$/, '') + '/' + ARCHIVE_MARKER;
  if (!exists(p)) return false;
  try {
    const m = JSON.parse(readText(p)) as ArchiveMarker;
    return !!(m && m.archived);
  } catch (e) {
    return false;
  }
}

/** 读归档标记（完整结构） */
export function readArchiveMarker(packageId: string): ArchiveMarker | null {
  const id = assertSafePackageId(packageId);
  const p = projectRoot(id).replace(/\/+$/, '') + '/' + ARCHIVE_MARKER;
  if (!exists(p)) return null;
  try {
    return JSON.parse(readText(p)) as ArchiveMarker;
  } catch (e) {
    return null;
  }
}

/**
 * 归档：只写一个标记文件，不动任何数据。
 * 归档后项目仍可读（read / history / diff），但写类工具会拒绝，
 * 避免「以为不用的项目被误改」。
 */
export async function archiveProject(
  packageId: string,
  note?: string
): Promise<{ packageId: string; markerPath: string; marker: ArchiveMarker }> {
  const id = assertSafePackageId(packageId);
  const root = projectRoot(id);
  if (!exists(projectMetadataPath(id))) {
    throw new Error('项目不存在: ' + id);
  }
  mkdirp(root);
  const marker: ArchiveMarker = {
    archived: true,
    archivedAt: nowIso(),
    note: note ? String(note) : undefined
  };
  const markerPath = root.replace(/\/+$/, '') + '/' + ARCHIVE_MARKER;
  writeText(markerPath, JSON.stringify(marker, null, 2) + '\n');
  return { packageId: id, markerPath: markerPath, marker: marker };
}

/** 取消归档：删掉标记文件 */
export async function unarchiveProject(packageId: string): Promise<{
  packageId: string;
  markerRemoved: boolean;
}> {
  const id = assertSafePackageId(packageId);
  const markerPath = projectRoot(id).replace(/\/+$/, '') + '/' + ARCHIVE_MARKER;
  const had = exists(markerPath);
  if (had) remove(markerPath, false);
  return { packageId: id, markerRemoved: had };
}

/**
 * 列出所有已归档项目（扫 dev_package 根下每个项目的标记文件）
 */
export function listArchived(devPackageRoot: string): string[] {
  const out: string[] = [];
  try {
    const entries = listDir(devPackageRoot);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.isDirectory) continue;
      if (isArchived(e.name)) out.push(e.name);
    }
  } catch (err) {
    return out;
  }
  return out;
}