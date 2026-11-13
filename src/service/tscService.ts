// tsc 编译服务
//
// 流程（已与用户确认）：
//   1. 把 db 里的虚拟文件抽出来，落到 {项目根}/.devtool/tsc_tmp/{src}
//   2. 同时把 tsconfig.json 也抽出来
//   3. 用 Tools.System.terminal.hiddenExec 调 tsc（隐藏执行器，不弹终端 UI）
//   4. 把编译产物（tsconfig 指定的 outDir）读回 db
//   5. 清理 .devtool/tsc_tmp
//
// 为什么必须 hiddenExec：
//   实测 ProcessBuilder 直起 proot 会 execve Permission denied（SELinux 跨 domain），
//   纯兼容层没有子进程能力。hiddenExec 走 Operit 已建好的 proot 会话，是唯一可行路径。

import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import { normalizeVirtualPath, projectTscTmpDir, projectRoot } from '../util/paths';
import { nowIso } from '../util/time';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import { mkdirp, remove, writeText, writeBinaryB64, walkFiles, readFileAny, exists, readText } from '../util/files';
import { appendWithPrune } from '../service/autoSnapService';

export interface TscOptions {
  packageId: string;
  /** 额外传给 tsc 的参数 */
  extraArgs?: string[];
  /** 超时毫秒，默认 180000 */
  timeoutMs?: number;
}

export interface TscResult {
  ok: boolean;
  /** tsc 退出码 */
  exitCode: number;
  /** 完整输出 */
  output: string;
  /** 编译时落地的源目录（相对项目根） */
  workDir: string;
  /** tsconfig 解析出的 outDir（相对 workDir） */
  outDir: string;
  /** 回写进 db 的产物文件 */
  written: string[];
  /** 编译耗时 */
  durationMs: number;
  /** 清理是否成功 */
  cleaned: boolean;
}

/** 宽松解析 tsconfig：剥注释与尾逗号 */
function parseTsconfigLoose(raw: string): any {
  let out = '';
  const n = raw.length;
  let i = 0;
  let inStr = false;
  let strQ = '';
  while (i < n) {
    const c = raw.charAt(i);
    const c2 = i + 1 < n ? raw.charAt(i + 1) : '';
    if (inStr) {
      out += c;
      if (c === '\\') { out += c2; i += 2; continue; }
      if (c === strQ) inStr = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strQ = c; out += c; i += 1; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(raw.charAt(i) === '*' && raw.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '/') {
      i += 2;
      while (i < n && raw.charAt(i) !== '\n') i++;
      continue;
    }
    out += c;
    i += 1;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(out);
}

function shellQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** 把 db 里的文件按虚拟路径落到工作目录 */
async function materialize(
  db: any,
  workDir: string
): Promise<{ written: number; tsconfigPath: string | null }> {
  const all = vfs.listAllFiles(db);
  let written = 0;
  let tsconfigPath: string | null = null;

  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    // mydata/ 前缀剥掉，得到项目内相对路径
    const rel = f.path.replace(/^mydata\//, '');
    if (!rel) continue;

    const abs = workDir + '/' + rel;
    const parent = abs.slice(0, abs.lastIndexOf('/'));
    if (parent) mkdirp(parent);

    if (f.isBinary === 1) writeBinaryB64(abs, f.content);
    else writeText(abs, f.content);

    if (rel === 'tsconfig.json') tsconfigPath = abs;
    written++;
  }

  return { written: written, tsconfigPath: tsconfigPath };
}

/** 从 tsconfig 里取 outDir，缺省用 .opm_build 的等价物 */
function resolveOutDir(tsconfigPath: string | null): string {
  if (!tsconfigPath) return 'dist';
  try {
    const text = readText(tsconfigPath);
    const j = parseTsconfigLoose(text);
    const co = (j && j.compilerOptions) || {};
    const d = co.outDir;
    if (typeof d === 'string' && d.trim()) {
      let t = d.trim();
      if (t.indexOf('./') === 0) t = t.slice(2);
      return t.replace(/\/+$/, '');
    }
  } catch (e) {
    // 解析失败就用默认
  }
  return 'dist';
}

/** 递归读产物目录，回写 db */
function collectProducts(
  db: any,
  outDirAbs: string,
  outDirRel: string
): string[] {
  const written: string[] = [];
  if (!exists(outDirAbs)) return written;

  const files = walkFiles(outDirAbs);
  const now = nowIso();

  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const abs = outDirAbs + '/' + rel;
    const any = readFileAny(abs);

    // db 中的目标路径：mydata/{outDirRel}/{rel}
    const targetPath = 'mydata/' + outDirRel.replace(/^\.\//, '') + '/' + rel;
    const checksum = sha256Hex(any.isBinary === 1 ? 'b64:' + any.content : any.content);
    const size = any.isBinary === 1 ? b64ByteLength(any.content) : utf8ByteLength(any.content);

    // 补父目录
    const segs = targetPath.split('/');
    let cur = '';
    for (let k = 0; k < segs.length - 1; k++) {
      cur = cur ? cur + '/' + segs[k] : segs[k];
      vfs.putDir(db, cur, now);
    }

    const before = vfs.getFile(db, targetPath);
    vfs.putFile(db, targetPath, any.isBinary, any.content, size, checksum, now, !before);

    // 产物变化也记一条自动快照，方便回溯
    if (!before || before.checksum !== checksum) {
      appendWithPrune(db, {
        tool: 'tsc',
        description: 'tsc 编译产物更新: ' + rel,
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

/** 执行 tsc */
export async function runTsc(opts: TscOptions): Promise<TscResult> {
  const packageId = opts.packageId;
  const db = await openProjectDb(packageId);
  const started = Date.now();
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 180000;

  const tmpRoot = projectTscTmpDir(packageId);
  const workDir = tmpRoot + '/work';

  // 1) 清空旧的临时目录
  remove(tmpRoot, true);
  mkdirp(workDir);

  // 2) 落地源码
  const mat = await materialize(db, workDir);
  if (mat.written === 0) {
    remove(tmpRoot, true);
    throw new Error('虚拟项目里没有可编译的文件');
  }

  // 3) 解析 outDir
  const outDirRel = resolveOutDir(mat.tsconfigPath);
  const outDirAbs = workDir + '/' + outDirRel;

  // 4) 拼命令
  let cmd: string;
  if (mat.tsconfigPath) {
    const extra = (opts.extraArgs || []).map(shellQuote).join(' ');
    cmd = 'cd ' + shellQuote(workDir) + ' && tsc -p tsconfig.json' + (extra ? ' ' + extra : '') + ' 2>&1';
  } else {
    // 无 tsconfig：全量编译 .ts
    const extra = (opts.extraArgs || []).join(' ');
    cmd = 'cd ' + shellQuote(workDir) +
      ' && tsc --outDir ' + shellQuote(outDirAbs) +
      ' --module commonjs --target es2020 --esModuleInterop --skipLibCheck' +
      (extra ? ' ' + extra : '') +
      ' $(find . -name "*.ts" -not -path "./node_modules/*") 2>&1';
  }
// 5) 执行（隐藏执行器，不弹终端）
  //
  // 【关键】hiddenExec 在命令**非零退出**时会抛异常，而不是返回结果对象。
  // 真正的 { command, output, exitCode, executorKey } 被包在 err.data 里。
  // 所以两条路径都要接：正常返回读 res，抛异常读 e.data。
  // 早期版本只读 res.exitCode，导致编译失败时 exitCode 恒为 -1、
  // output 只剩 "Command exited with code 2"、真正的 error TS2304 全丢。
  let res: any = null;
  let execError = '';
  try {
    res = await (Tools as any).System.terminal.hiddenExec(cmd, {
      executorKey: 'toolpkgdev_tsc',
      timeoutMs: timeoutMs
    });
  } catch (e) {
    execError = String((e && (e as any).message) ? (e as any).message : e);
    // 真实结果藏在 e.data 上
    const d: any = e && (e as any).data;
    if (d && typeof d === 'object') {
      res = d;
    }
  }

  // 统一取字段：优先 res，其次什么都没有
  const rawOutput = res && res.output !== undefined ? String(res.output) : '';
  const output = rawOutput || execError;
  // exitCode 优先取真实值；取不到才退回"有异常=-1 / 无异常=0"
  const exitCode =
    res && typeof res.exitCode === 'number'
      ? res.exitCode
      : (execError ? -1 : 0);

  // 6) 回写产物
  //
  // tsc 即使有类型错误也会输出 js（除非配置了 noEmitOnError），
  // 所以「有产物」绝对不能等同于「编译成功」，否则 AI 会以为通过了。
  // 判定标准只有一个：exitCode === 0。
  const written = collectProducts(db, outDirAbs, outDirRel);
  const ok = exitCode === 0;

  // 7) 清理临时目录
  let cleaned = true;
  try {
    remove(tmpRoot, true);
  } catch (e) {
    cleaned = false;
  }

  return {
    ok: ok,
    exitCode: exitCode,
    output: output,
    workDir: '.devtool/tsc_tmp/work',
    outDir: outDirRel,
    written: written,
    durationMs: Date.now() - started,
    cleaned: cleaned
  };
}

/** 检查运行环境里 tsc 是否可用 */
export async function checkTscAvailable(): Promise<{
  available: boolean;
  version: string;
  output: string;
}> {
  try {
    const r: any = await (Tools as any).System.terminal.hiddenExec('tsc --version 2>&1', {
      executorKey: 'toolpkgdev_tsc_probe',
      timeoutMs: 30000
    });
    const out = r && r.output !== undefined ? String(r.output).trim() : '';
    const m = out.match(/Version\s+([0-9][0-9.]+)/i);
    return {
      available: !!(r && r.exitCode === 0 && m),
      version: m ? m[1] : '',
      output: out
    };
  } catch (e) {
    return {
      available: false,
      version: '',
      output: String((e && (e as any).message) ? (e as any).message : e)
    };
  }
}