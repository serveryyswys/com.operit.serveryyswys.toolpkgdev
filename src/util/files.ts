// 物理文件层：基于 @serveryyswys/node.operit 的 fs

type FsModule = {
  readFileSync(path: string, options?: any): any;
  writeFileSync(path: string, data: any, options?: any): void;
  appendFileSync(path: string, data: any, options?: any): void;
  existsSync(path: string): boolean;
  statSync(path: string): any;
  readdirSync(path: string, options?: any): any[];
  mkdirSync(path: string, options?: any): any;
  rmSync(path: string, options?: any): void;
  unlinkSync(path: string): void;
  rmdirSync(path: string, options?: any): void;
  renameSync(from: string, to: string): void;
  copyFileSync?(from: string, to: string): void;
  realpathSync?(path: string): string;
};

let _fs: FsModule | null = null;

/** 懒加载 node.operit 的 fs，避免主入口求值期就炸 */
function fs(): FsModule {
  if (_fs) return _fs;
  // 必须走完整包名：裸 'fs' 在 ToolPkg 运行时会解析到宿主垫片，
  // 那边写深路径会静默失败（返回值也带加工），不是我们要的原生字节层。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let mod: any = null;
  try {
    mod = require('@serveryyswys/node.operit/fs');
  } catch (e) {
    mod = null;
  }
  if (!mod || typeof mod.readFileSync !== 'function') {
    // 兜底：某些环境下 '.' 导出才是完整 fs
    try {
      const root: any = require('@serveryyswys/node.operit');
      if (root && root.fs && typeof root.fs.readFileSync === 'function') mod = root.fs;
    } catch (e) { /* ignore */ }
  }
  if (!mod || typeof mod.readFileSync !== 'function') {
    throw new Error(
      '未发现发行包中可用的 node.operit 依赖：请确认 @serveryyswys/node.operit 已随包打入'
    );
  }
  _fs = mod as FsModule;
  return _fs;
}

/** 该层是否可用（供工具层做友好提示） */
export function fsAvailable(): boolean {
  try {
    const m: any = require('@serveryyswys/node.operit/fs');
    return !!(m && typeof m.readFileSync === 'function');
  } catch (e) {
    return false;
  }
}

export function exists(path: string): boolean {
  try {
    return fs().existsSync(path);
  } catch (e) {
    return false;
  }
}

export function mkdirp(path: string): void {
  try {
    const s = fs();
    if (s.existsSync(path)) return;
    s.mkdirSync(path, { recursive: true });
  } catch (e) {
    // 并发或已存在时忽略
  }
}

/** 读文本（UTF-8，原始内容，无任何前缀加工） */
export function readText(path: string): string {
  const r = fs().readFileSync(path, { encoding: 'utf8' });
  return typeof r === 'string' ? r : String(r);
}

/** 读原始字节，返回 base64（避免桥接层的 Uint8Array 序列化歧义） */
export function readBinaryB64(path: string): string {
  const r = fs().readFileSync(path);
  if (typeof r === 'string') {
    // 极少数情况下驱动给了字符串，按 utf8 再编码回去
    return utf8ToB64(r);
  }
  return bytesToB64(r);
}

export function writeText(path: string, content: string): void {
  fs().writeFileSync(path, String(content), { encoding: 'utf8' });
}

export function writeBinaryB64(path: string, b64: string): void {
  fs().writeFileSync(path, b64ToBytes(b64));
}

export function appendText(path: string, content: string): void {
  fs().appendFileSync(path, String(content), { encoding: 'utf8' });
}

export function remove(path: string, recursive?: boolean): void {
  try {
    const s = fs();
    if (!s.existsSync(path)) return;
    s.rmSync(path, { recursive: recursive === undefined ? true : recursive, force: true });
  } catch (e) {
    // 不存在或权限问题时忽略，由调用方自行判断后续状态
  }
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

/** 列目录：优先用 Dirent（带类型），无则退回字符串名 + stat */
export function listDir(path: string): DirEntry[] {
  const s = fs();
  const out: DirEntry[] = [];
  let entries: any[];
  try {
    entries = s.readdirSync(path, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  if (!entries || !entries.length) return out;

  // Dirent 形态
  const first = entries[0];
  if (first && typeof first === 'object' && typeof first.name === 'string' &&
      (typeof first.isDirectory === 'function' || typeof first.isFile === 'function')) {
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i];
      let isDir = false;
      try {
        isDir = typeof d.isDirectory === 'function' ? d.isDirectory() : (d.kind === 2);
      } catch (x) { isDir = false; }
      let size = 0;
      if (!isDir) {
        try {
          const st = s.statSync(path.replace(/\/+$/, '') + '/' + d.name);
          size = st && st.isFile && st.isFile() ? Number(st.size || 0) : 0;
        } catch (x) { size = 0; }
      }
      out.push({ name: String(d.name), isDirectory: isDir, size: size });
    }
    return out;
  }

  // 字符串形态
  for (let i = 0; i < entries.length; i++) {
    const name = String(entries[i]);
    if (!name) continue;
    let isDir = false;
    let size = 0;
    try {
      const st = s.statSync(path.replace(/\/+$/, '') + '/' + name);
      isDir = st && st.isDirectory ? st.isDirectory() : false;
      size = !isDir && st && st.size !== undefined ? Number(st.size) : 0;
    } catch (x) { /* ignore */ }
    out.push({ name: name, isDirectory: isDir, size: size });
  }
  return out;
}

/** 递归收集目录下全部文件（相对路径） */
export function walkFiles(root: string, relPrefix?: string): string[] {
  const out: string[] = [];
  const prefix = relPrefix === undefined ? '' : relPrefix;
  const entries = listDir(root);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const childAbs = root.replace(/\/+$/, '') + '/' + e.name;
    const childRel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory) {
      const sub = walkFiles(childAbs, childRel);
      for (let k = 0; k < sub.length; k++) out.push(sub[k]);
    } else {
      out.push(childRel);
    }
  }
  return out;
}

/** 文件是否已存在（用于 export 的覆盖策略） */
export function fileExists(path: string): boolean {
  try {
    return fs().existsSync(path);
  } catch (e) {
    return false;
  }
}

/** 取文件大小；不是文件或不存在返回 -1 */
export function statSize(path: string): number {
  try {
    const st = fs().statSync(path);
    if (!st) return -1;
    const isFile = typeof st.isFile === 'function' ? st.isFile() : false;
    return isFile ? Number(st.size || 0) : -1;
  } catch (e) {
    return -1;
  }
}

/** 取修改时间毫秒；失败返回 -1 */
export function statMtimeMs(path: string): number {
  try {
    const st = fs().statSync(path);
    if (!st) return -1;
    if (typeof st.mtimeMs === 'number') return st.mtimeMs;
    if (st.mtime && typeof st.mtime.getTime === 'function') return st.mtime.getTime();
    return -1;
  } catch (e) {
    return -1;
  }
}

/** 原子改名（跨目录也走同一实现） */
export function rename(from: string, to: string): void {
  fs().renameSync(from, to);
}

/** 复制单个文件 */
export function copyFile(from: string, to: string): void {
  const s: any = fs();
  if (typeof s.copyFileSync === 'function') {
    s.copyFileSync(from, to);
    return;
  }
  // 无 copyFileSync 时用读写实现
  const data = s.readFileSync(from);
  s.writeFileSync(to, data);
}

// ---- 字节与 base64 本地实现（不依赖 android.util.Base64，保持 fs 层自洽） ----

function bytesToB64(bytes: any): string {
  const arr: number[] = [];
  const len = bytes && bytes.length !== undefined ? bytes.length : 0;
  for (let i = 0; i < len; i++) arr.push(Number(bytes[i]) & 0xff);
  return bytesArrayToB64(arr);
}

function b64ToBytes(b64: string): any {
  const arr = b64ToBytesArray(String(b64));
  // 优先给 Uint8Array；Buffer 在场时也给 Buffer，node.operit 两种都接受
  try {
    if (typeof Uint8Array !== 'undefined') return new Uint8Array(arr);
  } catch (e) { /* ignore */ }
  return arr;
}

function utf8ToB64(text: string): string {
  const s = String(text);
  const arr: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) arr.push(c);
    else if (c < 0x800) {
      arr.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        arr.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
        i++;
      } else {
        arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    } else {
      arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytesArrayToB64(arr);
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesArrayToB64(arr: number[]): string {
  let out = '';
  const n = arr.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = arr[i] & 0xff;
    const b1 = i + 1 < n ? arr[i + 1] & 0xff : 0;
    const b2 = i + 2 < n ? arr[i + 2] & 0xff : 0;
    out += B64_CHARS.charAt(b0 >> 2);
    out += B64_CHARS.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += i + 1 < n ? B64_CHARS.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : '=';
    out += i + 2 < n ? B64_CHARS.charAt(b2 & 0x3f) : '=';
  }
  return out;
}

function b64ToBytesArray(b64: string): number[] {
  const s = String(b64).replace(/[^A-Za-z0-9+/=]/g, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '=') break;
    const idx = B64_CHARS.indexOf(ch);
    if (idx < 0) continue;
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * 读一个物理文件，按扩展名判定二进制。
 * 返回值语义与之前保持一致：isBinary=1 时 content 是 base64。
 */
export function readFileAny(path: string): { isBinary: number; content: string } {
  const name = String(path).split('/').pop() || '';
  const lower = name.toLowerCase();
  const idx = lower.lastIndexOf('.');
  const ext = idx < 0 ? '' : lower.slice(idx + 1);

  const TEXT_EXT_LIST = [
    'txt', 'md', 'markdown', 'json', 'json5', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx',
    'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'java', 'kt', 'kts',
    'sql', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'sh', 'xml', 'svg', 'csv'
  ];
  const BINARY_EXT_LIST = [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'tar',
    'rar', '7z', 'apk', 'dex', 'so', 'jar', 'db', 'sqlite', 'mp3', 'mp4', 'wav',
    'ttf', 'woff', 'woff2', 'wasm', 'bin'
  ];

  if (TEXT_EXT_LIST.indexOf(ext) >= 0) {
    return { isBinary: 0, content: readText(path) };
  }

  const b64 = readBinaryB64(path);
  if (BINARY_EXT_LIST.indexOf(ext) >= 0) {
    return { isBinary: 1, content: b64 };
  }

  // 未知扩展名：检查是否含 NUL
  const bytes = b64ToBytesArray(b64);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return { isBinary: 1, content: b64 };
  }
  // 无 NUL，按 UTF-8 解码回文本
  return { isBinary: 0, content: utf8Decode(bytes) };
}

function utf8Decode(bytes: number[]): string {
  let out = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0) {
      const b1 = i < n ? bytes[i++] : 0;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0) {
      const b1 = i < n ? bytes[i++] : 0;
      const b2 = i < n ? bytes[i++] : 0;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else {
      const b1 = i < n ? bytes[i++] : 0;
      const b2 = i < n ? bytes[i++] : 0;
      const b3 = i < n ? bytes[i++] : 0;
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}