// 环境检查服务：给 UI 用的自检清单
//
// 检查四类东西：
//   1) 目录可写：dev_package 根、cleanOnExit 根能不能写
//   2) opm 包：能否 toolCall 到 opm:version
//   3) tsc：隐藏执行器里有没有 tsc、版本多少
//   4) node.operit：项目内的依赖是否齐全（BUILTINS.json 在不在）
//
// 所有检查都必须**安全**：失败返回 false + 原因，绝不抛异常打断 UI

import { DEV_PACKAGE_ROOT, OPERIT_ROOT } from '../model/constants';
import { mkdirp, writeText, remove } from '../util/files';

/** 单项检查结果 */
export interface CheckItem {
  /** 稳定 id，供 UI 做 key */
  id: string;
  /** 中文名 */
  label: string;
  /** ok / warn / fail */
  level: 'ok' | 'warn' | 'fail';
  /** 一句话说明 */
  message: string;
  /** 可选：修复建议 */
  hint?: string;
}

/** 整体检查报告 */
export interface EnvReport {
  items: CheckItem[];
  /** ok 项数 */
  okCount: number;
  /** warn 项数 */
  warnCount: number;
  /** fail 项数 */
  failCount: number;
  /** 是否全部通过（没有 fail） */
  healthy: boolean;
  /** 检查时间 */
  checkedAt: string;
}

/** 探测物理目录是否可写：写一个临时文件再删掉 */
async function probeWritable(dir: string): Promise<{ ok: boolean; reason: string }> {
  const probePath = dir.replace(/\/+$/, '') + '/.devtool_write_probe';
  try {
    mkdirp(dir);
  } catch (e) {
    // 目录可能已存在，继续尝试写文件
  }
  try {
    writeText(probePath, 'probe');
  } catch (e) {
    return { ok: false, reason: '无法写入：' + String((e as any).message || e) };
  }
  try {
    remove(probePath, false);
  } catch (e) {
    // 删不掉不算致命，只要写成功了
  }
  return { ok: true, reason: '' };
}

/** 检查 opm 包是否可用 */
async function checkOpm(): Promise<CheckItem> {
  const fn: any = (globalThis as any).toolCall;
  if (typeof fn !== 'function') {
    return {
      id: 'opm',
      label: 'opm 构建工具',
      level: 'fail',
      message: '当前运行时不支持 toolCall，无法转发到 opm 包',
      hint: '请确认 Operit 版本支持 toolCall'
    };
  }
  try {
    const raw: any = await fn('opm:version', {});
    let parsed: any = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    }
    if (parsed && parsed.success === false) {
      return {
        id: 'opm',
        label: 'opm 构建工具',
        level: 'fail',
        message: 'opm 包不可用：' + String(parsed.message || '未知原因'),
        hint: '请在「包管理」中启用 opm（com.operit.serveryyswys.opm）'
      };
    }
    return {
      id: 'opm',
      label: 'opm 构建工具',
      level: 'ok',
      message: '可用，toolpkg-js / toolpkg-ts 项目可以打包'
    };
  } catch (e) {
    const msg = String((e && (e as any).message) ? (e as any).message : e);
    return {
      id: 'opm',
      label: 'opm 构建工具',
      level: 'fail',
      message: '探测失败：' + msg,
      hint: '请在「包管理」中安装并启用 opm'
    };
  }
}

/** 检查 tsc 是否可用（走隐藏执行器） */
async function checkTsc(): Promise<CheckItem> {
  try {
    const fn: any = (globalThis as any).toolCall;
    if (typeof fn !== 'function') {
      return {
        id: 'tsc',
        label: 'TypeScript 编译器',
        level: 'fail',
        message: '当前运行时不支持 toolCall'
      };
    }
    const raw: any = await fn('devtool:tsc_check', {});
    let parsed: any = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    }
    if (parsed && parsed.success === true) {
      const ver = (parsed.data && parsed.data.version) || '';
      return {
        id: 'tsc',
        label: 'TypeScript 编译器',
        level: 'ok',
        message: ver ? 'tsc ' + ver + ' 可用' : 'tsc 可用'
      };
    }
    return {
      id: 'tsc',
      label: 'TypeScript 编译器',
      level: 'warn',
      message: 'tsc 不可用' + (parsed && parsed.message ? '：' + parsed.message : ''),
      hint: '仅影响 ts / toolpkg-ts 项目的编译，js 项目不受影响'
    };
  } catch (e) {
    return {
      id: 'tsc',
      label: 'TypeScript 编译器',
      level: 'warn',
      message: '探测失败：' + String((e as any).message || e),
      hint: '仅影响 ts / toolpkg-ts 项目的编译'
    };
  }
}

/** 检查 node.operit 依赖（针对某个项目） */
async function checkNodeOperit(packageId: string): Promise<CheckItem> {
  try {
    const fn: any = (globalThis as any).toolCall;
    if (typeof fn !== 'function') {
      return {
        id: 'node-operit',
        label: 'node.operit 依赖',
        level: 'warn',
        message: '当前运行时不支持 toolCall'
      };
    }
    // 用 stat 查项目里有没有 node_modules/@serveryyswys/node.operit/BUILTINS.json
    const probePath = '/mydata/node_modules/@serveryyswys/node.operit/BUILTINS.json';
    const raw: any = await fn('devtool:stat', { package_id: packageId, path: probePath });
    let parsed: any = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    }
    if (parsed && parsed.success === true && parsed.data && parsed.data.exists) {
      return {
        id: 'node-operit',
        label: 'node.operit 依赖',
        level: 'ok',
        message: '已随项目入库，opm 打包可直接复用'
      };
    }
    return {
      id: 'node-operit',
      label: 'node.operit 依赖',
      level: 'warn',
      message: '项目内尚未提取 node.operit',
      hint: '跑一次 opm_init 或 opm_build 即可自动提取'
    };
  } catch (e) {
    return {
      id: 'node-operit',
      label: 'node.operit 依赖',
      level: 'warn',
      message: '探测失败：' + String((e as any).message || e)
    };
  }
}

/** 跑一遍完整环境检查 */
export async function runEnvCheck(packageId?: string): Promise<EnvReport> {
  const items: CheckItem[] = [];

  // 1) dev_package 根目录可写
  const devRoot = await probeWritable(DEV_PACKAGE_ROOT);
  items.push({
    id: 'dir-dev-package',
    label: '开发目录写入',
    level: devRoot.ok ? 'ok' : 'fail',
    message: devRoot.ok ? DEV_PACKAGE_ROOT + ' 可写' : DEV_PACKAGE_ROOT + ' ' + devRoot.reason,
    hint: devRoot.ok ? undefined : '请检查存储权限，或确认该路径未被占用'
  });

  // 2) cleanOnExit 根目录可写（confirm 记录落这里）
  const cleanRoot = await probeWritable(OPERIT_ROOT + '/cleanOnExit');
  items.push({
    id: 'dir-cleanonexit',
    label: '确认记录目录写入',
    level: cleanRoot.ok ? 'ok' : 'fail',
    message: cleanRoot.ok ? OPERIT_ROOT + '/cleanOnExit 可写' : 'cleanOnExit 不可写：' + cleanRoot.reason,
    hint: cleanRoot.ok ? undefined : '确认框需要在这里落盘，不可写会导致危险操作无法确认'
  });

  // 3) opm
  items.push(await checkOpm());

  // 4) tsc
  items.push(await checkTsc());

  // 5) node.operit（只有传了项目才查）
  if (packageId) {
    items.push(await checkNodeOperit(packageId));
  }

  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].level === 'ok') okCount++;
    else if (items[i].level === 'warn') warnCount++;
    else failCount++;
  }

  return {
    items: items,
    okCount: okCount,
    warnCount: warnCount,
    failCount: failCount,
    healthy: failCount === 0,
    checkedAt: new Date().toISOString()
  };
}