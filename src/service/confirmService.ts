// 权限确认服务：pending 记录的落盘读写 + 权限开关 + 危险阈值判定
//
// 为什么要落在 cleanOnExit 而不是项目 storage.db：
//   - confirm 记录的生命周期短（几分钟），不该污染项目版本历史
//   - 一次确认可能跨多个项目（例如整包摧毁时要读的不止一个 db）
//   - UI 层（XML 渲染）与工具层（子包）是**两个 JS 引擎**，需要一个双方都能读到的地方
//
// 目录约定：
//   /storage/emulated/0/Download/Operit/cleanOnExit/<pkgId>/pending/<id>.json
//   权限开关保存在环境变量 DEVTOL_CHECK_BYPASS

import type { ConfirmDraft, ConfirmRecord, ConfirmStatus } from '../model/confirm';
import { exists, mkdirp, readText, writeText, listDir, remove } from '../util/files';

/** 权限开关的环境变量名 */
const BYPASS_ENV = 'DEVTOL_CHECK_BYPASS';

/** 危险操作阈值默认值（可在 metadata 里覆盖） */
export const DEFAULT_THRESHOLDS = {
  /** 删除目录时，文件数超过这个值需要确认 */
  deleteDirFileCount: 20,
  /** 回滚跨过的版本数超过这个值需要确认 */
  rollbackVersionSpan: 3
};

/** 确认记录根目录 */
function pendingRoot(packageId: string): string {
  return '/storage/emulated/0/Download/Operit/cleanOnExit/' + packageId + '/pending';
}

function pendingPath(packageId: string, id: string): string {
  return pendingRoot(packageId) + '/' + id + '.json';
}

/** 生成本地时间戳 id：c + base36(时间) + _ + 随机 6 位 */
export function genConfirmId(): string {
  const t = Date.now().toString(36);
  let r = '';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 6; i++) {
    r += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'c' + t + '_' + r;
}

/** 去掉 read_file 可能带的行号前缀 */
function stripLinePrefixes(text: string): string {
  if (!text) return text;
  return String(text).replace(/^\s*\d+\|/gm, '');
}

/** 确保 pending 目录存在 */
async function ensureDir(packageId: string): Promise<void> {
  mkdirp(pendingRoot(packageId));
}

/** 创建一条 pending 记录，返回完整记录 */
/** 创建一条 pending 记录，返回完整记录 */
export async function createConfirm(draft: ConfirmDraft): Promise<ConfirmRecord> {
  ensureDir(draft.packageId);
  const rec: ConfirmRecord = {
    id: genConfirmId(),
    action: draft.action,
    summary: draft.summary,
    detail: draft.detail,
    packageId: draft.packageId,
    payload: draft.payload,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  // 用 node.operit 的 fs 落盘：Tools.Files.write 写深层路径会静默失败
  writeText(pendingPath(draft.packageId, rec.id), JSON.stringify(rec));
  return rec;
}

/** 读取一条记录；不存在或解析失败返回 null */
export async function readConfirm(packageId: string, id: string): Promise<ConfirmRecord | null> {
  if (!id) return null;
  try {
    const p = pendingPath(packageId, id);
    if (!exists(p)) return null;
    const raw = readText(p);
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw) as ConfirmRecord;
  } catch (e) {
    return null;
  }
}

/** 更新一条记录，返回更新后的记录；原记录不存在返回 null */
export async function updateConfirm(
  packageId: string,
  id: string,
  patch: Partial<ConfirmRecord>
): Promise<ConfirmRecord | null> {
  const rec = await readConfirm(packageId, id);
  if (!rec) return null;
  const next: ConfirmRecord = Object.assign({}, rec, patch, {
    updatedAt: new Date().toISOString()
  }) as ConfirmRecord;
  writeText(pendingPath(packageId, id), JSON.stringify(next));
  return next;
}

/** 把状态改成指定值（供 UI 层的确认/驳回按钮调用） */
export async function setConfirmStatus(
  packageId: string,
  id: string,
  status: ConfirmStatus,
  extra?: { result?: string; error?: string }
): Promise<ConfirmRecord | null> {
  return updateConfirm(packageId, id, Object.assign({ status: status }, extra || {}));
}

/** 清理过期记录（超过 ttlHours 小时），返回删除条数 */
export async function pruneConfirm(packageId: string, ttlHours?: number): Promise<number> {
  const ttl = (ttlHours && ttlHours > 0 ? ttlHours : 24) * 3600 * 1000;
  const cutoff = Date.now() - ttl;
  let removed = 0;
  try {
    const entries = listDir(pendingRoot(packageId));
    for (let i = 0; i < entries.length; i++) {
      const name = entries[i].name;
      if (!name || name.slice(-5) !== '.json') continue;
      const id = name.slice(0, -5);
      const rec = await readConfirm(packageId, id);
      if (!rec) continue;
      const t = Date.parse(rec.createdAt || '');
      if (isFinite(t) && t < cutoff) {
        try {
          remove(pendingPath(packageId, id), false);
          removed++;
        } catch (e) { /* 单条删失败不影响整体 */ }
      }
    }
  } catch (e) {
    // 目录不存在时直接返回 0
  }
  return removed;
}

// ---------- 权限开关 ----------

/** 读取「跳过确认」开关；读不到按 false（= 询问制） */
export function isBypassEnabled(): boolean {
  try {
    const v = Tools.SoftwareSettings.readEnvironmentVariable(BYPASS_ENV);
    return String(v || '').toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
}

/** 写入「跳过确认」开关 */
export function setBypassEnabled(enabled: boolean): void {
  Tools.SoftwareSettings.writeEnvironmentVariable(BYPASS_ENV, String(!!enabled));
}

// ---------- 危险阈值判定 ----------

/** 是否因为删除目录过大而需要确认 */
export function needsConfirmForDelete(dirFileCount: number, threshold?: number): boolean {
  const limit = threshold && threshold > 0 ? threshold : DEFAULT_THRESHOLDS.deleteDirFileCount;
  return dirFileCount > limit;
}

/** 是否因为回滚跨度过大而需要确认 */
export function needsConfirmForRollback(versionSpan: number, threshold?: number): boolean {
  const limit = threshold && threshold > 0 ? threshold : DEFAULT_THRESHOLDS.rollbackVersionSpan;
  return versionSpan > limit;
}

/** 面向用户的摘要文本：动作 + 目标 */
export function summarize(action: string, target: string, extra?: string): string {
  const base = action + '：' + target;
  return extra ? base + '（' + extra + '）' : base;
}

/**
 * 扫所有 pending 记录，找出最近的待确认项。
 *
 * 用途：会话过长时聊天里的 XML 确认框可能点不动，
 * 兜底页面（devtool_confirm）靠这个拿到「最近一次待确认」。
 *
 * 排序规则：优先 pending，其次按 createdAt 降序。
 * 返回 null 表示当前没有任何待确认记录。
 */
export async function findLatestPending(): Promise<ConfirmRecord | null> {
  let best: ConfirmRecord | null = null;
  let bestTime = -1;

  const rootEntries = listDir('/storage/emulated/0/Download/Operit/cleanOnExit');
  const projectDirs: string[] = [];
  for (let i = 0; i < rootEntries.length; i++) {
    const e = rootEntries[i];
    if (e.isDirectory) projectDirs.push(e.name);
  }

  for (let i = 0; i < projectDirs.length; i++) {
    const pkg = projectDirs[i];
    const dir = '/storage/emulated/0/Download/Operit/cleanOnExit/' + pkg + '/pending';
    const files = listDir(dir);
    for (let k = 0; k < files.length; k++) {
      const name = files[k].name;
      if (!name || name.slice(-5) !== '.json') continue;
      const id = name.slice(0, -5);
      const rec = await readConfirm(pkg, id);
      if (!rec) continue;
      // 只认 pending —— 已处理过的（approved/rejected/done/failed）绝不能再被当成「待确认」，
      // 否则用户驳回后会看到横幅还在，误以为没生效
      if (rec.status !== 'pending') continue;
      const t = Date.parse(rec.createdAt || '') || 0;
      if (t > bestTime) {
        best = rec;
        bestTime = t;
      }
    }
  }
  return best;
}

/**
 * 列出所有待确认（status=pending）记录，按时间倒序。
 *
 * 只返回 pending —— 已处理过的记录不应该出现在「待确认」列表里。
 * 想看全部历史请用 listHistory()。
 */
export async function listPending(): Promise<ConfirmRecord[]> {
  const all = await listHistory();
  const out: ConfirmRecord[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].status === 'pending') out.push(all[i]);
  }
  return out;
}

/** 列出全部确认记录（含已处理），按时间倒序。供历史回顾 / 兜底页用 */
export async function listHistory(): Promise<ConfirmRecord[]> {
  const out: ConfirmRecord[] = [];
  const rootEntries = listDir('/storage/emulated/0/Download/Operit/cleanOnExit');
  const projectDirs: string[] = [];
  for (let i = 0; i < rootEntries.length; i++) {
    const e = rootEntries[i];
    if (e.isDirectory && e.name.indexOf('.') >= 0) projectDirs.push(e.name);
  }

  for (let i = 0; i < projectDirs.length; i++) {
    const pkg = projectDirs[i];
    const dir = '/storage/emulated/0/Download/Operit/cleanOnExit/' + pkg + '/pending';
    const files = listDir(dir);
    for (let k = 0; k < files.length; k++) {
      const name = files[k].name;
      if (!name || name.slice(-5) !== '.json') continue;
      const rec = await readConfirm(pkg, name.slice(0, -5));
      if (rec) out.push(rec);
    }
  }

  out.sort(function (a, b) {
    const ta = Date.parse(a.createdAt || '') || 0;
    const tb = Date.parse(b.createdAt || '') || 0;
    return tb - ta;
  });
  return out;
}