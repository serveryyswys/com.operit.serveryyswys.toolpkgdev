// upload / export 服务
//
// upload：从物理路径读一个文件（含二进制），写入虚拟文件系统并记自动快照
// export：把虚拟文件写到 opt/ 之下（opt 是虚拟根 /mydata 的物理宿主）
//
// export 的覆盖策略（已与用户确认）：
//   默认「目标已存在就失败」，只有显式 overwrite=true 才覆盖

import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import { appendWithPrune } from './autoSnapService';
import { normalizeVirtualPath, virtualToPhysical, projectOptDir } from '../util/paths';
import { nowIso } from '../util/time';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import {
  exists,
  mkdirp,
  readFileAny,
  writeText,
  writeBinaryB64,
  fileExists,
  walkFiles,
  listDir,
  statSize
} from '../util/files';

export interface UploadOptions {
  packageId: string;
  /** 源物理文件绝对路径（Android 侧） */
  localPath: string;
  /** 目标虚拟路径，例如 /mydata/src/a.ts；不传则用源文件名放到 /mydata 下 */
  virtualPath?: string;
  /** 必填描述 */
  description: string;
  /** 目标已存在时是否覆盖 */
  overwrite?: boolean;
}

export interface UploadResult {
  path: string;
  isBinary: boolean;
  size: number;
  checksum: string;
  autoSnapId: number;
  source: string;
}

/** 上传单个文件到虚拟文件系统 */
export async function uploadFile(opts: UploadOptions): Promise<UploadResult> {
  if (!opts || !opts.localPath) throw new Error('upload 需要 localPath');
  if (!opts.description || !String(opts.description).trim()) {
    throw new Error('upload 必须提供 description');
  }

  if (!exists(opts.localPath)) {
    throw new Error('源文件不存在: ' + opts.localPath);
  }

  const any = readFileAny(opts.localPath);
  const fileName = String(opts.localPath).split('/').pop() || 'file';
  const target = opts.virtualPath
    ? normalizeVirtualPath(opts.virtualPath)
    : normalizeVirtualPath('mydata/' + fileName);

  const db = await openProjectDb(opts.packageId);
  const before = vfs.getFile(db, target);
  if (before && !opts.overwrite) {
    throw new Error('目标已存在: ' + target + '（如需覆盖请传 overwrite=true）');
  }

  const now = nowIso();
  const checksum = sha256Hex(any.isBinary === 1 ? 'b64:' + any.content : any.content);
  const size = any.isBinary === 1 ? b64ByteLength(any.content) : utf8ByteLength(any.content);

  // 补父目录
  const segs = target.split('/');
  let cur = '';
  for (let k = 0; k < segs.length - 1; k++) {
    cur = cur ? cur + '/' + segs[k] : segs[k];
    vfs.putDir(db, cur, now);
  }

  vfs.putFile(db, target, any.isBinary, any.content, size, checksum, now, !before);

  const snapId = appendWithPrune(db, {
    tool: 'upload',
    description: opts.description,
    changeType: before ? 'modify' : 'create',
    path: target,
    beforeContent: before ? before.content : null,
    beforeIsBinary: before ? before.isBinary : null,
    afterContent: any.content,
    afterIsBinary: any.isBinary,
    beforeChecksum: before ? before.checksum : null,
    afterChecksum: checksum,
    createdAt: now
  });

  return {
    path: target,
    isBinary: any.isBinary === 1,
    size: size,
    checksum: checksum,
    autoSnapId: snapId,
    source: opts.localPath
  };
}

/** 批量上传一个目录（递归保留结构） */
export async function uploadDir(opts: {
  packageId: string;
  localDir: string;
  /** 目标虚拟目录，默认 /mydata */
  virtualDir?: string;
  description: string;
  overwrite?: boolean;
}): Promise<{ uploaded: string[]; skipped: string[] }> {
  if (!opts.description || !String(opts.description).trim()) {
    throw new Error('upload 必须提供 description');
  }
  if (!exists(opts.localDir)) throw new Error('源目录不存在: ' + opts.localDir);

  const baseVirtual = opts.virtualDir ? normalizeVirtualPath(opts.virtualDir) : 'mydata';
  const files = walkFiles(opts.localDir);
  const uploaded: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    try {
      const r = await uploadFile({
        packageId: opts.packageId,
        localPath: opts.localDir.replace(/\/+$/, '') + '/' + rel,
        virtualPath: baseVirtual + '/' + rel,
        description: opts.description + ' (' + rel + ')',
        overwrite: opts.overwrite
      });
      uploaded.push(r.path);
    } catch (e) {
      skipped.push(rel + ' (' + String((e as any).message || e) + ')');
    }
  }
  return { uploaded: uploaded, skipped: skipped };
}

export interface ExportOptions {
  packageId: string;
  /** 要导出的虚拟路径；可以是文件或目录，默认整个 /mydata */
  virtualPath?: string;
  /** 导出目标（虚拟路径），默认 /mydata/export；物理落点 = opt + 该路径 */
  targetDir?: string;
  /** 目标已存在时是否覆盖，默认 false（失败） */
  overwrite?: boolean;
}

export interface ExportResult {
  /** 虚拟目标目录 */
  virtualTarget: string;
  /** 物理落点：{项目根}/opt/mydata/... */
  physicalTarget: string;
  files: Array<{ virtualPath: string; physicalPath: string; size: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * 把虚拟文件导出到 opt 物理落地区。
 * 默认目标已存在就失败；overwrite=true 才覆盖。
 */
export async function exportToOpt(opts: ExportOptions): Promise<ExportResult> {
  const db = await openProjectDb(opts.packageId);

  const sourcePrefix = opts.virtualPath ? normalizeVirtualPath(opts.virtualPath) : 'mydata';
  const targetVirtual = opts.targetDir ? normalizeVirtualPath(opts.targetDir) : 'mydata/export';
  const physicalTarget = virtualToPhysical(opts.packageId, targetVirtual);

  mkdirp(physicalTarget);

  // 收集要导出的文件
  const all = vfs.listAllFiles(db);
  const picked: Array<{ path: string; isBinary: number; content: string; size: number }> = [];

  // 先判断 sourcePrefix 是不是单个文件
  const single = vfs.getFile(db, sourcePrefix);
  if (single) {
    picked.push({ path: single.path, isBinary: single.isBinary, content: single.content, size: single.size });
  } else {
    const prefix = sourcePrefix + '/';
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      if (f.path === sourcePrefix || f.path.indexOf(prefix) === 0) {
        const full = vfs.getFile(db, f.path);
        if (full) picked.push({ path: full.path, isBinary: full.isBinary, content: full.content, size: full.size });
      }
    }
  }

  if (!picked.length) throw new Error('没有可导出的文件: ' + sourcePrefix);

  const files: Array<{ virtualPath: string; physicalPath: string; size: number }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  // 计算相对源前缀的路径
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i];
    let rel: string;
    if (single) {
      rel = f.path.split('/').pop() || 'out';
    } else {
      rel = f.path.indexOf(sourcePrefix + '/') === 0 ? f.path.slice(sourcePrefix.length + 1) : f.path;
    }

    const abs = physicalTarget.replace(/\/+$/, '') + '/' + rel;

    if (fileExists(abs) && !opts.overwrite) {
      skipped.push({ path: f.path, reason: '目标已存在: ' + abs + '（如需覆盖请传 overwrite=true）' });
      continue;
    }

    try {
      const parent = abs.slice(0, abs.lastIndexOf('/'));
      if (parent) mkdirp(parent);
      if (f.isBinary === 1) writeBinaryB64(abs, f.content);
      else writeText(abs, f.content);
      files.push({ virtualPath: f.path, physicalPath: abs, size: f.size });
    } catch (e) {
      skipped.push({ path: f.path, reason: String((e as any).message || e) });
    }
  }

  return {
    virtualTarget: targetVirtual,
    physicalTarget: physicalTarget,
    files: files,
    skipped: skipped
  };
}

/** 从 opt 导入回虚拟文件系统（export 的逆操作） */
export async function importFromOpt(opts: {
  packageId: string;
  /** opt 下的相对路径或完整物理路径 */
  physicalPath: string;
  virtualDir?: string;
  description: string;
  overwrite?: boolean;
}): Promise<{ imported: string[]; skipped: string[] }> {
  const optRoot = projectOptDir(opts.packageId);
  let abs = opts.physicalPath;
  if (abs.indexOf('/') !== 0) {
    abs = optRoot.replace(/\/+$/, '') + '/' + abs;
  }
  if (!exists(abs)) throw new Error('路径不存在: ' + abs);

  const size = statSize(abs);
  if (size >= 0) {
    const r = await uploadFile({
      packageId: opts.packageId,
      localPath: abs,
      virtualPath: opts.virtualDir ? normalizeVirtualPath(opts.virtualDir) + '/' + (abs.split('/').pop() || 'file') : undefined,
      description: opts.description,
      overwrite: opts.overwrite
    });
    return { imported: [r.path], skipped: [] };
  }

  // 目录
  const dirRes = await uploadDir({
    packageId: opts.packageId,
    localDir: abs,
    virtualDir: opts.virtualDir,
    description: opts.description,
    overwrite: opts.overwrite
  });
  return { imported: dirRes.uploaded, skipped: dirRes.skipped };
}

/** 列出 opt 物理落地区（方便查看导出了什么） */
export function listOptDir(packageId: string, subPath?: string): Array<{
  path: string;
  isDirectory: boolean;
  size: number;
}> {
  const optRoot = projectOptDir(packageId);
  const target = subPath ? optRoot.replace(/\/+$/, '') + '/' + subPath.replace(/^\/+/, '') : optRoot;
  if (!exists(target)) return [];
  const entries = listDir(target);
  return entries.map(function (e) {
    return {
      path: target.replace(/\/+$/, '') + '/' + e.name,
      isDirectory: e.isDirectory,
      size: e.size
    };
  });
}