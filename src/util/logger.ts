// 日志系统：抄 overmem 的设计，适配 ToolPkg 环境
//
// 设计要点（对齐 overmem/src/utils/Logger.ts）：
//   1) 单例，避免多处重复初始化
//   2) 双写：物理文件 + console（宿主打到 logcat / 调试面板）
//   3) 分级过滤：DEBUG / INFO / WARN / ERROR
//   4) 启动横幅：方便在长文件里定位某一次会话
//   5) 全部 try/catch 兜底：日志自身出错绝不影响主流程
//
// 与 overmem 的差异：
//   - 这里走 node.operit 的 fs（同步、原始字节），不是 require('fs')（那是宿主垫片）
//   - 日志路径跟着**注册中心**走，不放 cleanOnExit
//
// 为什么不能放 cleanOnExit：
//   cleanOnExit 是宿主用来清理的临时目录（名字就写着"退出时清理"），
//   把持久化日志放那儿等于把日记本放垃圾桶上。注册中心目录才是本插件的家，
//   registry.json 就在隔壁，日志和项目清单住一起，生命周期一致。
//
// 日志路径：
//   /storage/emulated/0/Download/Operit/@serveryyswys/devtool/logs/devtool.log
import { appendText, mkdirp, exists, readText, writeText, statSize, remove } from '../util/files';
import { REGISTRY_ROOT } from '../model/constants';

const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';
/** 插件自己的家：注册中心目录（registry.json 也在这），绝不是 cleanOnExit */
const PKG_ROOT = REGISTRY_ROOT;
const LOG_DIR = PKG_ROOT + '/logs';
const LOG_FILE = LOG_DIR + '/devtool.log';
/** 轮转后的历史文件 */
const LOG_FILE_OLD = LOG_DIR + '/devtool.1.log';
/** 会话锁：本次 Operit 会话是否已经打过 banner
 *
 * 【关键】这个锁必须放 cleanOnExit，**不能**跟日志一起放注册中心。
 *
 * 它的语义是「本次 Operit 会话是否已写过 banner」，靠宿主退出时清掉 cleanOnExit
 * 来"自动复位"。放注册中心目录（永不清）的后果是：锁一直在 → 永远判定
 * "本次会话已打过 banner" → 日志里永远只有一条 SESSION 头，会话切分彻底失效。
 *
 * 日志是持久数据，锁是易失数据，两者生命周期相反，不能住一起。
 */
/** 会话锁所在目录（cleanOnExit 下，随宿主退出被清理，从而实现"自动复位"） */
const SESSION_LOCK_DIR = '/storage/emulated/0/Download/Operit/cleanOnExit/' + PKG_ID;
const SESSION_LOCK = SESSION_LOCK_DIR + '/.devtool.sessionlock';
/** 单个日志文件上限 2MB，超了就滚动 */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** 会话头标记前缀（日志按它切分，必须稳定可匹配） */
const SESSION_MARK_PREFIX = '===== SESSION ';

/** 日志级别 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

const LEVEL_NAME: { [k: number]: string } = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR'
};

/** 本地时间戳：YYYY-MM-DD HH:mm:ss.SSS（不用 toISOString，那是 UTC，会少 8 小时） */
function localStamp(d?: Date): string {
  const t = d || new Date();
  const pad = function (n: number, w?: number): string {
    let s = String(n);
    const width = w || 2;
    while (s.length < width) s = '0' + s;
    return s;
  };
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())
    + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds())
    + '.' + pad(t.getMilliseconds(), 3);
}

/** '='.repeat 的本地实现 */
function repeatChar(ch: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ch;
  return out;
}

// ---------- 会话锁（抄 overmem 的设计）----------
//
// 语义：同一个 Operit 进程生命周期内只打一次 banner。
// 锁文件存在 = 本次会话已经跑过；不存在 = 首次。
// 由 markSessionStarted() 在打完 banner 后写入。

/** 本次 Operit 会话是否首次加载本包 */
export function isFirstLaunchInSession(): boolean {
  try {
    return !exists(SESSION_LOCK);
  } catch (e) {
    return true;
  }
}

/** 落锁：标记本次会话已跑过 */
export function markSessionStarted(): void {
  try {
    // 注意：锁在 cleanOnExit 下，不在 PKG_ROOT（注册中心）下，
    // 所以要建的是锁自己的父目录，不是日志目录。
    mkdirp(SESSION_LOCK_DIR);
    writeText(
      SESSION_LOCK,
      JSON.stringify(
        { startedAt: localStamp(), pid: 'app' },
        null,
        2
      ) + '\n'
    );
  } catch (e) {
    // 落锁失败不影响业务，最多下次多重打一次 banner
  }
}

/** 清锁：下次 registerToolPkg 会重新打 banner（调试用） */
export function clearSessionLock(): boolean {
  try {
    if (!exists(SESSION_LOCK)) return false;
    remove(SESSION_LOCK, false);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 喵 ----------

/** 猫的台词池（抄 overmem 的风格，换成开发工具语境） */
const SLOGANS: string[] = [
  // 开发
  '今天也要好好写代码',
  '编译不会骗人',
  '先跑通，再优雅',
  '这个 bug 我看过了，它很好',
  '提交前记得快照',
  '虚拟文件系统里没有后悔药',
  '别在生产环境上试',
  // 摸鱼
  '在写了在写了',
  '只是休息一下',
  '我盯着进度条呢',
  'snapshot 一下先',
  // 猫
  '喵',
  '喵喵',
  '喵喵喵',
  '别摸我，我在想架构',
  '本喵在值班',
  '困了，但还能再跑一个测试',
  '爪子在键盘上',
  // meta
  '当你看到了日志时，你看到了日志',
  '日志是写给未来的自己看的',
  '你居然真的翻到了这里',
  '这条是彩蛋',
  '日志之下，皆是无常',
  '',
  '',
  ''
];

/** 随机取一句 */
export function pickSlogan(): string {
  try {
    return SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
  } catch (e) {
    return '';
  }
}

/** 猫 banner（抄 overmem 的 BannerGeneral 结构） */
export function buildCatBanner(text?: string): string {
  const lines = [
    '  /\\_/\\',
    ' ( o.o )',
    '  > ^ <'
  ];
  const tail = text ? '  ' + text : '  z z Z';
  lines[lines.length - 1] += tail;
  return lines.join('\n');
}

/** 完整启动 banner（含版本号 + 猫 + SESSION 标记） */
export function buildStartupBanner(sessionIndex?: number): string {
  const idx = sessionIndex && sessionIndex > 0 ? sessionIndex : 1;
  // 这一行是机器可解析的会话头，日志页靠它切分
  const sessionLine = SESSION_MARK_PREFIX
    + JSON.stringify({ idx: idx, startedAt: localStamp() })
    + ' =====';
  return (
    '\n\n' +
    sessionLine + '\n' +
    repeatChar('=', 60) + '\n' +
    'ToolpkgDev v0.1.0 — 安全的 Operit 插件开发环境\n' +
    'Powered by Serveryyswys\n' +
    repeatChar('=', 60) + '\n' +
    buildCatBanner(pickSlogan()) + '\n' +
    repeatChar('=', 60) + '\n'
  );
}

/** 单例 Logger */
class Logger {
  private static instance: Logger | null = null;
  private currentLevel: LogLevel = LogLevel.DEBUG;
  private buffer: string[] = [];
  /** 缓冲满多少条刷一次盘；1 = 立即写 */
  private maxBufferSize: number = 1;
  private enabled: boolean = true;
  private initialized: boolean = false;

  private constructor() {
    this.initFile();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** 写 console（宿主会打到 logcat / 调试面板），失败静默 */
  private nativeLog(level: string, msg: string): void {
    try {
      const tag = '[ToolpkgDev][' + level + '] ' + msg;
      const g: any = globalThis as any;
      if (g.console && typeof g.console.log === 'function') {
        if (level === 'ERROR' && typeof g.console.error === 'function') g.console.error(tag);
        else if (level === 'WARN' && typeof g.console.warn === 'function') g.console.warn(tag);
        else g.console.log(tag);
      }
    } catch (e) {
      // 日志自身失败不影响业务
    }
  }

  /** 确保目录 + 写启动横幅 */
  private initFile(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      mkdirp(LOG_DIR);
      if (!exists(LOG_FILE)) {
        appendText(LOG_FILE, '');
      }
      // 只有「本次 Operit 会话首次」才打 banner，避免每次进页面都刷屏
      if (isFirstLaunchInSession()) {
        // 先数一下文件里已有几轮会话，给新 banner 编号
        let nextIdx = 1;
        try {
          const old = exists(LOG_FILE) ? readText(LOG_FILE) : '';
          let cnt = 0;
          let pos = 0;
          while (true) {
            const hit = old.indexOf(SESSION_MARK_PREFIX, pos);
            if (hit < 0) break;
            cnt++;
            pos = hit + SESSION_MARK_PREFIX.length;
          }
          nextIdx = cnt + 1;
        } catch (e) {
          nextIdx = 1;
        }
        appendText(LOG_FILE, buildStartupBanner(nextIdx));
        // 打完 banner 就落锁，本次会话后续不再打
        markSessionStarted();
      }
      this.nativeLog('INFO', '日志文件: ' + LOG_FILE);
    } catch (e) {
      this.nativeLog('ERROR', '初始化日志文件失败: ' + String((e as any).message || e));
    }
  }

  /** 核心写入 */
  private log(level: LogLevel, tag: string, message: string): void {
    if (!this.enabled) return;
    if (level < this.currentLevel) return;
    const timestamp = localStamp();
    const levelStr = LEVEL_NAME[level] || 'INFO';
    const entry = '[' + timestamp + '] [' + levelStr + '] [' + tag + '] ' + message;
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /** 刷盘 */
  private flush(): void {
    if (this.buffer.length === 0) return;
    try {
      // 轮转检查：超过上限就把当前文件滚成 .1，再从头写
      try {
        const sz = statSize(LOG_FILE);
        if (sz > 0 && sz > MAX_LOG_BYTES) {
          try { remove(LOG_FILE_OLD, false); } catch (e) { /* 旧备份可能不存在 */ }
          try { remove(LOG_FILE, false); } catch (e) { /* 忽略 */ }
          appendText(LOG_FILE, '');
          appendText(
            LOG_FILE,
            '[' + localStamp() + '] [INFO] [Logger] 日志超过 '
            + (MAX_LOG_BYTES / 1024 / 1024).toFixed(0) + 'MB，已轮转\n'
          );
        }
      } catch (e) {
        // 体积探测失败不阻塞写入
      }
      const text = this.buffer.join('\n') + '\n';
      appendText(LOG_FILE, text);
      this.buffer = [];
    } catch (e) {
      this.nativeLog('ERROR', '刷盘失败: ' + String((e as any).message || e));
      this.buffer = [];
    }
  }

  debug(tag: string, message: string): void {
    this.log(LogLevel.DEBUG, tag, message);
  }
  info(tag: string, message: string): void {
    this.log(LogLevel.INFO, tag, message);
    this.nativeLog('INFO', '[' + tag + '] ' + message);
  }
  warn(tag: string, message: string): void {
    this.log(LogLevel.WARN, tag, message);
    this.nativeLog('WARN', '[' + tag + '] ' + message);
  }
  error(tag: string, message: string): void {
    this.log(LogLevel.ERROR, tag, message);
    this.nativeLog('ERROR', '[' + tag + '] ' + message);
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
  setEnabled(v: boolean): void {
    this.enabled = v;
  }
  flushNow(): void {
    this.flush();
  }
  getLogPath(): string {
    return LOG_FILE;
  }
  static stringify(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }
}

// ---- 对外便捷函数（与 overmem 一致）----

export function logDebug(tag: string, message: string): void {
  try { Logger.getInstance().debug(tag, message); } catch (e) { /* 吞掉 */ }
}

export function logInfo(tag: string, message: string): void {
  try { Logger.getInstance().info(tag, message); } catch (e) { /* 吞掉 */ }
}

export function logWarn(tag: string, message: string): void {
  try { Logger.getInstance().warn(tag, message); } catch (e) { /* 吞掉 */ }
}

export function logError(tag: string, message: string): void {
  try { Logger.getInstance().error(tag, message); } catch (e) { /* 吞掉 */ }
}

/** 打印对象（自动 JSON 化） */
export function logObject(tag: string, obj: any): void {
  try { Logger.getInstance().info(tag, Logger.stringify(obj)); } catch (e) { /* 吞掉 */ }
}

/** 异常专用：带堆栈 */
export function logException(tag: string, err: any): void {
  try {
    let msg = '';
    if (err && err.stack) msg = String(err.stack);
    else if (err && err.message) msg = String(err.message);
    else msg = String(err);
    Logger.getInstance().error(tag, msg);
  } catch (e) { /* 吞掉 */ }
}

/** 取日志文件路径（给 UI / 工具展示） */
export function getLogPath(): string {
  try { return Logger.getInstance().getLogPath(); } catch (e) { return LOG_FILE; }
}

/** 刷盘（UI 里"查看日志"之前调一次，确保最新内容已落盘） */
export function flushLog(): void {
  try { Logger.getInstance().flushNow(); } catch (e) { /* 吞掉 */ }
}

/** 设置日志级别（0=DEBUG 1=INFO 2=WARN 3=ERROR） */
export function setLogLevel(level: number): void {
  try { Logger.getInstance().setLevel(level as LogLevel); } catch (e) { /* 吞掉 */ }
}

/** 开关日志 */
export function setLogEnabled(v: boolean): void {
  try { Logger.getInstance().setEnabled(v); } catch (e) { /* 吞掉 */ }
}

// ---------- 日志读取（给日志页用）----------

// ---------- 会话（按 banner 切分）----------
//
// 日志是连续追加的，每次 Operit 会话启动打一条 SESSION 头：
//   ===== SESSION {"idx":3,"startedAt":"2026-11-13 22:07:01.382"} =====
// 解析时按这条标记切段，就能让用户选看哪一次会话。
//
// idx = 文件内第几次会话（从 1 开始），由「已存在的 SESSION 条数 + 1」推出来。


/** 会话摘要 */
export interface LogSession {
  /** 文件内序号（1 起） */
  index: number;
  /** 开始时间（本地） */
  startedAt: string;
  /** 该会话的行数（含头） */
  lineCount: number;
  /** 该会话内是否有 ERROR */
  hasError: boolean;
  /** 该会话内是否有 WARN */
  hasWarn: boolean;
}

/** 把整份日志按 SESSION 头切成多段，返回摘要列表（最新在前） */
export function listSessions(): LogSession[] {
  try {
    flushLog();
    if (!exists(LOG_FILE)) return [];
    const text = readText(LOG_FILE);
    const lines = text.split('\n');

    const sessions: LogSession[] = [];
    let cur: LogSession | null = null;
    let curIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.indexOf(SESSION_MARK_PREFIX) === 0) {
        // 收尾上一段
        if (cur) sessions.push(cur);
        curIdx++;
        let info: any = null;
        try {
          const jsonPart = ln.substring(SESSION_MARK_PREFIX.length).replace(/\s*=====\s*$/, '');
          info = JSON.parse(jsonPart);
        } catch (e) { info = null; }
        cur = {
          index: curIdx,
          startedAt: info && info.startedAt ? String(info.startedAt) : '(未知)',
          lineCount: 1,
          hasError: false,
          hasWarn: false
        };
        continue;
      }
      if (!cur) continue;
      cur.lineCount++;
      if (ln.indexOf('[ERROR]') >= 0) cur.hasError = true;
      if (ln.indexOf('[WARN]') >= 0) cur.hasWarn = true;
    }
    if (cur) sessions.push(cur);

    // 排序：按 startedAt **时间**倒序（最新在前），不是按文件内出现顺序。
    //
    // 为什么不能只 reverse()：正常运行时每轮都是顺序追加，reverse 刚好等于时间倒序。
    // 但日志被人工改过、轮转后拼接、或从别处拷进来时，文件顺序 ≠ 时间顺序，
    // 排序就乱了。按 startedAt 排是一劳永逸的。
    //
    // startedAt 格式是 "YYYY-MM-DD HH:mm:ss.SSS"（本地时间，非 ISO），
    // Date.parse 对空格分隔的格式行为不一致，所以先换成 T 再解析。
    sessions.sort(function (a, b) {
      const ta = Date.parse(String(a.startedAt).replace(' ', 'T')) || 0;
      const tb = Date.parse(String(b.startedAt).replace(' ', 'T')) || 0;
      return tb - ta;
    });
    return sessions;
  } catch (e) {
    return [];
  }
}

/**
 * 读取指定某一轮会话的日志正文。
 * sessionIndex 从 1 开始；传 0 或负数表示「最新一轮」。
 * 找不到时返回 { content: '', found: false }。
 */
export function readSession(sessionIndex: number, maxChars?: number): {
  content: string;
  found: boolean;
  startedAt: string;
} {
  const limit = maxChars && maxChars > 0 ? maxChars : 60000;
  try {
    flushLog();
    if (!exists(LOG_FILE)) return { content: '', found: false, startedAt: '' };
    const text = readText(LOG_FILE);
    const lines = text.split('\n');

    // 先扫出所有会话起始行号
    const starts: number[] = [];
    const heads: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(SESSION_MARK_PREFIX) === 0) {
        starts.push(i);
        heads.push(lines[i]);
      }
    }
    if (starts.length === 0) {
      // 没有会话头（老日志）：整份返回
      return {
        content: text.length > limit ? text.slice(text.length - limit) : text,
        found: true,
        startedAt: ''
      };
    }

    const want = sessionIndex > 0 ? sessionIndex : starts.length;
    const realIdx = want - 1;
    if (realIdx < 0 || realIdx >= starts.length) {
      return { content: '', found: false, startedAt: '' };
    }
    const from = starts[realIdx];
    const to = realIdx + 1 < starts.length ? starts[realIdx + 1] : lines.length;
    let body = lines.slice(from, to).join('\n');

    let startedAt = '';
    try {
      const jsonPart = heads[realIdx].substring(SESSION_MARK_PREFIX.length).replace(/\s*=====\s*$/, '');
      const info = JSON.parse(jsonPart);
      startedAt = info && info.startedAt ? String(info.startedAt) : '';
    } catch (e) { startedAt = ''; }

    if (body.length > limit) {
      body = '…（本轮会话过长，只显示尾部）\n' + body.slice(body.length - limit);
    }
    return { content: body, found: true, startedAt: startedAt };
  } catch (e) {
    return { content: '', found: false, startedAt: '' };
  }
}
export interface LogSnapshot {
  /** 当前日志内容（尾部截断到 maxChars） */
  content: string;
  /** 日志文件绝对路径 */
  path: string;
  /** 当前文件字节数 */
  bytes: number;
  /** 是否被截断（只取了尾部） */
  truncated: boolean;
  /** 读取时间 */
  readAt: string;
}

/**
 * 读取日志尾部内容。
 * 手机屏幕放不下几万行，所以默认只取最后 maxChars 个字符。
 */
export function readLogTail(maxChars?: number): LogSnapshot {
  const limit = maxChars && maxChars > 0 ? maxChars : 30000;
  const snap: LogSnapshot = {
    content: '',
    path: LOG_FILE,
    bytes: 0,
    truncated: false,
    readAt: localStamp()
  };
  try {
    flushLog();
    if (!exists(LOG_FILE)) return snap;
    const size = statSize(LOG_FILE);
    snap.bytes = size > 0 ? size : 0;
    const text = readText(LOG_FILE);
    if (text.length <= limit) {
      snap.content = text;
    } else {
      snap.content = '…（已截断，只显示最后 ' + limit + ' 字符）\n'
        + text.slice(text.length - limit);
      snap.truncated = true;
    }
  } catch (e) {
    snap.content = '（读取日志失败：' + String((e as any).message || e) + '）';
  }
  return snap;
}

/** 清空日志（保留一条分隔标记） */
export function clearLog(): boolean {
  try {
    flushLog();
    if (exists(LOG_FILE)) remove(LOG_FILE, false);
    mkdirp(LOG_DIR);
    appendText(
      LOG_FILE,
      '[' + localStamp() + '] [INFO] [Logger] 日志已被手动清空\n'
    );
    return true;
  } catch (e) {
    return false;
  }
}