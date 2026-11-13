// 配置服务：全局设置（不属于某个项目，落在插件自己的目录里）
//
// 存储位置：/storage/emulated/0/Download/Operit/@serveryyswys/devtool/settings.json
//
// 为什么不用项目 storage.db：
//   - 配置是跨项目的（例如「删除阈值」对所有项目生效）
//   - UI 与子包是两个 JS 引擎，settings.json 读起来不需要开 SQLite
//
// 为什么不放 cleanOnExit：
//   那是宿主退出时清理的临时目录，配置放那儿迟早丢。注册中心目录才是插件的家。
import type { ConfirmStatus } from '../model/confirm';
import { exists, mkdirp, readText, writeText } from '../util/files';
import { REGISTRY_ROOT } from '../model/constants';

/** 全局配置项 */
export interface DevtoolSettings {
  /** 删除目录超过这么多文件需要确认 */
  deleteDirFileCount: number;
  /** 回滚跨过这么多版本需要确认 */
  rollbackVersionSpan: number;
  /** 依赖提取默认上限（MB） */
  dependencyMaxMb: number;
  /** 自动快照保留上限 */
  autosnapRetention: number;
  /** 确认框默认主标题（可被单次调用覆盖） */
  confirmTitle: string;
  /** 确认框默认小字（可被单次调用覆盖） */
  confirmHint: string;
}

/** 默认配置 */
export const DEFAULT_SETTINGS: DevtoolSettings = {
  deleteDirFileCount: 20,
  rollbackVersionSpan: 3,
  dependencyMaxMb: 100,
  autosnapRetention: 300,
  confirmTitle: '需要你批准',
  confirmHint: '该操作涉及大量不可逆操作，请谨慎选择'
};

/**
 * settings.json 路径。
 *
 * 注意 packageId 参数已无实际作用（配置是全局的），保留只是为了不打断现有调用点。
 * 新代码请直接调 readSettings() / writeSettings()，别自己拼路径。
 */
function settingsPath(packageId: string): string {
  return REGISTRY_ROOT + '/settings.json';
}

/** 去行号前缀 */
function stripLinePrefixes(text: string): string {
  if (!text) return text;
  return String(text).replace(/^\s*\d+\|/gm, '');
}

/** 读配置：缺项用默认值补齐 */
export async function readSettings(packageId: string): Promise<DevtoolSettings> {
  try {
    const p = settingsPath(packageId);
    if (!exists(p)) return Object.assign({}, DEFAULT_SETTINGS);
    const raw = readText(p);
    if (!raw || !raw.trim()) return Object.assign({}, DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_SETTINGS, parsed) as DevtoolSettings;
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

/** 写配置：自动补全缺失项 */
export async function writeSettings(
  packageId: string,
  patch: Partial<DevtoolSettings>
): Promise<DevtoolSettings> {
  const current = await readSettings(packageId);
  const next = Object.assign({}, current, patch) as DevtoolSettings;
  // 数值兜底：负数/NaN 一律回默认
  const numericKeys: Array<keyof DevtoolSettings> = [
    'deleteDirFileCount', 'rollbackVersionSpan', 'dependencyMaxMb', 'autosnapRetention'
  ];
  for (let i = 0; i < numericKeys.length; i++) {
    const k = numericKeys[i];
    const v = Number(next[k]);
    if (!isFinite(v) || v <= 0) (next as any)[k] = (DEFAULT_SETTINGS as any)[k];
    else (next as any)[k] = Math.floor(v);
  }
  if (!next.confirmTitle || !String(next.confirmTitle).trim()) {
    next.confirmTitle = DEFAULT_SETTINGS.confirmTitle;
  }
  if (!next.confirmHint || !String(next.confirmHint).trim()) {
    next.confirmHint = DEFAULT_SETTINGS.confirmHint;
  }

  mkdirp(REGISTRY_ROOT);
  writeText(settingsPath(packageId), JSON.stringify(next, null, 2));
  return next;
}

/** 恢复到默认配置 */
export async function resetSettings(packageId: string): Promise<DevtoolSettings> {
  return writeSettings(packageId, Object.assign({}, DEFAULT_SETTINGS));
}

/** 配置版本号（供 UI 显示「已保存」提示用） */
export function settingsSummary(s: DevtoolSettings): string {
  return '删除阈值 ' + s.deleteDirFileCount + ' 文件 · 回滚阈值 ' + s.rollbackVersionSpan
    + ' 版本 · 依赖上限 ' + s.dependencyMaxMb + ' MB · 快照保留 ' + s.autosnapRetention + ' 条';
}