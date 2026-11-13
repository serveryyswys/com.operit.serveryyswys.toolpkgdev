// 虚拟文件系统 DAO：只管表读写，不含业务规则

import { dbExec, dbQuery, dbQueryOne, dbInsert } from '../util/sqlite';
import { TABLES } from './schema';
import type { VfsFile } from '../model/fs';

/** 读取单个文件行 */
export function getFile(db: any, path: string): VfsFile | null {
  const row = dbQueryOne(db, 'SELECT * FROM ' + TABLES.FILES + ' WHERE path = ?', [path]);
  if (!row) return null;
  return {
    path: String(row.path),
    isBinary: Number(row.is_binary || 0),
    content: row.content === null || row.content === undefined ? '' : String(row.content),
    size: Number(row.size || 0),
    checksum: String(row.checksum || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || '')
  };
}

/** 该路径是否存在（文件或目录） */
export function entryExists(db: any, path: string): boolean {
  const f = dbQueryOne(db, 'SELECT 1 AS x FROM ' + TABLES.FILES + ' WHERE path = ?', [path]);
  if (f) return true;
  const d = dbQueryOne(db, 'SELECT 1 AS x FROM ' + TABLES.DIRS + ' WHERE path = ?', [path]);
  return !!d;
}

export function dirExists(db: any, path: string): boolean {
  return !!dbQueryOne(db, 'SELECT 1 AS x FROM ' + TABLES.DIRS + ' WHERE path = ?', [path]);
}

/** 插入目录（幂等） */
export function putDir(db: any, path: string, now: string): void {
  dbExec(db, 'INSERT OR IGNORE INTO ' + TABLES.DIRS + ' (path, created_at) VALUES (?, ?)', [path, now]);
}

/** 写入文件（覆盖） */
export function putFile(
  db: any,
  path: string,
  isBinary: number,
  content: string,
  size: number,
  checksum: string,
  now: string,
  isNew: boolean
): void {
  if (isNew) {
    dbInsert(db, TABLES.FILES, {
      path: path,
      is_binary: isBinary,
      content: content,
      size: size,
      checksum: checksum,
      created_at: now,
      updated_at: now
    });
  } else {
    dbExec(
      db,
      'UPDATE ' + TABLES.FILES + ' SET is_binary = ?, content = ?, size = ?, checksum = ?, updated_at = ? WHERE path = ?',
      [isBinary, content, size, checksum, now, path]
    );
  }
}

/** 删除文件行 */
export function deleteFile(db: any, path: string): void {
  dbExec(db, 'DELETE FROM ' + TABLES.FILES + ' WHERE path = ?', [path]);
}

/** 删除目录行 */
export function deleteDir(db: any, path: string): void {
  dbExec(db, 'DELETE FROM ' + TABLES.DIRS + ' WHERE path = ?', [path]);
}

/** 列出某个直接父目录下的条目 */
export function listChildren(db: any, parent: string): Array<{ path: string; isDirectory: boolean; size: number }> {
  const out: Array<{ path: string; isDirectory: boolean; size: number }> = [];
  const prefix = parent ? parent + '/' : '';

  const files = dbQuery(db, 'SELECT path, size FROM ' + TABLES.FILES + ' WHERE path LIKE ?', [prefix + '%']);
  for (let i = 0; i < files.length; i++) {
    const p = String(files[i].path);
    const rest = p.slice(prefix.length);
    if (rest.indexOf('/') >= 0) continue; // 更深层，跳过
    out.push({ path: p, isDirectory: false, size: Number(files[i].size || 0) });
  }

  const dirs = dbQuery(db, 'SELECT path FROM ' + TABLES.DIRS + ' WHERE path LIKE ?', [prefix + '%']);
  for (let i = 0; i < dirs.length; i++) {
    const p = String(dirs[i].path);
    const rest = p.slice(prefix.length);
    if (rest.indexOf('/') >= 0) continue;
    if (p === parent) continue;
    out.push({ path: p, isDirectory: true, size: 0 });
  }
  return out;
}

/** 递归列出前缀下的全部文件 */
export function listFilesUnder(db: any, prefix: string): Array<{ path: string; isBinary: number; size: number; checksum: string }> {
  const like = prefix ? prefix + '/%' : '%';
  const rows = dbQuery(
    db,
    'SELECT path, is_binary, size, checksum FROM ' + TABLES.FILES + ' WHERE path LIKE ? ORDER BY path',
    [like]
  );
  const out: Array<{ path: string; isBinary: number; size: number; checksum: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({
      path: String(rows[i].path),
      isBinary: Number(rows[i].is_binary || 0),
      size: Number(rows[i].size || 0),
      checksum: String(rows[i].checksum || '')
    });
  }
  return out;
}

/** 全部文件（用于快照全量树） */
export function listAllFiles(db: any): VfsFile[] {
  const rows = dbQuery(db, 'SELECT * FROM ' + TABLES.FILES + ' ORDER BY path');
  const out: VfsFile[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out.push({
      path: String(r.path),
      isBinary: Number(r.is_binary || 0),
      content: r.content === null || r.content === undefined ? '' : String(r.content),
      size: Number(r.size || 0),
      checksum: String(r.checksum || ''),
      createdAt: String(r.created_at || ''),
      updatedAt: String(r.updated_at || '')
    });
  }
  return out;
}

/** 全部目录 */
export function listAllDirs(db: any): string[] {
  const rows = dbQuery(db, 'SELECT path FROM ' + TABLES.DIRS + ' ORDER BY path');
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) out.push(String(rows[i].path));
  return out;
}

/** 统计 */
export function stats(db: any): { files: number; dirs: number; bytes: number } {
  const f = dbQueryOne(db, 'SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM ' + TABLES.FILES);
  const d = dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.DIRS);
  return {
    files: f ? Number(f.c || 0) : 0,
    dirs: d ? Number(d.c || 0) : 0,
    bytes: f ? Number(f.s || 0) : 0
  };
}

/** 元信息读写 */
export function getMeta(db: any, key: string): string | null {
  const row = dbQueryOne(db, 'SELECT value FROM ' + TABLES.META + ' WHERE key = ?', [key]);
  return row ? String(row.value) : null;
}

export function setMeta(db: any, key: string, value: string): void {
  dbExec(db, 'INSERT OR REPLACE INTO ' + TABLES.META + ' (key, value) VALUES (?, ?)', [key, value]);
}