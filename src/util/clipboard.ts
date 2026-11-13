// 剪贴板：通过 Java bridge 直连 Android ClipboardManager
//
// 为什么不用 Shell 广播：
//   `am broadcast -a android.intent.action.CLIPBOARD_CHANGED --es text ...`
//   在 Android 10+ 不可靠（CLIPBOARD_CHANGED 是只读通知，不是写入口），
//   很多 ROM 上直接静默失败。所以必须走 ClipboardManager.setPrimaryClip。
//
// 关键技术点：
//   1) ClipboardManager 通过 Context.getSystemService("clipboard") 拿
//   2) ClipData.newPlainText(label, text) 是最简写入口
//   3) 全程 try/catch，剪贴板不可用不能影响主流程

/** 取全局 Java bridge（运行时注入，类型宽松） */
function getJava(): any {
  const g: any = globalThis as any;
  if (g.Java && typeof g.Java.type === 'function') return g.Java;
  return null;
}

/** 复制结果 */
export interface ClipboardResult {
  ok: boolean;
  /** 实际生效的通道 */
  channel: string;
  /** 失败原因 */
  reason: string;
}

/** 拿 Android Context（优先 getContext，回退 getApplicationContext） */
function getCtx(j: any): any {
  try {
    if (typeof j.getContext === 'function') {
      const c = j.getContext();
      if (c) return c;
    }
  } catch (e) { /* 继续 */ }
  try {
    if (typeof j.getApplicationContext === 'function') {
      const c = j.getApplicationContext();
      if (c) return c;
    }
  } catch (e) { /* 继续 */ }
  return null;
}

/** 复制文本到系统剪贴板（Java bridge 直连） */
export function copyToClipboard(text: string): ClipboardResult {
  const content = String(text === undefined || text === null ? '' : text);
  if (!content) {
    return { ok: false, channel: '', reason: '内容为空，无需复制' };
  }

  const j = getJava();
  if (!j) {
    return { ok: false, channel: '', reason: 'Java bridge 不可用（当前运行时没有注入 Java）' };
  }

  const ctx = getCtx(j);
  if (!ctx) {
    return { ok: false, channel: '', reason: '拿不到 Android Context' };
  }

  // 通道 1：ClipboardManager 直连（字符串服务名）
  try {
    const cm = ctx.getSystemService('clipboard');
    if (cm) {
      const ClipData = j.type('android.content.ClipData');
      const clip = ClipData.newPlainText('devtool-log', content);
      cm.setPrimaryClip(clip);
      return { ok: true, channel: 'ClipboardManager', reason: '' };
    }
  } catch (e) {
    // 继续尝试下一通道
  }

  // 通道 2：getSystemService(Class)（部分 ROM 只认 Class 版）
  try {
    const cmCls = j.type('android.content.ClipboardManager');
    const cm = ctx.getSystemService(cmCls);
    if (cm) {
      const ClipData = j.type('android.content.ClipData');
      const clip = ClipData.newPlainText('devtool-log', content);
      cm.setPrimaryClip(clip);
      return { ok: true, channel: 'ClipboardManager(Class)', reason: '' };
    }
  } catch (e) {
    // 继续
  }

  return { ok: false, channel: '', reason: 'setPrimaryClip 调用失败（可能是权限或线程限制）' };
}

/** 读取剪贴板纯文本（调试用，失败返回空串） */
export function readClipboard(): string {
  const j = getJava();
  if (!j) return '';
  try {
    const ctx = getCtx(j);
    if (!ctx) return '';
    const cm = ctx.getSystemService('clipboard');
    if (!cm) return '';
    const clip = cm.getPrimaryClip();
    if (!clip || clip.getItemCount() < 1) return '';
    const item = clip.getItemAt(0);
    const cs = item.getText();
    return cs ? String(cs) : '';
  } catch (e) {
    return '';
  }
}