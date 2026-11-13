// 数据库连接管理：按 packageId 缓存连接，避免反复开关

import { openDb, dbClose } from '../util/sqlite';
import { ensureSchema } from './schema';
import { projectDbPath, projectRoot } from '../util/paths';
import { exists, mkdirp } from '../util/files';

interface DbHandle {
  db: any;
  dbPath: string;
}

const cache: { [packageId: string]: DbHandle } = {};

/** 打开（或复用）某项目的数据库，自动建目录与建表 */
export async function openProjectDb(packageId: string): Promise<any> {
  const cached = cache[packageId];
  if (cached) return cached.db;

  const root = projectRoot(packageId);
  mkdirp(root);

  const dbPath = projectDbPath(packageId);
  const db = openDb(dbPath);
  ensureSchema(db);

  cache[packageId] = { db: db, dbPath: dbPath };
  return db;
}

/** 项目数据库是否已存在（用于存在性校验，不打开） */
export async function projectDbExists(packageId: string): Promise<boolean> {
  if (cache[packageId]) return true;
  return exists(projectDbPath(packageId));
}

/** 关闭并移除缓存 */
export function closeProjectDb(packageId: string): void {
  const h = cache[packageId];
  if (!h) return;
  dbClose(h.db);
  delete cache[packageId];
}

/** 关闭全部连接 */
export function closeAll(): void {
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length; i++) closeProjectDb(keys[i]);
}

/** 获取已缓存连接的数据库路径 */
export function cachedDbPath(packageId: string): string | null {
  const h = cache[packageId];
  return h ? h.dbPath : null;
}