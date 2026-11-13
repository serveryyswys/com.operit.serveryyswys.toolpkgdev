// 能力守卫：按项目类型限制可用工具
//
// 两类硬约束：
//   - tsc 只在含 TS 源码的项目里有意义（ts / toolpkg-ts）
//   - opm 系列只服务 ToolPkg 工程（toolpkg-js / toolpkg-ts），
//     纯 script（js / ts）项目不走 opm 打包流程
//
// 这些限制不是性能优化，而是语义约束：在错误的项目类型上跑这些工具，
// 要么产出无意义的垃圾文件，要么让用户在完全不符合预期的目录结构里打转。

import { readMetadata } from './projectService';
import type { ProjectType } from '../model/project';

export type Capability = 'tsc' | 'opm';

export interface CapabilityCheck {
  allowed: boolean;
  type: ProjectType | null;
  reason: string;
}

const TS_TYPES: ProjectType[] = ['ts', 'toolpkg-ts'];
const TOOLPKG_TYPES: ProjectType[] = ['toolpkg-js', 'toolpkg-ts'];

/** 读项目类型；失败返回 null（项目不存在时让上层自己报错） */
function resolveType(packageId: string): ProjectType | null {
  try {
    return readMetadata(packageId).type;
  } catch (e) {
    return null;
  }
}

/** 检查某能力是否可用于该项目 */
export function checkCapability(packageId: string, capability: Capability): CapabilityCheck {
  const type = resolveType(packageId);

  if (!type) {
    return {
      allowed: false,
      type: null,
      reason: '项目不存在或缺少 metadata.json：' + packageId
    };
  }

  if (capability === 'tsc') {
    if (TS_TYPES.indexOf(type) >= 0) {
      return { allowed: true, type: type, reason: '' };
    }
    return {
      allowed: false,
      type: type,
      reason: 'tsc 仅适用于 TypeScript 项目（ts / toolpkg-ts），当前项目类型是 ' + type
        + '，没有 TS 源码需要编译。如需编译请改用对应的 TS 类型项目。'
    };
  }

  // capability === 'opm'
  if (TOOLPKG_TYPES.indexOf(type) >= 0) {
    return { allowed: true, type: type, reason: '' };
  }
  return {
    allowed: false,
    type: type,
    reason: 'opm 仅服务 ToolPkg 工程（toolpkg-js / toolpkg-ts），当前项目类型是 ' + type
      + '。script 类型项目不走 .toolpkg 打包流程，应直接用沙盒脚本方式安装（debug_install_js_package）。'
  };
}

/** 断言能力可用，不可用直接抛错（工具层统一 catch） */
export function assertCapability(packageId: string, capability: Capability): void {
  const r = checkCapability(packageId, capability);
  if (!r.allowed) throw new Error(r.reason);
}

/** 一次性返回项目的能力矩阵，便于工具层/界面展示 */
export function capabilityMatrix(packageId: string): {
  type: ProjectType | null;
  tsc: CapabilityCheck;
  opm: CapabilityCheck;
} {
  const tsc = checkCapability(packageId, 'tsc');
  const opm = checkCapability(packageId, 'opm');
  return {
    type: tsc.type || opm.type,
    tsc: tsc,
    opm: opm
  };
}