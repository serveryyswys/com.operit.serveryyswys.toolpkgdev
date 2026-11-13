// 路径工具：虚拟路径规范化、安全校验、项目目录推导

import {
  DEV_PACKAGE_ROOT,
  REGISTRY_ROOT,
  DB_FILE,
  METADATA_FILE,
  DEVTOOL_DIR,
  OPT_DIR,
  VIRTUAL_ROOT_PREFIX
} from '../model/constants';

/** 规范化虚拟路径：去前导斜杠、折叠 ./、拒绝 .. */
export function normalizeVirtualPath(input: string): string {
  if (input === null || input === undefined) throw new Error('路径不能为空');
  let s = String(input).trim();
  if (!s) throw new Error('路径不能为空');
  if (s.indexOf('\\') >= 0) throw new Error('路径不允许包含反斜杠: ' + input);

  // 允许 /mydata/... 与 mydata/... 两种写法
  s = s.replace(/^\/+/, '');
  const parts = s.split('/');
  const stack: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new Error('路径不允许包含上级引用: ' + input);
    stack.push(seg);
  }
  if (!stack.length) throw new Error('路径不能为空');
  const norm = stack.join('/');
  if (norm !== VIRTUAL_ROOT_PREFIX.slice(1) && norm.indexOf(VIRTUAL_ROOT_PREFIX.slice(1) + '/') !== 0) {
    throw new Error('虚拟路径必须位于 ' + VIRTUAL_ROOT_PREFIX + ' 之下: ' + input);
  }
  return norm;
}

/** 规范化包名（同时作为项目目录名）：仅允许字母数字 . _ - ，长度 >= 2 */
export function assertSafePackageId(packageId: string): string {
  if (!packageId || typeof packageId !== 'string') throw new Error('插件包名不能为空');
  const id = packageId.trim();
  if (id.length < 2) throw new Error('插件包名至少 2 个字符');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error('插件包名只能包含字母、数字、点、下划线、连字符: ' + packageId);
  }
  if (id === '.' || id === '..') throw new Error('插件包名非法: ' + packageId);
  return id;
}

/** 项目物理根目录 */
export function projectRoot(packageId: string): string {
  const id = assertSafePackageId(packageId);
  return DEV_PACKAGE_ROOT + '/' + id;
}

/** 项目数据库路径 */
export function projectDbPath(packageId: string): string {
  return projectRoot(packageId) + '/' + DB_FILE;
}

/** 项目 metadata.json 路径 */
export function projectMetadataPath(packageId: string): string {
  return projectRoot(packageId) + '/' + METADATA_FILE;
}

/** 项目 .devtool 目录 */
export function projectDevtoolDir(packageId: string): string {
  return projectRoot(packageId) + '/' + DEVTOOL_DIR;
}

/** 项目 tsc 临时目录 */
export function projectTscTmpDir(packageId: string): string {
  return projectDevtoolDir(packageId) + '/tsc_tmp';
}

/** 项目 opt 落地区根 */
export function projectOptDir(packageId: string): string {
  return projectRoot(packageId) + '/' + OPT_DIR;
}

/** 虚拟路径 -> opt 下的物理路径。/mydata/a/b -> {root}/opt/mydata/a/b */
export function virtualToPhysical(packageId: string, virtualPath: string): string {
  const v = normalizeVirtualPath(virtualPath);
  return projectOptDir(packageId) + '/' + v;
}

/** 注册表目录 */
export function registryRoot(): string {
  return REGISTRY_ROOT;
}

/** 取文件名 */
export function baseName(p: string): string {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

/** 取父目录（虚拟路径，无前导斜杠） */
export function dirName(p: string): string {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? '' : s.slice(0, i);
}

/** 取扩展名（不含点，小写） */
export function extName(p: string): string {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  if (i <= 0) return '';
  return b.slice(i + 1).toLowerCase();
}

/** 判断路径是否在另一目录之下 */
export function isUnderPrefix(path: string, prefix: string): boolean {
  const p = String(path).replace(/\/+$/, '');
  const q = String(prefix).replace(/\/+$/, '');
  return p === q || p.indexOf(q + '/') === 0;
}

/** 拼接并可选择地产生父目录链 */
export function allParentDirs(virtualPath: string): string[] {
  const out: string[] = [];
  const d = dirName(virtualPath);
  if (!d) return out;
  const parts = d.split('/');
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    out.push(cur);
  }
  return out;
}