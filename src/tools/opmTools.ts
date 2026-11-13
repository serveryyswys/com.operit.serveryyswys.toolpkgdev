// opm 集成工具
//
// 保留 opm 的：init / search / install / remove / license / changelog / build / verify / pack / version
// 剥离 opm 的：manager（辰锤资源中心投稿客户端，本包用不到）
//
// 与原 opm 的关键差异：
//   原 opm 直接操作项目物理目录；本包的 opm 需要先把虚拟文件系统落地到
//   .devtool/opm_work/，跑完 opm 再把产物写回/导出，最后清理。
//   因为 opm 的底层实现（npm 安装、tsc、压缩）都依赖真实文件路径。

import { ok, failFrom, requireString, optString, optBool, optNumber, optStringArray } from './result';
import type { ToolResult } from '../model/constants';
import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import { projectRoot, projectDevtoolDir } from '../util/paths';
import { mkdirp, remove, writeText, writeBinaryB64, walkFiles, readFileAny, exists, statSize } from '../util/files';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import { nowIso } from '../util/time';
import { appendWithPrune } from '../service/autoSnapService';
import { assertCapability } from '../service/capabilityService';

const OPM_WORK_DIR = '/opm_work';

/** 清理历史遗留的非法虚拟路径（mydata//xxx 双斜杠、mydata/./xxx、mydata/ 结尾），返回删除条数 */
function purgeInvalidPaths(db: any): number {
  try {
    const rows = db.query("SELECT path FROM vfs_files WHERE path LIKE 'mydata//%' OR path LIKE 'mydata/./%' OR path LIKE 'mydata/.' ESCAPE '\\'");
    const bad: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const p = String(rows[i].path || '');
      if (!p) continue;
      // 判定：以 mydata// 开头，或包含 '/./'，或以 '/' 结尾
      if (p.indexOf('mydata//') === 0 || p.indexOf('/./') >= 0 || p.charAt(p.length - 1) === '/') {
        bad.push(p);
      }
    }
    for (let i = 0; i < bad.length; i++) {
      db.exec("DELETE FROM vfs_files WHERE path = '" + bad[i].replace(/'/g, "''") + "'");
    }
    return bad.length;
  } catch (e) {
    return 0;
  }
}

/** 把虚拟文件落地到物理工作目录，返回工作目录绝对路径 */
async function materialize(packageId: string, subDir: string): Promise<string> {
  const db = await openProjectDb(packageId);
  purgeInvalidPaths(db);
  const workDir = projectDevtoolDir(packageId) + OPM_WORK_DIR + '/' + subDir;
  remove(workDir, true);
  mkdirp(workDir);

  const files = vfs.listAllFiles(db);
  let okCount = 0;
  let failCount = 0;
  let lastErr = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = f.path.replace(/^mydata\//, '');
    if (!rel) continue;
    const abs = workDir + '/' + rel;
    const parent = abs.slice(0, abs.lastIndexOf('/'));
    if (parent) mkdirp(parent);
    try {
      if (f.isBinary === 1) writeBinaryB64(abs, f.content);
      else writeText(abs, f.content);
      okCount++;
    } catch (e) {
      failCount++;
      if (!lastErr) lastErr = rel + ' -> ' + String((e as any).message || e);
      // 单个文件失败不应中断整体落盘，但必须计数
    }
  }
  if (failCount > 0) {
    throw new Error(
      '虚拟文件落盘失败 ' + failCount + '/' + (okCount + failCount) + ' 个。首个失败：' + lastErr
    );
  }
  return workDir;
}
/**
 * 从工作目录提取 npm 依赖到虚拟文件系统。
 *
 * 提取范围（按用户要求全量）：
 *   - node_modules/      整棵依赖树
 *   - package.json
 *   - package-lock.json
 *   - .npmrc
 *
 * 安全阀：
 *   - 单次提取总字节超过 maxBytes（默认 100MB）直接拒绝，避免 db 无提示膨胀到几百 MB
 *   - 跳过 .bin 里的软链占位与 .cache 等明显可再生的目录
 */
export interface ExtractDepsOptions {
  packageId: string;
  workDir: string;
  /** 总体积上限（字节），默认 100MB */
  maxBytes?: number;
  /** 是否把 node_modules 也写进 db，默认 true */
  includeNodeModules?: boolean;
  /** 触发工具名，默认 opm.build */
  tool?: string;
}

export interface ExtractDepsResult {
  written: string[];
  /** 已存在且内容一致，本次未重写的文件（不是失败，是去重命中） */
  unchanged: string[];
  skipped: string[];
  totalBytes: number;
  denied: boolean;
  deniedReason: string;
  /** 诊断用：入口处的判定情况 */
  diag?: any;
}

/** 递归统计目录体积（字节），用于提前判断是否超阈值 */
function measureDirBytes(root: string): number {
  let total = 0;
  const files = walkFiles(root);
  for (let i = 0; i < files.length; i++) {
    const sz = statSize(root.replace(/\/+$/, '') + '/' + files[i]);
    if (sz > 0) total += sz;
  }
  return total;
}

const SKIP_DIR_SEGMENTS = ['/.bin/', '/.cache/', '/.bin', '/.cache'];

function shouldSkipRel(rel: string): boolean {
  const p = '/' + rel;
  for (let i = 0; i < SKIP_DIR_SEGMENTS.length; i++) {
    if (p.indexOf(SKIP_DIR_SEGMENTS[i]) >= 0) return true;
  }
  return false;
}

/**
 * 把 npm 依赖相关文件从物理工作目录写回虚拟文件系统。
 * 与 saveBack 的区别：saveBack 用于普通产物，这里专门处理依赖，
 * 带体积阀值判断与 node_modules 跳过规则。
 */
export async function extractDeps(opts: ExtractDepsOptions): Promise<ExtractDepsResult> {
  const db = await openProjectDb(opts.packageId);
  const work = opts.workDir.replace(/\/+$/, '');
  const includeNm = opts.includeNodeModules !== false;
  const maxBytes = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : 100 * 1024 * 1024;
  const tool = opts.tool || 'opm.build';

  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  const diag: any = {
    work: work,
    includeNm: includeNm,
    nmExists: false,
    nmWalk: -1,
    topExists: {}
  };

  // 1) 先估算体积，超阈值直接拒绝（不做半截写入）
  if (includeNm) {
    const nmRoot = work + '/node_modules';
    diag.nmExists = exists(nmRoot);
    if (diag.nmExists) {
      try { diag.nmWalk = walkFiles(nmRoot).length; } catch (e) { diag.nmWalk = -2; }
    }
    const nmBytes = measureDirBytes(nmRoot);
    if (nmBytes > maxBytes) {
      return {
        written: [],
        unchanged: [],
        skipped: [],
        totalBytes: nmBytes,
        denied: true,
        deniedReason:
          'node_modules 体积 ' + (nmBytes / 1024 / 1024).toFixed(1) + ' MB，'
          + '超过单次提取上限 ' + (maxBytes / 1024 / 1024).toFixed(0) + ' MB。\n'
          + '为避免 storage.db 无提示膨胀，本次未写入任何依赖文件。\n'
          + '如需强制提取，请在 metadata 里把 dependency_max_mb 调大后重试。',
        diag: diag
      };
    }
  }

  const now = nowIso();

  /** 写一批相对路径 */
  const writeRel = function (relBase: string, rels: string[]): void {
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      if (shouldSkipRel(rel)) { skipped.push((relBase ? relBase + '/' : '') + rel + ' (skip rule)'); continue; }
      const abs = work + '/' + relBase + '/' + rel;
      const any = readFileAny(abs);
      // relBase 为空（顶层清单文件）时直接挂 mydata 下，避免拼出 mydata//xxx
      const targetPath = relBase ? ('mydata/' + relBase + '/' + rel) : ('mydata/' + rel);
      const checksum = sha256Hex(any.isBinary === 1 ? 'b64:' + any.content : any.content);
      const size = any.isBinary === 1 ? b64ByteLength(any.content) : utf8ByteLength(any.content);

      const segs = targetPath.split('/');
      let cur = '';
      for (let k = 0; k < segs.length - 1; k++) {
        cur = cur ? cur + '/' + segs[k] : segs[k];
        vfs.putDir(db, cur, now);
      }

      const before = vfs.getFile(db, targetPath);
      // 内容没变就跳过写入，但仍计入 unchanged，避免上层误判「什么都没提取到」
      if (before && before.checksum === checksum) {
        unchanged.push(targetPath);
        totalBytes += size;
        continue;
      }

      vfs.putFile(db, targetPath, any.isBinary, any.content, size, checksum, now, !before);
      appendWithPrune(db, {
        tool: tool,
        description: '提取依赖: ' + relBase + '/' + rel,
        changeType: before ? 'modify' : 'create',
        path: targetPath,
        beforeContent: before ? before.content : null,
        beforeIsBinary: before ? before.isBinary : null,
        afterContent: any.content,
        afterIsBinary: any.isBinary,
        beforeChecksum: before ? before.checksum : null,
        afterChecksum: checksum,
        createdAt: now
      });
      written.push(targetPath);
      totalBytes += size;
    }
  };

  // 2) 顶层清单文件
  const topFiles = ['package.json', 'package-lock.json', '.npmrc'];
  for (let i = 0; i < topFiles.length; i++) {
    const f = topFiles[i];
    if (!exists(work + '/' + f)) { continue; }
    writeRel('', [f]);
  }

  // 3) node_modules 整棵树
  if (includeNm && exists(work + '/node_modules')) {
    const nmFiles = walkFiles(work + '/node_modules');
    diag.nmFilesFound = nmFiles.length;
    writeRel('node_modules', nmFiles);
  }

  return {
    written: written,
    unchanged: unchanged,
    skipped: skipped,
    totalBytes: totalBytes,
    denied: false,
    deniedReason: '',
    diag: diag
  };
}
/** 把工作目录里指定子路径的文件回写进虚拟文件系统 */
async function saveBack(
  packageId: string,
  workDir: string,
  relSubPath: string,
  tool: string,
  description: string
): Promise<string[]> {
  const db = await openProjectDb(packageId);
  // 归一化：'.' 表示工作目录根，避免拼出 mydata/./xxx 这类冗余路径
  const cleanSub = String(relSubPath || '').replace(/^\/+/, '').replace(/^\.\/?$/, '');
  const root = cleanSub ? workDir.replace(/\/+$/, '') + '/' + cleanSub : workDir.replace(/\/+$/, '');
  const written: string[] = [];
  const now = nowIso();

  const files = walkFiles(root);
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const abs = root + '/' + rel;
    const any = readFileAny(abs);
    // cleanSub 为空时直接挂在 mydata 下，不再插入 './'
    const targetPath = cleanSub ? ('mydata/' + cleanSub + '/' + rel) : ('mydata/' + rel);
    const checksum = sha256Hex(any.isBinary === 1 ? 'b64:' + any.content : any.content);
    const size = any.isBinary === 1 ? b64ByteLength(any.content) : utf8ByteLength(any.content);
    const segs = targetPath.split('/');
    let cur = '';
    for (let k = 0; k < segs.length - 1; k++) {
      cur = cur ? cur + '/' + segs[k] : segs[k];
      vfs.putDir(db, cur, now);
    }

    const before = vfs.getFile(db, targetPath);
    vfs.putFile(db, targetPath, any.isBinary, any.content, size, checksum, now, !before);

    if (!before || before.checksum !== checksum) {
      appendWithPrune(db, {
        tool: tool,
        description: description + ': ' + rel,
        changeType: before ? 'modify' : 'create',
        path: targetPath,
        beforeContent: before ? before.content : null,
        beforeIsBinary: before ? before.isBinary : null,
        afterContent: any.content,
        afterIsBinary: any.isBinary,
        beforeChecksum: before ? before.checksum : null,
        afterChecksum: checksum,
        createdAt: now
      });
    }
    written.push(targetPath);
  }
  return written;
}

/** 清理工作目录 */
function cleanup(workDir: string): void {
  try {
    const parent = workDir.slice(0, workDir.lastIndexOf('/'));
    remove(parent, true);
  } catch (e) {
    // 忽略清理失败
  }
}

// ---- opm.init ----
export async function opmInit(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'init');

    const r = await callOpm('init', {
      project_dir: workDir,
      name: optString(params, 'name'),
      version: optString(params, 'version') || '1.0.0',
      source: optString(params, 'source') || 'normal',
      registry: optString(params, 'registry')
    });

    // package.json / .npmrc 回写
    const written = await saveBack(packageId, workDir, '.', 'opm.init', 'opm init 生成');
    cleanup(workDir);

    return ok({ opm: r, written: written }, 'opm init 完成，回写 ' + written.length + ' 个文件');
  } catch (e) {
    return failFrom(e, 'opm_init 失败');
  }
}

// ---- opm.search ----
export async function opmSearch(params: any): Promise<ToolResult> {
  try {
    const r = await callOpm('search', {
      keyword: optString(params, 'keyword'),
      registry: optString(params, 'registry')
    });
    return ok(r, '搜索结果已返回');
  } catch (e) {
    return failFrom(e, 'opm_search 失败');
  }
}

// ---- opm.install ----
export async function opmInstall(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'install');

    const r = await callOpm('install', {
      project_dir: workDir,
      packages: optString(params, 'packages'),
      tgz_path: optString(params, 'tgz_path'),
      global: optBool(params, 'global', false),
      save: optBool(params, 'save', true)
    });

    // package.json / package-lock.json 回写（node_modules 太大，不写回 db）
    const written = await saveBack(packageId, workDir, '.', 'opm.install', 'opm install 更新依赖清单');
    cleanup(workDir);

    return ok({ opm: r, written: written }, 'opm install 完成');
  } catch (e) {
    return failFrom(e, 'opm_install 失败');
  }
}

// ---- opm.remove ----
export async function opmRemove(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = optString(params, 'package_id');
    if (packageId) {
      const workDir = await materialize(packageId, 'remove');
      const r = await callOpm('remove', {
        project_dir: workDir,
        packages: requireString(params, 'packages', '要卸载的包名'),
        global: optBool(params, 'global', false)
      });
      const written = await saveBack(packageId, workDir, '.', 'opm.remove', 'opm remove 更新依赖清单');
      cleanup(workDir);
      return ok({ opm: r, written: written }, 'opm remove 完成');
    }
    const r = await callOpm('remove', {
      packages: requireString(params, 'packages', '要卸载的包名'),
      global: true
    });
    return ok(r, 'opm remove（全局）完成');
  } catch (e) {
    return failFrom(e, 'opm_remove 失败');
  }
}

// ---- opm.license ----
export async function opmLicense(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'license');

    const r = await callOpm('license', {
      project_dir: workDir,
      type: requireString(params, 'type', 'SPDX 标识符，如 MIT'),
      author: optString(params, 'author'),
      yearrange: optString(params, 'yearrange'),
      overwrite: optBool(params, 'overwrite', false),
      custom_content: optString(params, 'custom_content')
    });

    const written = await saveBack(packageId, workDir, '.', 'opm.license', 'opm license 生成许可证');
    cleanup(workDir);
    return ok({ opm: r, written: written }, 'opm license 完成');
  } catch (e) {
    return failFrom(e, 'opm_license 失败');
  }
}

// ---- opm.changelog ----
export async function opmChangelog(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'changelog');

    const r = await callOpm('changelog', {
      project_dir: workDir,
      version: requireString(params, 'version', '语义化版本或 unreleased'),
      description: optString(params, 'description'),
      content: params.content
    });

    const written = await saveBack(packageId, workDir, '.', 'opm.changelog', 'opm changelog 更新');
    cleanup(workDir);
    return ok({ opm: r, written: written }, 'opm changelog 完成');
  } catch (e) {
    return failFrom(e, 'opm_changelog 失败');
  }
}

// ---- opm.build ----
export async function opmBuild(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'build');
    // 落盘体检：把关键计数留在返回里，方便定位「写了却读不到」这类问题
    const probeNmCount = (function () {
      try {
        const nm = workDir + '/node_modules';
        if (!exists(nm)) return -1;
        return walkFiles(nm).length;
      } catch (e) {
        return -2;
      }
    })();

    const r = await callOpm('build', {
      project_dir: workDir,
      skip_compile: optBool(params, 'skip_compile', false),
      out_name: optString(params, 'out_name'),
      out_dir: optString(params, 'out_dir'),
      extra_files: optStringArray(params, 'extra_files'),
      PACKINFO: params.PACKINFO,
      USECHANGELOG: params.USECHANGELOG
    });

    // 产物落在 workDir/opmbuild，回写进虚拟的 mydata/opmbuild，并导出到 opt
    const written = await saveBack(packageId, workDir, 'opmbuild', 'opm.build', 'opm build 产物');

    // 提取 npm 依赖：node_modules + package.json + package-lock.json + .npmrc
    // 用户要求全量进 db；带体积阀值保护，超限则拒绝并说明原因
    const extractNodeModules = optBool(params, 'extract_node_modules', true);
    const maxMb = optNumber(params, 'dependency_max_mb');
    const deps = await extractDeps({
      packageId: packageId,
      workDir: workDir,
      includeNodeModules: extractNodeModules,
      maxBytes: maxMb && maxMb > 0 ? maxMb * 1024 * 1024 : undefined,
      tool: 'opm.build'
    });

    cleanup(workDir);

    // opm 的返回已由 callOpm 统一解析成对象
    const info = opmMessage(r, 'opm build');
    let msg = info.text + '；回写 ' + written.length + ' 个产物';

    if (deps.denied) {
      msg += '\n[依赖未提取] ' + deps.deniedReason;
    } else {
      const mb = (deps.totalBytes / 1024 / 1024).toFixed(1);
      msg += '；提取依赖 ' + deps.written.length + ' 个文件（' + mb + ' MB）';
      if (deps.unchanged.length) {
        msg += '，' + deps.unchanged.length + ' 个未变（已在库中）';
      }
      if (deps.skipped.length) {
        msg += '，跳过 ' + deps.skipped.length + ' 个';
      }
    }

    return ok(
      { opm: r, written: written, deps: deps, probe: { nmAfterMaterialize: probeNmCount } },
      msg
    );
  } catch (e) {
    return failFrom(e, 'opm_build 失败');
  }
}

// ---- opm.verify ----
export async function opmVerify(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'verify');

    const r = await callOpm('verify', {
      project_dir: workDir,
      skip_compile: optBool(params, 'skip_compile', false),
      extra_files: optStringArray(params, 'extra_files')
    });

    cleanup(workDir);
    return ok({ opm: r }, 'opm verify 完成');
  } catch (e) {
    return failFrom(e, 'opm_verify 失败');
  }
}

// ---- opm.pack ----
export async function opmPack(params: any): Promise<ToolResult> {
  try {
    // 能力守卫：opm 只服务 ToolPkg 工程，script 项目直接拒绝
    {
      const __pid = optString(params, 'package_id');
      if (__pid) assertCapability(__pid, 'opm');
    }
    // 可用性守卫：opm 包本身没启用/没装上时给明确提示
    await assertOpmUsable();
    const packageId = requireString(params, 'package_id', '插件包名');
    const workDir = await materialize(packageId, 'pack');

    const r = await callOpm('pack', {
      project_dir: workDir,
      out_dir: optString(params, 'out_dir'),
      out_name: optString(params, 'out_name')
    });

    // tgz 产物回写
    const written = await saveBack(packageId, workDir, '.', 'opm.pack', 'opm pack 产物');
    cleanup(workDir);
    return ok({ opm: r, written: written }, 'opm pack 完成');
  } catch (e) {
    return failFrom(e, 'opm_pack 失败');
  }
}

// ---- opm.version ----
export async function opmVersion(params: any): Promise<ToolResult> {
  try {
    const r = await callOpm('version', {
      project_dir: optString(params, 'project_dir'),
      include_global: optBool(params, 'include_global', false)
    });
    return ok(r, '版本信息已返回');
  } catch (e) {
    return failFrom(e, 'opm_version 失败');
  }
}

/**
 * 检查 opm 包是否可用。
 * 返回 { available, reason }，用于在调用前给出明确提示，而不是让底层抛一段看不懂的错。
 */
async function checkOpmAvailable(): Promise<{ available: boolean; reason: string }> {
  const fn: any = (globalThis as any).toolCall;
  if (typeof fn !== 'function') {
    return {
      available: false,
      reason: '当前运行时不支持 toolCall，无法转发到 opm 包。请确认 Operit 版本支持 toolCall，或改用其他构建方式。'
    };
  }
  try {
    // 用一个无副作用的只读调用探测 opm 是否可响应
    const probe = await fn('opm:version', {});
    if (probe === undefined || probe === null) {
      return { available: false, reason: 'opm 包无有效响应。' };
    }
    // 解析返回，判断是否是"包未启用"之类的错误
    let parsed: any = probe;
    if (typeof probe === 'string') {
      try { parsed = JSON.parse(probe); } catch (e) { parsed = null; }
    }
    if (parsed && parsed.success === false) {
      const msg = parsed.message ? String(parsed.message) : '';
      return {
        available: false,
        reason: 'opm 包不可用：' + (msg || '未知原因')
          + '。请在「包管理」中启用 opm（com.operit.serveryyswys.opm），然后重试。'
      };
    }
    return { available: true, reason: '' };
  } catch (e) {
    const msg = String((e && (e as any).message) ? (e as any).message : e);
    if (/not found|未找到|未安装|no such|unknown package|package.*not/i.test(msg)) {
      return {
        available: false,
        reason: 'opm 包未安装或未启用（' + msg + '）。请在「包管理」中安装并启用 opm（com.operit.serveryyswys.opm）。'
      };
    }
    return {
      available: false,
      reason: 'opm 探测失败：' + msg
        + '\n请确认 opm 包已启用；若已启用，可能是 opm 内部依赖（typescript / node.operit）缺失。'
    };
  }
}

/** 在能力检查之后，再断言 opm 包本身可用 */
async function assertOpmUsable(): Promise<void> {
  const r = await checkOpmAvailable();
  if (!r.available) throw new Error(r.reason);
}

/**
 * 调用 opm 包的对应工具。
 * 通过 toolCall 转发到 opm:xxx，这样本包不需要复制 opm 的整套实现。
 * 注意：toolCall 的返回通常是 JSON 字符串，这里统一解析成对象，避免上层拿到字符串误判 success。
 */
async function callOpm(action: string, args: any): Promise<any> {
  const toolName = 'opm:' + action;
  let raw: any = null;
  try {
    const fn: any = (globalThis as any).toolCall;
    if (typeof fn !== 'function') {
      throw new Error('当前运行时不支持 toolCall，无法转发到 ' + toolName);
    }
    raw = await fn(toolName, args);
  } catch (e) {
    const msg = String((e as any).message || e);
    // 把"包不存在 / 未启用"这类底层错误翻译成人话
    if (/not found|未找到|未安装|no such|unknown package|package.*not/i.test(msg)) {
      throw new Error(
        'opm 包不可用（' + toolName + ' 调用失败）。\n'
        + '原始错误：' + msg + '\n'
        + '处理办法：请在「包管理」中安装并启用 opm（com.operit.serveryyswys.opm）。'
      );
    }
    throw new Error('调用 ' + toolName + ' 失败：' + msg
      + '\n（请确认 opm 包已启用；若已启用，检查 opm 依赖 typescript / @serveryyswys/node.operit 是否齐全）');
  }

  // 统一解析：字符串 -> JSON 对象
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { success: true, message: raw };
    }
  }
  return raw;
}

/**
 * 把 opm 结果转成人类可读的一句话 */
function opmMessage(r: any, fallback: string): { succeeded: boolean; text: string } {
  if (!r || typeof r !== 'object') {
    return { succeeded: false, text: fallback + '：opm 无有效返回' };
  }
  const succeeded = r.success === true;
  const msg = r.message ? String(r.message) : '';
  return { succeeded: succeeded, text: msg || (succeeded ? fallback + ' 成功' : fallback + ' 失败') };
}

/**
 * opm 工具的通用守卫包装：
 *   - 只要带 package_id，就断言项目是 ToolPkg 类型（opm 不服务 script）
 *   - 不带 package_id 的调用（如 opm_search / opm_version global）放行
 */
async function guarded<T>(params: any, label: string, fn: () => Promise<T>): Promise<T | ToolResult> {
  try {
    const pid = optString(params, 'package_id');
    if (pid) {
      assertCapability(pid, 'opm');
    }
    return await fn();
  } catch (e) {
    return failFrom(e, 'opm_' + label + ' 失败');
  }
}