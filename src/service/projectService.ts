// 项目服务：init、注册表维护、metadata 读写、license 下载
//
// init 的落盘结果是固定的三件套：
//   {项目根}/storage.db    虚拟文件系统 + 快照（全部在 db 里）
//   {项目根}/.devtool/     devtool 自身数据（tsc 临时目录等）
//   {项目根}/metadata.json 项目元信息

import { openProjectDb, closeProjectDb } from '../storage/database';
import { dbExec } from '../util/sqlite';
import * as vfs from '../storage/vfsDao';
import { setMeta, getMeta } from '../storage/vfsDao';
import {
  REGISTRY_ROOT,
  REGISTRY_FILE,
  METADATA_FILE,
  DEVTOOL_DIR,
  OPT_DIR,
  LICENSE_RAW_BASE,
  LICENSE_FILE_NAME,
  LICENSE_CHOICES
} from '../model/constants';
import {
  assertSafePackageId,
  projectRoot,
  projectMetadataPath,
  projectDevtoolDir,
  projectOptDir,
  projectTscTmpDir
} from '../util/paths';
import { nowIso, currentYear } from '../util/time';
import { mkdirp, exists, readText, writeText } from '../util/files';
import { sha256Hex, utf8ByteLength } from '../util/bytes';
import * as autoSnapDao from '../storage/autoSnapDao';
import { buildTemplates, deriveShortName } from './templates';
import { PROJECT_TYPES } from '../model/project';
import type { ProjectMetadata, ProjectType, RegistryEntry, RegistryFile } from '../model/project';

export interface InitParams {
  packageId: string;
  type: ProjectType;
  displayName?: string;
  description?: string;
  author?: string;
  /** SPDX 标识符；UNLICENSED 表示不写 license 文件 */
  license?: string;
  /** 是否覆盖已存在的项目 */
  force?: boolean;
}

export interface InitResult {
  packageId: string;
  type: ProjectType;
  projectPath: string;
  dbPath: string;
  devtoolDir: string;
  optDir: string;
  metadataPath: string;
  createdFiles: string[];
  licenseWritten: boolean;
  licenseSpdx: string;
  warnings: string[];
}

/** 读注册表；不存在时返回空结构 */
function loadRegistry(): RegistryFile {
  try {
    if (!exists(REGISTRY_FILE)) {
      return { version: 1, entries: [] };
    }
    const raw = readText(REGISTRY_FILE);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return { version: Number(parsed.version || 1), entries: parsed.entries };
  } catch (e) {
    return { version: 1, entries: [] };
  }
}

/** 写注册表 */
function saveRegistry(reg: RegistryFile): void {
  mkdirp(REGISTRY_ROOT);
  writeText(REGISTRY_FILE, JSON.stringify(reg, null, 2) + '\n');
}

/** 注册或更新一个项目条目 */
function upsertRegistryEntry(entry: RegistryEntry, isNew: boolean): void {
  const reg = loadRegistry();
  const idx = reg.entries.findIndex(function (e) { return e.packageId === entry.packageId; });
  if (idx >= 0) {
    entry.createdAt = reg.entries[idx].createdAt; // 保留原始创建时间
    reg.entries[idx] = entry;
  } else if (isNew) {
    reg.entries.push(entry);
  } else {
    reg.entries.push(entry);
  }
  saveRegistry(reg);
}

/** 列出注册表里的全部项目 */
export function listProjects(): RegistryEntry[] {
  return loadRegistry().entries;
}

/** 查单个项目条目 */
export function findProject(packageId: string): RegistryEntry | null {
  const reg = loadRegistry();
  const id = assertSafePackageId(packageId);
  for (let i = 0; i < reg.entries.length; i++) {
    if (reg.entries[i].packageId === id) return reg.entries[i];
  }
  return null;
}

/** 从注册表移除 */
export function unregisterProject(packageId: string): boolean {
  const reg = loadRegistry();
  const id = assertSafePackageId(packageId);
  const before = reg.entries.length;
  reg.entries = reg.entries.filter(function (e) { return e.packageId !== id; });
  if (reg.entries.length === before) return false;
  saveRegistry(reg);
  return true;
}

/** 读 metadata.json */
export function readMetadata(packageId: string): ProjectMetadata {
  const id = assertSafePackageId(packageId);
  const p = projectMetadataPath(id);
  if (!exists(p)) throw new Error('项目不存在或缺少 metadata.json: ' + id);
  const raw = readText(p);
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error('metadata.json 解析失败: ' + String((e as any).message || e));
  }
  return {
    packageId: String(obj.packageId || id),
    type: String(obj.type || 'js') as ProjectType,
    displayName: String(obj.displayName || id),
    description: String(obj.description || ''),
    author: String(obj.author || ''),
    license: String(obj.license || 'UNLICENSED'),
    createdAt: String(obj.createdAt || ''),
    updatedAt: String(obj.updatedAt || ''),
    schemaVersion: Number(obj.schemaVersion || 1)
  };
}

/** 写 metadata.json */
export function writeMetadata(meta: ProjectMetadata): void {
  const p = projectMetadataPath(meta.packageId);
  mkdirp(projectRoot(meta.packageId));
  writeText(p, JSON.stringify(meta, null, 2) + '\n');
}

/** 触摸 updatedAt */
export function touchMetadata(packageId: string): void {
  try {
    const meta = readMetadata(packageId);
    meta.updatedAt = nowIso();
    writeMetadata(meta);
  } catch (e) {
    // 元信息缺失时不阻塞主流程
  }
}

/** metadata 可改字段（packageId / createdAt / schemaVersion 不允许改） */
export interface MetadataPatch {
  type?: ProjectType;
  displayName?: string;
  description?: string;
  author?: string;
  license?: string;
}

/**
 * 更新项目 metadata。
 * 不可改的字段：packageId（= 目录名，与项目路径绑定）、createdAt、schemaVersion。
 * 传进来的未知字段会被忽略并列在 ignored 里，避免静默吞掉拼写错误。
 */
export function updateMetadata(
  packageId: string,
  patch: MetadataPatch
): {
  meta: ProjectMetadata;
  changed: string[];
  unchanged: string[];
  ignored: string[];
} {
  const id = assertSafePackageId(packageId);
  const current = readMetadata(id);

  const allowed = ['type', 'displayName', 'description', 'author', 'license'];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const ignored: string[] = [];

  // 收集调用方给了但不在白名单里的键
  const keys = Object.keys(patch || {});
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'packageId' || k === 'package_id' || k === 'name') {
      throw new Error('包名 / 项目名不可修改：它与项目目录路径绑定。如需改名请新建项目后迁移内容。');
    }
    if (k === 'createdAt' || k === 'schemaVersion') {
      ignored.push(k);
      continue;
    }
    if (allowed.indexOf(k) < 0) ignored.push(k);
  }

  const next: ProjectMetadata = {
    packageId: current.packageId,
    type: current.type,
    displayName: current.displayName,
    description: current.description,
    author: current.author,
    license: current.license,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    schemaVersion: current.schemaVersion
  };

  // type
  if (patch.type !== undefined) {
    const t = assertProjectType(patch.type);
    if (t !== current.type) { next.type = t; changed.push('type'); }
    else unchanged.push('type');
  }
  // displayName
  if (patch.displayName !== undefined) {
    const v = String(patch.displayName);
    if (v !== current.displayName) { next.displayName = v; changed.push('displayName'); }
    else unchanged.push('displayName');
  }
  // description
  if (patch.description !== undefined) {
    const v = String(patch.description);
    if (v !== current.description) { next.description = v; changed.push('description'); }
    else unchanged.push('description');
  }
  // author
  if (patch.author !== undefined) {
    const v = String(patch.author);
    if (v !== current.author) { next.author = v; changed.push('author'); }
    else unchanged.push('author');
  }
  // license
  if (patch.license !== undefined) {
    const v = assertLicense(patch.license);
    if (v !== current.license) { next.license = v; changed.push('license'); }
    else unchanged.push('license');
  }

  if (changed.length) {
    next.updatedAt = nowIso();
    writeMetadata(next);

    // 同步注册表里的类型
    if (changed.indexOf('type') >= 0) {
      const reg = loadRegistry();
      for (let i = 0; i < reg.entries.length; i++) {
        if (reg.entries[i].packageId === id) {
          reg.entries[i].type = next.type;
          reg.entries[i].updatedAt = next.updatedAt;
        }
      }
      saveRegistry(reg);
    }
  }

  return { meta: next, changed: changed, unchanged: unchanged, ignored: ignored };
}

/**
 * 下载许可证全文。
 * 从 SPDX 官方 license-list-data 仓库取，逐字节一致。
 */
async function fetchLicenseText(spdx: string): Promise<string> {
  const fileName = LICENSE_FILE_NAME[spdx];
  if (!fileName) throw new Error('不支持的许可证标识: ' + spdx);

  const url = LICENSE_RAW_BASE + fileName;
  // 用 Net.httpGet 取原始文本（签名：httpGet(url, ignore_ssl?)）
  let res: any;
  try {
    res = await (Tools as any).Net.httpGet(url, false);
  } catch (e) {
    throw new Error('许可证下载失败(' + spdx + '): ' + String((e as any).message || e));
  }
  if (res) {
    if (typeof res === 'string' && res.length) return res;
    if (res.content !== undefined && res.content !== null && String(res.content).length) return String(res.content);
    if (res.body !== undefined && res.body !== null && String(res.body).length) return String(res.body);
  }
  throw new Error('许可证下载返回空内容: ' + spdx);
}

/** 校验项目类型 */
function assertProjectType(t: any): ProjectType {
  const s = String(t || '').trim();
  for (let i = 0; i < PROJECT_TYPES.length; i++) {
    if (PROJECT_TYPES[i] === s) return PROJECT_TYPES[i];
  }
  throw new Error('项目类型必须是 ' + PROJECT_TYPES.join(' / ') + '，收到: ' + t);
}

/** 校验许可证选择 */
function assertLicense(spdx: any): string {
  if (spdx === undefined || spdx === null || spdx === '') return 'UNLICENSED';
  const s = String(spdx).trim();
  for (let i = 0; i < LICENSE_CHOICES.length; i++) {
    if (LICENSE_CHOICES[i].spdx === s) return s;
  }
  throw new Error('许可证必须是以下之一: ' + LICENSE_CHOICES.map(function (c) { return c.spdx; }).join(', '));
}

/**
 * 初始化一个项目。
 * 步骤：校验 -> 建目录 -> 建 db -> 写模板 -> 下载 license -> 写 metadata -> 注册
 */
export async function initProject(params: InitParams): Promise<InitResult> {
  if (!params || !params.packageId) throw new Error('init 需要 packageId');
  const packageId = assertSafePackageId(params.packageId);
  const type = assertProjectType(params.type);
  const license = assertLicense(params.license);
  const warnings: string[] = [];

  const root = projectRoot(packageId);
  const metaPath = projectMetadataPath(packageId);

  // 已存在检查
  if (exists(metaPath) && !params.force) {
    throw new Error('项目已存在: ' + packageId + '（如需覆盖请传 force=true）');
  }

  // 1) 建三件套目录
  mkdirp(root);
  mkdirp(projectDevtoolDir(packageId));
  mkdirp(projectTscTmpDir(packageId));
  mkdirp(projectOptDir(packageId));

  // 2) 建/重置数据库（force 时先关连接并清空旧数据）
  if (params.force) {
    closeProjectDb(packageId);
  }
  const db = await openProjectDb(packageId);

  if (params.force) {
    // 强制覆盖时清掉旧的虚拟文件、目录与历史，避免主键冲突
    
    dbExec(db, 'DELETE FROM vfs_files');
    dbExec(db, 'DELETE FROM vfs_dirs');
    dbExec(db, 'DELETE FROM autosnap_records');
    dbExec(db, 'DELETE FROM snapshot_files');
    dbExec(db, 'DELETE FROM snapshot_nodes');
    dbExec(db, 'DELETE FROM staging');
  }

  // 3) 生成模板文件（写进 db 虚拟文件系统，路径带 mydata 前缀）
  const shortName = deriveShortName(packageId);
  const now = nowIso();
  const createdFiles: string[] = [];

  const tpl = buildTemplates(type, {
    packageId: packageId,
    shortName: shortName,
    displayName: params.displayName || packageId,
    description: params.description || '',
    author: params.author || 'unknown',
    license: license,
    year: currentYear()
  });

  for (let i = 0; i < tpl.length; i++) {
    const f = tpl[i];
    const path = f.path; // 已带 mydata/ 前缀
    const isBinary = 0;
    const checksum = sha256Hex(f.content);
    const size = utf8ByteLength(f.content);

    // 补父目录
    const parents: string[] = [];
    const segs = path.split('/');
    let cur = '';
    for (let k = 0; k < segs.length - 1; k++) {
      cur = cur ? cur + '/' + segs[k] : segs[k];
      parents.push(cur);
    }
    for (let k = 0; k < parents.length; k++) vfs.putDir(db, parents[k], now);

    vfs.putFile(db, path, isBinary, f.content, size, checksum, now, true);
    createdFiles.push(path);
  }

  // 4) license 文件（物理放到 opt/mydata/LICENSE，同时进 db）
  let licenseWritten = false;
  if (license !== 'UNLICENSED') {
    try {
      const text = await fetchLicenseText(license);
      const licPath = 'mydata/LICENSE';
      const checksum = sha256Hex(text);
      const size = utf8ByteLength(text);
      vfs.putDir(db, 'mydata', now);
      vfs.putFile(db, licPath, 0, text, size, checksum, now, true);
      createdFiles.push(licPath);
      licenseWritten = true;
    } catch (e) {
      warnings.push('许可证下载失败，未写入 LICENSE: ' + String((e as any).message || e));
    }
  }

  // 5) 写入 db 元信息
  setMeta(db, 'packageId', packageId);
  setMeta(db, 'type', type);
  setMeta(db, 'shortName', shortName);
  setMeta(db, 'createdAt', now);

  // 6) 写 metadata.json
  const meta: ProjectMetadata = {
    packageId: packageId,
    type: type,
    displayName: params.displayName || packageId,
    description: params.description || '',
    author: params.author || 'unknown',
    license: license,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1
  };
  writeMetadata(meta);

  // 7) 注册
  upsertRegistryEntry({
    packageId: packageId,
    type: type,
    path: root,
    createdAt: now,
    updatedAt: now
  }, true);

  return {
    packageId: packageId,
    type: type,
    projectPath: root,
    dbPath: root + '/storage.db',
    devtoolDir: DEVTOOL_DIR,
    optDir: OPT_DIR,
    metadataPath: metaPath,
    createdFiles: createdFiles,
    licenseWritten: licenseWritten,
    licenseSpdx: license,
    warnings: warnings
  };
}

/** 项目状态总览（工具层的 status 用） */
export async function projectStatus(packageId: string): Promise<{
  meta: ProjectMetadata | null;
  registered: boolean;
  paths: { root: string; db: string; devtool: string; opt: string; metadata: string };
  dbStats: { files: number; dirs: number; bytes: number; autoSnaps: number } | null;
}> {
  const id = assertSafePackageId(packageId);
  const root = projectRoot(id);
  const paths = {
    root: root,
    db: root + '/storage.db',
    devtool: projectDevtoolDir(id),
    opt: projectOptDir(id),
    metadata: projectMetadataPath(id)
  };

  let meta: ProjectMetadata | null = null;
  try {
    meta = readMetadata(id);
  } catch (e) {
    meta = null;
  }

  let dbStats = null;
  try {
    if (exists(paths.db)) {
      const db = await openProjectDb(id);
      const s = vfs.stats(db);
      dbStats = {
        files: s.files,
        dirs: s.dirs,
        bytes: s.bytes,
        autoSnaps: autoSnapDao.countRecords(db)
      };
    }
  } catch (e) {
    dbStats = null;
  }

  return {
    meta: meta,
    registered: !!findProject(id),
    paths: paths,
    dbStats: dbStats
  };
}