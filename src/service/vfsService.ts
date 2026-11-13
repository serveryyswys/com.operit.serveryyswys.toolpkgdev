// 虚拟文件系统业务逻辑：读写删 + 目录维护 + 自动快照衔接
//
// 设计要点：
//   - 所有变更都通过本服务，从而保证自动快照不漏记
//   - 读操作（read/grep/list/stat）不产生快照
//   - 每次写/删/上传都会追加一条 autosnap 记录

import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import * as autoSnap from '../storage/autoSnapDao';
import { appendWithPrune } from './autoSnapService';
import { normalizeVirtualPath, allParentDirs, baseName, dirName } from '../util/paths';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import { nowIso } from '../util/time';
import { unifiedDiff } from '../util/diff';
import type { ReadResult, ChangeType } from '../model/fs';

export interface WriteOptions {
  /** 触发该写入的工具名 */
  tool: string;
  /** 必须提供的操作描述 */
  description: string;
}

export interface WriteResult {
  path: string;
  changeType: ChangeType;
  isNew: boolean;
  size: number;
  checksum: string;
  autoSnapId: number;
}

/** 把内容转成统一存储形态 */
function normalizeContent(isBinary: number, content: string): { stored: string; size: number } {
  if (isBinary === 1) {
    return { stored: content, size: b64ByteLength(content) };
  }
  return { stored: content, size: utf8ByteLength(content) };
}

/** 确保父目录链都在 dirs 表中 */
function ensureParentDirs(db: any, path: string, now: string): void {
  const parents = allParentDirs(path);
  for (let i = 0; i < parents.length; i++) vfs.putDir(db, parents[i], now);
}

/** 读取文件 */
export async function readFile(
  packageId: string,
  path: string,
  options?: { offset?: number; limit?: number }
): Promise<ReadResult> {
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const f = vfs.getFile(db, p);
  if (!f) {
    if (vfs.dirExists(db, p)) throw new Error('目标是一个目录，不能按文件读取: ' + path);
    throw new Error('文件不存在: ' + path);
  }

  let content = f.content;
  // 文本文件支持按行切片，便于大文件分段读
  if (f.isBinary === 0 && (options && (options.offset !== undefined || options.limit !== undefined))) {
    const lines = content.split('\n');
    const start = Math.max(0, (options.offset || 0));
    const take = options.limit === undefined ? lines.length : Math.max(0, options.limit);
    content = lines.slice(start, start + take).join('\n');
  }

  return {
    path: f.path,
    content: content,
    isBinary: f.isBinary === 1,
    size: f.size,
    checksum: f.checksum,
    updatedAt: f.updatedAt
  };
}

/** 只取元信息，不返回内容 */
export async function statFile(packageId: string, path: string): Promise<{
  path: string;
  exists: boolean;
  isDirectory: boolean;
  size: number;
  isBinary: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}> {
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const f = vfs.getFile(db, p);
  if (f) {
    return {
      path: f.path,
      exists: true,
      isDirectory: false,
      size: f.size,
      isBinary: f.isBinary === 1,
      checksum: f.checksum,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt
    };
  }
  const isDir = vfs.dirExists(db, p);
  return {
    path: p,
    exists: isDir,
    isDirectory: isDir,
    size: 0,
    isBinary: false,
    checksum: '',
    createdAt: '',
    updatedAt: ''
  };
}

/** 写入文件（含自动快照） */
export async function writeFile(
  packageId: string,
  path: string,
  content: string,
  isBinary: number,
  options: WriteOptions
): Promise<WriteResult> {
  if (!options || !options.description || !String(options.description).trim()) {
    throw new Error('写入操作必须提供 description');
  }
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const now = nowIso();

  if (vfs.dirExists(db, p)) throw new Error('目标是一个目录，不能写入文件: ' + path);

  const before = vfs.getFile(db, p);
  const norm = normalizeContent(isBinary, content);
  const checksum = sha256Hex(isBinary === 1 ? 'b64:' + content : content);

  ensureParentDirs(db, p, now);

  const isNew = !before;
  vfs.putFile(db, p, isBinary, norm.stored, norm.size, checksum, now, isNew);

  const changeType: ChangeType = isNew ? 'create' : 'modify';
  const snapId = appendWithPrune(db, {
    tool: options.tool,
    description: options.description,
    changeType: changeType,
    path: p,
    beforeContent: before ? before.content : null,
    beforeIsBinary: before ? before.isBinary : null,
    afterContent: norm.stored,
    afterIsBinary: isBinary,
    beforeChecksum: before ? before.checksum : null,
    afterChecksum: checksum,
    createdAt: now
  });

  return {
    path: p,
    changeType: changeType,
    isNew: isNew,
    size: norm.size,
    checksum: checksum,
    autoSnapId: snapId
  };
}

/** 删除文件或目录（含自动快照） */
export async function deleteEntry(
  packageId: string,
  path: string,
  options: WriteOptions & { recursive?: boolean }
): Promise<{ path: string; deletedFiles: string[]; autoSnapIds: number[] }> {
  if (!options || !options.description || !String(options.description).trim()) {
    throw new Error('删除操作必须提供 description');
  }
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const now = nowIso();

  const file = vfs.getFile(db, p);
  const autoSnapIds: number[] = [];
  const deletedFiles: string[] = [];

  if (file) {
    // 单文件删除
    const snapId = appendWithPrune(db, {
      tool: options.tool,
      description: options.description,
      changeType: 'delete',
      path: p,
      beforeContent: file.content,
      beforeIsBinary: file.isBinary,
      afterContent: null,
      afterIsBinary: null,
      beforeChecksum: file.checksum,
      afterChecksum: null,
      createdAt: now
    });
    vfs.deleteFile(db, p);
    autoSnapIds.push(snapId);
    deletedFiles.push(p);
    return { path: p, deletedFiles: deletedFiles, autoSnapIds: autoSnapIds };
  }

  if (vfs.dirExists(db, p)) {
    const kids = vfs.listFilesUnder(db, p);
    if (kids.length && !options.recursive) {
      throw new Error('目录非空，需要 recursive=true 才能删除: ' + path);
    }
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const f = vfs.getFile(db, k.path);
      if (!f) continue;
      const snapId = appendWithPrune(db, {
        tool: options.tool,
        description: options.description,
        changeType: 'delete',
        path: f.path,
        beforeContent: f.content,
        beforeIsBinary: f.isBinary,
        afterContent: null,
        afterIsBinary: null,
        beforeChecksum: f.checksum,
        afterChecksum: null,
        createdAt: now
      });
      vfs.deleteFile(db, f.path);
      autoSnapIds.push(snapId);
      deletedFiles.push(f.path);
    }
    // 删除目录行（本身 + 子目录）
    vfs.deleteDir(db, p);
    return { path: p, deletedFiles: deletedFiles, autoSnapIds: autoSnapIds };
  }

  throw new Error('路径不存在: ' + path);
}

/** 应用补丁：把 old 片段替换为 new，必须唯一匹配 */
export async function applyPatch(
  packageId: string,
  path: string,
  oldText: string,
  newText: string,
  options: WriteOptions & { occurrence?: number }
): Promise<{
  path: string;
  matched: number;
  replaced: number;
  autoSnapId: number;
  diff: string;
}> {
  if (!options || !options.description || !String(options.description).trim()) {
    throw new Error('apply_file 操作必须提供 description');
  }
  if (!oldText || !oldText.length) throw new Error('old 片段不能为空');

  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const f = vfs.getFile(db, p);
  if (!f) throw new Error('文件不存在: ' + path);
  if (f.isBinary === 1) throw new Error('二进制文件不支持 apply_file: ' + path);

  // 统计出现次数
  const occurrences: number[] = [];
  let from = 0;
  while (true) {
    const idx = f.content.indexOf(oldText, from);
    if (idx < 0) break;
    occurrences.push(idx);
    from = idx + oldText.length;
  }
  if (!occurrences.length) throw new Error('old 片段在文件中未找到，未做任何修改');
  if (occurrences.length > 1 && options.occurrence === undefined) {
    throw new Error('old 片段匹配到 ' + occurrences.length + ' 处，请提供更长片段或指定 occurrence（第几处，1 起）');
  }

  let idx: number;
  let matched: number;
  if (options.occurrence !== undefined) {
    const nth = Number(options.occurrence);
    if (!Number.isFinite(nth) || nth < 1 || nth > occurrences.length) {
      throw new Error('occurrence 超出范围：共 ' + occurrences.length + ' 处');
    }
    idx = occurrences[nth - 1];
    matched = 1;
  } else {
    idx = occurrences[0];
    matched = 1;
  }

  const after = f.content.slice(0, idx) + newText + f.content.slice(idx + oldText.length);
  const now = nowIso();
  const checksum = sha256Hex(after);
  const size = utf8ByteLength(after);

  vfs.putFile(db, p, 0, after, size, checksum, now, false);

  const snapId = appendWithPrune(db, {
    tool: options.tool,
    description: options.description,
    changeType: 'modify',
    path: p,
    beforeContent: f.content,
    beforeIsBinary: 0,
    afterContent: after,
    afterIsBinary: 0,
    beforeChecksum: f.checksum,
    afterChecksum: checksum,
    createdAt: now
  });

  return {
    path: p,
    matched: matched,
    replaced: 1,
    autoSnapId: snapId,
    diff: unifiedDiff(f.content, after, p)
  };
}

/** 列目录 */
export async function listDir(
  packageId: string,
  path: string,
  recursive?: boolean
): Promise<Array<{ path: string; isDirectory: boolean; size: number }>> {
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  if (!recursive) {
    // 注意：'mydata' 本身就是虚拟根，直接当作父路径查，
    // 之前误映射成 '' 会把 mydata 自身也当成子项返回。
    return vfs.listChildren(db, p);
  }
  const files = vfs.listFilesUnder(db, p);
  const out: Array<{ path: string; isDirectory: boolean; size: number }> = [];
  for (let i = 0; i < files.length; i++) {
    out.push({ path: files[i].path, isDirectory: false, size: files[i].size });
  }
  return out;
}

/** 目录/项目统计 */
export async function getStats(packageId: string): Promise<{ files: number; dirs: number; bytes: number; autoSnaps: number }> {
  const db = await openProjectDb(packageId);
  const s = vfs.stats(db);
  const a = autoSnap.countRecords(db);
  return { files: s.files, dirs: s.dirs, bytes: s.bytes, autoSnaps: a };
}

/** 批量读全部文件（编译用，返回原始内容） */
export async function readAllRaw(packageId: string): Promise<Array<{
  path: string;
  isBinary: number;
  content: string;
  checksum: string;
}>> {
  const db = await openProjectDb(packageId);
  const files = vfs.listAllFiles(db);
  const out: Array<{ path: string; isBinary: number; content: string; checksum: string }> = [];
  for (let i = 0; i < files.length; i++) {
    out.push({
      path: files[i].path,
      isBinary: files[i].isBinary,
      content: files[i].content,
      checksum: files[i].checksum
    });
  }
  return out;
}