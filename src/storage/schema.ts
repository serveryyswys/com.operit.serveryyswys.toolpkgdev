// storage.db 的表结构定义与初始化
//
// 五张业务表 + 一张元信息表：
//   vfs_dirs         虚拟目录（保留空目录）
//   vfs_files        虚拟文件内容（is_binary + content）
//   autosnap_records 自动快照：每次写/删/上传都留一条变更记录
//   snapshot_nodes   主动版本快照节点（时间线）
//   snapshot_files   版本快照内每个文件的状态
//   staging          版本快照暂存区
//   devtool_meta     键值元信息

import { dbExec, dbQueryOne } from '../util/sqlite';

export const SCHEMA_VERSION = 1;

export function ensureSchema(db: any): void {
  // 目录表
  dbExec(db, 'CREATE TABLE IF NOT EXISTS vfs_dirs (' +
    'path TEXT PRIMARY KEY,' +
    'created_at TEXT NOT NULL)');

  // 文件表
  dbExec(db, 'CREATE TABLE IF NOT EXISTS vfs_files (' +
    'path TEXT PRIMARY KEY,' +
    'is_binary INTEGER NOT NULL DEFAULT 0,' +
    'content TEXT,' +
    'size INTEGER NOT NULL DEFAULT 0,' +
    'checksum TEXT NOT NULL,' +
    'created_at TEXT NOT NULL,' +
    'updated_at TEXT NOT NULL)');
  dbExec(db, 'CREATE INDEX IF NOT EXISTS idx_vfs_files_checksum ON vfs_files(checksum)');

  // 自动快照表（细粒度：一次变更一条）
  dbExec(db, 'CREATE TABLE IF NOT EXISTS autosnap_records (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'tool TEXT NOT NULL,' +
    'description TEXT NOT NULL,' +
    'change_type TEXT NOT NULL,' +
    'path TEXT NOT NULL,' +
    'before_content TEXT,' +
    'before_is_binary INTEGER,' +
    'after_content TEXT,' +
    'after_is_binary INTEGER,' +
    'before_checksum TEXT,' +
    'after_checksum TEXT,' +
    'created_at TEXT NOT NULL,' +
    'reverted INTEGER NOT NULL DEFAULT 0)');
  dbExec(db, 'CREATE INDEX IF NOT EXISTS idx_autosnap_path ON autosnap_records(path)');
  dbExec(db, 'CREATE INDEX IF NOT EXISTS idx_autosnap_time ON autosnap_records(created_at)');

  // 版本快照节点表
  dbExec(db, 'CREATE TABLE IF NOT EXISTS snapshot_nodes (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'version_id INTEGER NOT NULL UNIQUE,' +
    'display_version TEXT NOT NULL UNIQUE,' +
    'description TEXT DEFAULT \'\',' +
    'author TEXT DEFAULT \'\',' +
    'created_at TEXT NOT NULL,' +
    'parent_id INTEGER)');

  // 版本快照文件表（全量树快照，每节点存完整文件状态）
  dbExec(db, 'CREATE TABLE IF NOT EXISTS snapshot_files (' +
    'snapshot_id INTEGER NOT NULL,' +
    'path TEXT NOT NULL,' +
    'change_type TEXT NOT NULL,' +
    'is_binary INTEGER NOT NULL DEFAULT 0,' +
    'content TEXT,' +
    'checksum TEXT NOT NULL,' +
    'PRIMARY KEY (snapshot_id, path))');
  dbExec(db, 'CREATE INDEX IF NOT EXISTS idx_snapfiles_snap ON snapshot_files(snapshot_id)');

  // 暂存区
  dbExec(db, 'CREATE TABLE IF NOT EXISTS staging (' +
    'path TEXT PRIMARY KEY,' +
    'is_binary INTEGER NOT NULL DEFAULT 0,' +
    'content TEXT,' +
    'checksum TEXT,' +
    'state TEXT NOT NULL,' +
    'updated_at TEXT NOT NULL)');

  // 元信息
  dbExec(db, 'CREATE TABLE IF NOT EXISTS devtool_meta (' +
    'key TEXT PRIMARY KEY,' +
    'value TEXT)');

  // 记录 schema 版本
  const row = dbQueryOne(db, 'SELECT value FROM devtool_meta WHERE key = ?', ['schema_version']);
  if (!row) {
    dbExec(db, 'INSERT INTO devtool_meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
  }
}

/** 表名常量，避免散落字符串 */
export const TABLES = {
  DIRS: 'vfs_dirs',
  FILES: 'vfs_files',
  AUTOSNAP: 'autosnap_records',
  NODES: 'snapshot_nodes',
  SNAPFILES: 'snapshot_files',
  STAGING: 'staging',
  META: 'devtool_meta'
} as const;