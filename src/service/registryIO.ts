// 注册表落盘的最小 IO 封装
//
// 单独拆出来是为了打破循环依赖：
//   projectService -> 读写注册表
//   lifecycleService -> 摘注册表
// 两个都要写同一个 REGISTRY_FILE，把「写」这一步抽出来共用。

import { writeText, mkdirp } from '../util/files';
import { REGISTRY_ROOT, REGISTRY_FILE } from '../model/constants';

/** 把注册表对象写回磁盘（缩进 2 空格的 JSON） */
export function saveRegistryFile(reg: any): void {
  mkdirp(REGISTRY_ROOT);
  writeText(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n');
}