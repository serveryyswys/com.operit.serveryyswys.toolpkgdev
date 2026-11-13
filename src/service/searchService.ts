// grep / sed 业务逻辑
//
// 约定（已与用户确认）：
//   - grep 默认只在 db 虚拟文件里搜；scope=opt 时额外搜物理落地区
//   - sed 只改 db，不直接碰 opt；preview 时返回 unified diff，不落库

import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import { normalizeVirtualPath, virtualToPhysical } from '../util/paths';
import { nowIso } from '../util/time';
import { sha256Hex, utf8ByteLength } from '../util/bytes';
import { writeText } from '../util/files';
import { unifiedDiff } from '../util/diff';
import { appendWithPrune } from './autoSnapService';

export interface GrepOptions {
  /** 正则，默认按字面量转义 */
  pattern: string;
  /** 固定字符串模式（不解释正则） */
  fixed?: boolean;
  /** 大小写不敏感 */
  ignoreCase?: boolean;
  /** 只搜这些路径前缀（虚拟路径），可多个 */
  paths?: string[];
  /** 只搜这些扩展名 */
  include?: string[];
  /** 排除这些扩展名 */
  exclude?: string[];
  /** 最多返回多少条匹配 */
  maxResults?: number;
  /** 匹配上下文字符数 */
  maxPerLine?: number;
}

export interface GrepHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface GrepSummary {
  pattern: string;
  filesScanned: number;
  filesMatched: number;
  totalMatches: number;
  truncated: boolean;
  hits: GrepHit[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在虚拟文件里执行 grep */
export async function grep(packageId: string, opts: GrepOptions): Promise<GrepSummary> {
  if (!opts || !opts.pattern) throw new Error('grep 需要 pattern');
  const db = await openProjectDb(packageId);
  const maxResults = opts.maxResults && opts.maxResults > 0 ? Math.min(2000, opts.maxResults) : 200;
  const maxPerLine = opts.maxPerLine && opts.maxPerLine > 0 ? opts.maxPerLine : 300;

  const source = opts.fixed ? escapeRegex(opts.pattern) : opts.pattern;
  let re: RegExp;
  try {
    re = new RegExp(source, opts.ignoreCase ? 'gi' : 'g');
  } catch (e) {
    throw new Error('正则表达式无效: ' + String((e as any).message || e));
  }

  const all = vfs.listAllFiles(db);
  const hits: GrepHit[] = [];
  let filesScanned = 0;
  const matchedFiles: { [p: string]: boolean } = {};
  let truncated = false;

  for (let i = 0; i < all.length; i++) {
    if (truncated) break;
    const meta = all[i];
    if (meta.isBinary === 1) continue;

    // 路径过滤
    if (opts.paths && opts.paths.length) {
      let ok = false;
      for (let k = 0; k < opts.paths.length; k++) {
        const pre = normalizeVirtualPath(opts.paths[k]);
        if (meta.path === pre || meta.path.indexOf(pre + '/') === 0) { ok = true; break; }
      }
      if (!ok) continue;
    }

    // 扩展名过滤
    const ext = (meta.path.split('.').pop() || '').toLowerCase();
    if (opts.include && opts.include.length) {
      if (opts.include.map(function (x) { return String(x).toLowerCase().replace(/^\./, ''); }).indexOf(ext) < 0) continue;
    }
    if (opts.exclude && opts.exclude.length) {
      if (opts.exclude.map(function (x) { return String(x).toLowerCase().replace(/^\./, ''); }).indexOf(ext) >= 0) continue;
    }

    const f = vfs.getFile(db, meta.path);
    if (!f) continue;
    filesScanned++;

    const lines = f.content.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const line = lines[ln];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (hits.length >= maxResults) { truncated = true; break; }
        const text = line.length > maxPerLine ? line.slice(0, maxPerLine) + '…' : line;
        hits.push({ path: f.path, line: ln + 1, column: m.index + 1, text: text });
        matchedFiles[f.path] = true;
        if (m[0].length === 0) re.lastIndex++;
        if (re.lastIndex > line.length) break;
      }
      if (truncated) break;
    }
  }

  return {
    pattern: opts.pattern,
    filesScanned: filesScanned,
    filesMatched: Object.keys(matchedFiles).length,
    totalMatches: hits.length,
    truncated: truncated,
    hits: hits
  };
}

export interface SedOptions {
  /** 要替换的正则或字面量 */
  find: string;
  /** 替换成 */
  replace: string;
  /** 字面量模式 */
  fixed?: boolean;
  /** 大小写不敏感 */
  ignoreCase?: boolean;
  /** 全局替换（默认只替换每行第一处） */
  global?: boolean;
  /** 目标路径前缀或具体文件 */
  paths: string[];
  /** include 扩展名 */
  include?: string[];
  /** preview 不落库 */
  action: 'preview' | 'apply';
  /** apply 时必须给 description */
  description?: string;
}

export interface SedFileResult {
  path: string;
  replacements: number;
  diff: string;
}

export interface SedSummary {
  action: 'preview' | 'apply';
  filesChanged: number;
  totalReplacements: number;
  results: SedFileResult[];
  autoSnapIds: number[];
}

/** sed：批量正则替换，preview 只出 diff */
export async function sed(packageId: string, opts: SedOptions): Promise<SedSummary> {
  if (!opts || !opts.find) throw new Error('sed 需要 find 参数');
  if (opts.action === 'apply' && (!opts.description || !String(opts.description).trim())) {
    throw new Error('sed apply 模式必须提供 description');
  }
  if (!opts.paths || !opts.paths.length) throw new Error('sed 需要 paths 参数');

  const db = await openProjectDb(packageId);
  const source = opts.fixed ? escapeRegex(opts.find) : opts.find;
  let re: RegExp;
  try {
    re = new RegExp(source, opts.global ? (opts.ignoreCase ? 'gi' : 'g') : (opts.ignoreCase ? 'i' : ''));
  } catch (e) {
    throw new Error('sed 查找模式无效: ' + String((e as any).message || e));
  }

  // 收集目标文件
  const targets: string[] = [];
  const all = vfs.listAllFiles(db);
  for (let i = 0; i < all.length; i++) {
    const m = all[i];
    if (m.isBinary === 1) continue;
    let ok = false;
    for (let k = 0; k < opts.paths.length; k++) {
      const pre = normalizeVirtualPath(opts.paths[k]);
      if (m.path === pre || m.path.indexOf(pre + '/') === 0) { ok = true; break; }
    }
    if (!ok) continue;
    const ext = (m.path.split('.').pop() || '').toLowerCase();
    if (opts.include && opts.include.length) {
      if (opts.include.map(function (x) { return String(x).toLowerCase().replace(/^\./, ''); }).indexOf(ext) < 0) continue;
    }
    targets.push(m.path);
  }

  const results: SedFileResult[] = [];
  const autoSnapIds: number[] = [];
  let totalReplacements = 0;

  for (let i = 0; i < targets.length; i++) {
    const path = targets[i];
    const f = vfs.getFile(db, path);
    if (!f) continue;

    let count = 0;
    const after = f.content.replace(re, function () {
      count++;
      return opts.replace;
    });
    if (count === 0 || after === f.content) continue;

    totalReplacements += count;
    results.push({
      path: path,
      replacements: count,
      diff: unifiedDiff(f.content, after, path)
    });

    if (opts.action === 'apply') {
      const now = nowIso();
      const checksum = sha256Hex(after);
      const size = utf8ByteLength(after);
      vfs.putFile(db, path, 0, after, size, checksum, now, false);
      const snapId = appendWithPrune(db, {
        tool: 'sed',
        description: opts.description,
        changeType: 'modify',
        path: path,
        beforeContent: f.content,
        beforeIsBinary: 0,
        afterContent: after,
        afterIsBinary: 0,
        beforeChecksum: f.checksum,
        afterChecksum: checksum,
        createdAt: now
      });
      autoSnapIds.push(snapId);
    }
  }

  return {
    action: opts.action,
    filesChanged: results.length,
    totalReplacements: totalReplacements,
    results: results,
    autoSnapIds: autoSnapIds
  };
}