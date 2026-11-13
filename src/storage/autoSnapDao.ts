// 自动快照 DAO：细粒度变更流水，支持回滚与导出

import { dbExec, dbQuery, dbQueryOne, dbInsert } from '../util/sqlite';
import { TABLES } from './schema';
import type { AutoSnapRecord, ChangeType } from '../model/fs';

export interface RecordInput {
  tool: string;
  description: string;
  changeType: ChangeType;
  path: string;
  beforeContent: string | null;
  beforeIsBinary: number | null;
  afterContent: string | null;
  afterIsBinary: number | null;
  beforeChecksum: string | null;
  afterChecksum: string | null;
  createdAt: string;
}

function rowToRecord(r: any): AutoSnapRecord {
  return {
    id: Number(r.id),
    tool: String(r.tool || ''),
    description: String(r.description || ''),
    changeType: String(r.change_type) as ChangeType,
    path: String(r.path),
    beforeContent: r.before_content === null || r.before_content === undefined ? null : String(r.before_content),
    beforeIsBinary: r.before_is_binary === null || r.before_is_binary === undefined ? null : Number(r.before_is_binary),
    afterContent: r.after_content === null || r.after_content === undefined ? null : String(r.after_content),
    afterIsBinary: r.after_is_binary === null || r.after_is_binary === undefined ? null : Number(r.after_is_binary),
    beforeChecksum: r.before_checksum === null || r.before_checksum === undefined ? null : String(r.before_checksum),
    createdAt: String(r.created_at || ''),
    reverted: Number(r.reverted || 0)
  };
}

/** 追加一条变更记录，返回自增 id */
export function appendRecord(db: any, input: RecordInput): number {
  return dbInsert(db, TABLES.AUTOSNAP, {
    tool: input.tool,
    description: input.description,
    change_type: input.changeType,
    path: input.path,
    before_content: input.beforeContent,
    before_is_binary: input.beforeIsBinary,
    after_content: input.afterContent,
    after_is_binary: input.afterIsBinary,
    before_checksum: input.beforeChecksum,
    after_checksum: input.afterChecksum,
    created_at: input.createdAt,
    reverted: 0
  });
}

/** 按路径查历史，最新在前 */
export function listByPath(db: any, path: string, limit: number): AutoSnapRecord[] {
  const rows = dbQuery(
    db,
    'SELECT * FROM ' + TABLES.AUTOSNAP + ' WHERE path = ? ORDER BY id DESC LIMIT ' + Number(limit),
    [path]
  );
  const out: AutoSnapRecord[] = [];
  for (let i = 0; i < rows.length; i++) out.push(rowToRecord(rows[i]));
  return out;
}

/** 全量时间线，最新在前 */
export function listRecent(db: any, limit: number, offset: number): AutoSnapRecord[] {
  const rows = dbQuery(
    db,
    'SELECT * FROM ' + TABLES.AUTOSNAP + ' ORDER BY id DESC LIMIT ' + Number(limit) + ' OFFSET ' + Number(offset)
  );
  const out: AutoSnapRecord[] = [];
  for (let i = 0; i < rows.length; i++) out.push(rowToRecord(rows[i]));
  return out;
}

export function getRecord(db: any, id: number): AutoSnapRecord | null {
  const row = dbQueryOne(db, 'SELECT * FROM ' + TABLES.AUTOSNAP + ' WHERE id = ?', [id]);
  return row ? rowToRecord(row) : null;
}

/** 标记为已回滚 */
export function markReverted(db: any, id: number): void {
  dbExec(db, 'UPDATE ' + TABLES.AUTOSNAP + ' SET reverted = 1 WHERE id = ?', [id]);
}

/** 计数 */
export function countRecords(db: any, path?: string): number {
  const row = path
    ? dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.AUTOSNAP + ' WHERE path = ?', [path])
    : dbQueryOne(db, 'SELECT COUNT(*) AS c FROM ' + TABLES.AUTOSNAP);
  return row ? Number(row.c || 0) : 0;
}

/** 时间线摘要：按小时聚合，用于快速看改动节奏 */
export function timelineSummary(db: any, limit: number): Array<{ day: string; count: number }> {
  const rows = dbQuery(
    db,
    'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM ' + TABLES.AUTOSNAP +
    ' GROUP BY day ORDER BY day DESC LIMIT ' + Number(limit)
  );
  const out: Array<{ day: string; count: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    out.push({ day: String(rows[i].day), count: Number(rows[i].c || 0) });
  }
  return out;
}

/**
 * 剪枝：只保留最新 maxRows 条，更早的丢弃。
 * 按 id 降序取第 maxRows 条作为截止线，删除 id 小于等于它的记录。
 * 返回被删除的条数。
 */
export function pruneOldest(db: any, maxRows: number): number {
  if (!maxRows || maxRows <= 0) return 0;
  const total = countRecords(db);
  if (total <= maxRows) return 0;

  // 找到保留范围内的最小 id（即第 maxRows 条，从 1 开始计）
  const row = dbQueryOne(
    db,
    'SELECT id FROM ' + TABLES.AUTOSNAP + ' ORDER BY id DESC LIMIT 1 OFFSET ' + Number(maxRows - 1)
  );
  if (!row) return 0;
  const cutoff = Number(row.id);
  const victim = dbQueryOne(
    db,
    'SELECT COUNT(*) AS c FROM ' + TABLES.AUTOSNAP + ' WHERE id < ?',
    [cutoff]
  );
  const removed = victim ? Number(victim.c || 0) : 0;
  if (removed > 0) {
    dbExec(db, 'DELETE FROM ' + TABLES.AUTOSNAP + ' WHERE id < ?', [cutoff]);
  }
  return removed;
}

/** 当前保留上限（存在 devtool_meta 里，便于后续调整） */
export function getRetentionLimit(db: any, defaultLimit: number): number {
  const row = dbQueryOne(db, 'SELECT value FROM ' + TABLES.META + " WHERE key = 'autosnap_max_rows'");
  if (!row) return defaultLimit;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : defaultLimit;
}

export function setRetentionLimit(db: any, limit: number): void {
  dbExec(
    db,
    'INSERT OR REPLACE INTO ' + TABLES.META + " (key, value) VALUES ('autosnap_max_rows', ?)",
    [String(limit)]
  );
}

/** 清空全部记录（危险操作，工具层需二次确认） */
export function purge(db: any): void {
  dbExec(db, 'DELETE FROM ' + TABLES.AUTOSNAP);
}