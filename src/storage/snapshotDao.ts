// 版本快照 DAO：节点、文件树、暂存区

import { dbExec, dbQuery, dbQueryOne, dbInsert } from '../util/sqlite';
import { TABLES } from './schema';
import type { SnapshotNode, SnapshotFileEntry, StagingEntry, ChangeType } from '../model/snapshot';

function rowToNode(r: any): SnapshotNode {
  return {
    id: Number(r.id),
    versionId: Number(r.version_id),
    displayVersion: String(r.display_version),
    description: String(r.description || ''),
    author: String(r.author || ''),
    createdAt: String(r.created_at || ''),
    parentId: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id)
  };
}

/** 当前最大 version_id，无节点时返回 0 */
export function maxVersionId(db: any): number {
  const row = dbQueryOne(db, 'SELECT COALESCE(MAX(version_id), 0) AS m FROM ' + TABLES.NODES);
  return row ? Number(row.m || 0) : 0;
}

/** 最新节点 */
export function latestNode(db: any): SnapshotNode | null {
  const row = dbQueryOne(db, 'SELECT * FROM ' + TABLES.NODES + ' ORDER BY version_id DESC LIMIT 1');
  return row ? rowToNode(row) : null;
}

export function getNodeByDisplay(db: any, displayVersion: string): SnapshotNode | null {
  const row = dbQueryOne(db, 'SELECT * FROM ' + TABLES.NODES + ' WHERE display_version = ?', [displayVersion]);
  return row ? rowToNode(row) : null;
}

export function getNodeById(db: any, id: number): SnapshotNode | null {
  const row = dbQueryOne(db, 'SELECT * FROM ' + TABLES.NODES + ' WHERE id = ?', [id]);
  return row ? rowToNode(row) : null;
}

/** 分页列出节点，版本降序 */
export function listNodes(db: any, page: number, limit: number): SnapshotNode[] {
  const offset = (Math.max(1, page) - 1) * limit;
  const rows = dbQuery(
    db,
    'SELECT * FROM ' + TABLES.NODES + ' ORDER BY version_id DESC LIMIT ' + Number(limit) + ' OFFSET ' + Number(offset)
  );
  const out: SnapshotNode[] = [];
  for (let i = 0; i < rows.length; i++) out.push(rowToNode(rows[i]));
  return out;
}

export function countNodes(db: any): number {
  const row = dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.NODES);
  return row ? Number(row.c || 0) : 0;
}

/** 插入节点，返回自增 id */
export function insertNode(
  db: any,
  versionId: number,
  displayVersion: string,
  description: string,
  author: string,
  createdAt: string,
  parentId: number | null
): number {
  return dbInsert(db, TABLES.NODES, {
    version_id: versionId,
    display_version: displayVersion,
    description: description,
    author: author,
    created_at: createdAt,
    parent_id: parentId === null ? null : parentId
  });
}

/** 删除某节点及其后的所有节点（回滚用） */
export function deleteNodesFrom(db: any, minVersionId: number): void {
  dbExec(
    db,
    'DELETE FROM ' + TABLES.SNAPFILES + ' WHERE snapshot_id IN (SELECT id FROM ' + TABLES.NODES + ' WHERE version_id >= ?)',
    [minVersionId]
  );
  dbExec(db, 'DELETE FROM ' + TABLES.NODES + ' WHERE version_id >= ?', [minVersionId]);
}

/** 写入某节点的文件树 */
export function insertSnapshotFile(db: any, entry: SnapshotFileEntry): void {
  dbInsert(db, TABLES.SNAPFILES, {
    snapshot_id: entry.snapshotId,
    path: entry.path,
    change_type: entry.changeType,
    is_binary: entry.isBinary,
    content: entry.content,
    checksum: entry.checksum
  });
}

/** 读取某节点的完整文件树 */
export function listSnapshotFiles(db: any, snapshotId: number): SnapshotFileEntry[] {
  const rows = dbQuery(db, 'SELECT * FROM ' + TABLES.SNAPFILES + ' WHERE snapshot_id = ? ORDER BY path', [snapshotId]);
  const out: SnapshotFileEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out.push({
      snapshotId: Number(r.snapshot_id),
      path: String(r.path),
      changeType: String(r.change_type) as ChangeType,
      isBinary: Number(r.is_binary || 0),
      content: r.content === null || r.content === undefined ? null : String(r.content),
      checksum: String(r.checksum || '')
    });
  }
  return out;
}

/** 统计某节点的文件数 */
export function countSnapshotFiles(db: any, snapshotId: number): number {
  const row = dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.SNAPFILES + ' WHERE snapshot_id = ?', [snapshotId]);
  return row ? Number(row.c || 0) : 0;
}

// ---- 暂存区 ----

export function getStaging(db: any, path: string): StagingEntry | null {
  const r = dbQueryOne(db, 'SELECT * FROM ' + TABLES.STAGING + ' WHERE path = ?', [path]);
  if (!r) return null;
  return {
    path: String(r.path),
    isBinary: Number(r.is_binary || 0),
    content: r.content === null || r.content === undefined ? null : String(r.content),
    checksum: r.checksum === null || r.checksum === undefined ? null : String(r.checksum),
    state: String(r.state) as 'staged' | 'deleted',
    updatedAt: String(r.updated_at || '')
  };
}

export function putStaging(db: any, entry: StagingEntry): void {
  dbExec(
    db,
    'INSERT OR REPLACE INTO ' + TABLES.STAGING + ' (path, is_binary, content, checksum, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [entry.path, entry.isBinary, entry.content, entry.checksum, entry.state, entry.updatedAt]
  );
}

export function deleteStaging(db: any, path: string): void {
  dbExec(db, 'DELETE FROM ' + TABLES.STAGING + ' WHERE path = ?', [path]);
}

export function listStaging(db: any): StagingEntry[] {
  const rows = dbQuery(db, 'SELECT * FROM ' + TABLES.STAGING + ' ORDER BY path');
  const out: StagingEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out.push({
      path: String(r.path),
      isBinary: Number(r.is_binary || 0),
      content: r.content === null || r.content === undefined ? null : String(r.content),
      checksum: r.checksum === null || r.checksum === undefined ? null : String(r.checksum),
      state: String(r.state) as 'staged' | 'deleted',
      updatedAt: String(r.updated_at || '')
    });
  }
  return out;
}

export function clearStaging(db: any): void {
  dbExec(db, 'DELETE FROM ' + TABLES.STAGING);
}

export function countStaging(db: any): number {
  const row = dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.STAGING);
  return row ? Number(row.c || 0) : 0;
}