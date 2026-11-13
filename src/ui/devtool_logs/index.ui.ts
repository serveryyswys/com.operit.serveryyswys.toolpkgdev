// 日志页（devtool_logs）
//
// 四块：
//   1) 会话切换条：横向滚动的会话芯片，点一下切到那一轮
//   2) 路径 + 大小状态
//   3) 日志查看器（按等级上色，只渲染最后 400 行）
//   4) 操作：刷新 / 复制到剪贴板 / 清空 + 猫
//
// 关键约束：
//   - onLoad 可能不跑，页面自带「刷新」
//   - 时间统一用本地时间（logger 里已改）
//   - showToast 只吃字符串

import type { ComposeNode } from '../../model/compose';
import {
  readSession,
  clearLog,
  getLogPath,
  buildCatBanner,
  pickSlogan,
  listSessions
} from '../../util/logger';
import type { LogSession } from '../../util/logger';
import { copyToClipboard } from '../../util/clipboard';

/**
 * 会话列表一屏应收几条。
 *
 * 会话区是**独立的滚动区**（固定高度 LazyColumn），不是跟着整页滑。
 * 这个值只用来决定「标题右侧提示语」和高度换算，不影响实际总条数。
 */
const SESSION_VISIBLE_MAX = 3;

/**
 * 会话列表的固定高度（dp）。
 *
 * 【为什么必须给固定高度】
 * 整页根节点是 LazyColumn，在它内部再放 LazyColumn 时，外层给子项的竖向
 * 约束是无限的（能被内容无限撑长），内层 LazyColumn 拿到无限高度就没法算
 * 渲染窗口，直接抛 "Vertically scrollable component was measured with an
 * infinity maximum height constraints"。给一个确定的 height，约束就变成有限，
 * 嵌套合法。UI 素材库的 scroll-lazy 示例（height: 170）就是这个套路。
 *
 * 换算：单行卡片约 56dp + 6dp 间距 ≈ 62dp，3 行 ≈ 186dp，留点余量取 200。
 */
const SESSION_LIST_HEIGHT = 200;

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;
  const snapState = ctx.useState('logs2_snap', '');
  const sessState = ctx.useState('logs2_sessions', '');
  const selState = ctx.useState('logs2_sel', 0);
  const busyState = ctx.useState('logs2_busy', false);
  const catState = ctx.useState('logs2_cat', '');
  const snapRaw = String(snapState[0] || '');
  const sessRaw = String(sessState[0] || '');
  const selIdx = Number(selState[0] || 0);
  const busy = !!busyState[0];
  const cat = String(catState[0] || '');

  let snap: any = null;
  if (snapRaw) {
    try { snap = JSON.parse(snapRaw); } catch (e) { snap = null; }
  }
  let sessions: LogSession[] = [];
  if (sessRaw) {
    try { sessions = JSON.parse(sessRaw); } catch (e) { sessions = []; }
  }

  /** 加载：会话列表 + 当前选中会话的正文 */
  async function load(idx?: number): Promise<void> {
    if (busy) return;
    busyState[1](true);

    const wantIdx = idx === undefined ? selIdx : idx;

    // 同步阶段：先算好要展示什么（setState 必须在 await 之前）
    let list: LogSession[] = [];
    try {
      list = listSessions();
    } catch (e) {
      list = [];
    }

    let content = '';
    let found = false;
    let startedAt = '';
    let bytes = 0;
    try {
      const r = readSession(wantIdx, 60000);
      content = r.content;
      found = r.found;
      startedAt = r.startedAt;
      bytes = content.length;
    } catch (e) {
      content = '（读取失败：' + String((e as any).message || e) + '）';
    }

    sessState[1](JSON.stringify(list));
    selState[1](wantIdx);
    snapState[1](JSON.stringify({
      content: content,
      found: found,
      startedAt: startedAt,
      bytes: bytes,
      path: getLogPath(),
      readAt: ''
    }));
    catState[1](buildCatBanner(pickSlogan()));

    busyState[1](false);
  }

  /** 清空 */
  async function doClear(): Promise<void> {
    if (busy) return;
    busyState[1](true);
    let ok = false;
    try {
      ok = clearLog();
    } catch (e) {
      ok = false;
    }
    sessState[1]('[]');
    selState[1](0);
    snapState[1](JSON.stringify({
      content: ok ? '（日志已清空）' : '（清空失败）',
      found: true,
      startedAt: '',
      bytes: 0,
      path: getLogPath(),
      readAt: ''
    }));
    busyState[1](false);
    try {
      ctx.showToast(ok ? '日志已清空' : '清空失败');
    } catch (e) { /* 忽略 */ }
  }

  /** 复制当前显示的日志到剪贴板 */
  async function doCopy(): Promise<void> {
    const text = snap && snap.content ? String(snap.content) : '';
    if (!text) {
      try { ctx.showToast('没有可复制的内容'); } catch (e) { /* 忽略 */ }
      return;
    }
    let r: any = { ok: false, reason: '未知错误' };
    try {
      r = copyToClipboard(text);
    } catch (e) {
      r = { ok: false, reason: String((e as any).message || e) };
    }
    try {
      if (r && r.ok) {
        ctx.showToast('已复制 ' + text.length + ' 字符到剪贴板');
      } else {
        ctx.showToast('复制失败：' + String((r && r.reason) || '未知'));
      }
    } catch (e) { /* 忽略 */ }
  }

  /** 字节数转可读 */
  function humanBytes(n: number): string {
    if (!n || n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /** 日志行 → 按等级上色 */
  function lineColor(line: string): string {
    if (line.indexOf('[ERROR]') >= 0) return '#FF4D4F';
    if (line.indexOf('[WARN]') >= 0) return '#FFA726';
    if (line.indexOf('[DEBUG]') >= 0) return String(c.onSurfaceVariant);
    if (line.indexOf('[INFO]') >= 0) return String(c.onSurface);
    if (line.indexOf('=====') >= 0) return String(c.primary);
    if (line.indexOf('/\\_/\\') >= 0 || line.indexOf('( o.o )') >= 0 || line.indexOf('> ^ <') >= 0) {
      return String(c.primary);
    }
    return String(c.onSurfaceVariant);
  }

  // ---- 顶栏 ----
  const curSession = (function () {
    if (!sessions.length) return null;
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].index === selIdx || (selIdx <= 0 && i === 0)) return sessions[i];
    }
    return sessions[0];
  })();

  const topBar = ctx.UI.Row({
    fillMaxWidth: true,
    height: 54,
    verticalAlignment: 'center',
    background: String(c.surface),
    paddingStart: 16,
    paddingEnd: 12,
    modifier: ctx.Modifier.statusBarsPadding()
  }, [
    ctx.UI.Column({ weight: 1, spacing: 0 }, [
      ctx.UI.Text({
        text: '运行日志',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: curSession
          ? '第 ' + String(curSession.index) + ' 轮 · ' + String(curSession.startedAt)
          : (sessions.length ? '共 ' + sessions.length + ' 轮会话' : '点右上角加载'),
        style: 'labelSmall',
        color: String(c.onSurfaceVariant),
        maxLines: 1,
        overflow: 'ellipsis'
      })
    ]),
    ctx.UI.Box({
      width: 36,
      height: 36,
      contentAlignment: 'center',
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => { await load(); })
    }, [ctx.UI.Icon({ name: 'search', size: 18, tint: String(c.onSurfaceVariant) })])
  ]);

const blocks: ComposeNode[] = [];

  // ---- 会话列表 ----
  //
  // 【包裹关系（重要）】
  //   整页根节点是 LazyColumn，这里又套了一个 LazyColumn —— 这是允许的，
  //   前提是**内层必须给固定 height**。给了高度就有有限约束，不会抛
  //   "infinity maximum height constraints"。UI 素材库的 scroll-lazy 示例
  //   就是这么写的：UI.LazyColumn({ fillMaxWidth: true, height: 170, spacing: 6 }, rows)
  //
  //   之前那次崩溃是因为内层没给 height，不是不能嵌。
  //
  // 【显示策略】固定高度只够约 3 行，多的靠这块自己上下滑，不把整页顶走。
  if (sessions.length > 0) {
    const rows: ComposeNode[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const active = s.index === selIdx || (selIdx <= 0 && i === 0);
      const dotColor = s.hasError
        ? String(c.error)
        : (s.hasWarn ? String(c.tertiary) : null);
      const subtitle = String(s.startedAt).slice(5, 16) +
        (s.lineCount ? ' · ' + String(s.lineCount) + ' 行' : '') +
        (s.hasError ? ' · 错误' : (s.hasWarn ? ' · 警告' : ''));
      rows.push(
        ctx.UI.Card({
          key: 'sess_' + s.index,
          fillMaxWidth: true,
          containerColor: active ? String(c.secondaryContainer) : String(c.surfaceVariant),
          modifier: ctx.Modifier.clickable(async () => { await load(s.index); })
        }, [
          ctx.UI.Row({
            fillMaxWidth: true,
            padding: 10,
            spacing: 10,
            verticalAlignment: 'center'
          }, [
            ctx.UI.Box({
              width: 8,
              height: 8,
              background: dotColor || String(c.outlineVariant),
              modifier: ctx.Modifier.clip({ type: 'circle' })
            }, []),
            ctx.UI.Column({ weight: 1, spacing: 2 }, [
              ctx.UI.Text({
                text: '第 ' + String(s.index) + ' 轮',
                style: 'bodyMedium',
                fontWeight: active ? 'bold' : 'normal',
                color: active ? String(c.onSecondaryContainer) : String(c.onSurface)
              }),
              ctx.UI.Text({
                text: subtitle,
                style: 'labelSmall',
                color: active ? String(c.onSecondaryContainer) : String(c.onSurfaceVariant)
              })
            ]),
            active
              ? ctx.UI.Icon({ name: 'check', size: 16, tint: String(c.primary) })
              : ctx.UI.Icon({ name: 'chevronRight', size: 16, tint: String(c.onSurfaceVariant) })
          ])
        ])
      );
    }
    blocks.push(
      ctx.UI.Row({
        fillMaxWidth: true,
        spacing: 6,
        verticalAlignment: 'center',
        paddingStart: 4,
        paddingEnd: 4
      }, [
        ctx.UI.Icon({ name: 'bolt', size: 14, tint: String(c.primary) }),
        ctx.UI.Text({
          text: '会话（' + sessions.length + ' 轮）',
          style: 'labelMedium',
          fontWeight: 'bold',
          color: String(c.onSurface),
          weight: 1
        }),
        ctx.UI.Text({
          text: sessions.length > SESSION_VISIBLE_MAX ? '滑动查看全部' : '点一行切换',
          style: 'labelSmall',
          color: String(c.onSurfaceVariant)
        })
      ])
    );
    // 固定高度：约 3 行（每行 ~56dp 卡片 + 6dp 间距）
    blocks.push(
      ctx.UI.LazyColumn({
        key: 'sess_list',
        fillMaxWidth: true,
        height: SESSION_LIST_HEIGHT,
        spacing: 6
      }, rows)
    );
  }


  // ---- 路径 + 大小 ----
  blocks.push(
    ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
      ctx.UI.Column({ padding: 12, spacing: 4 }, [
        ctx.UI.Row({ spacing: 6, verticalAlignment: 'center' }, [
          ctx.UI.Icon({ name: 'folder', size: 15, tint: String(c.onSurfaceVariant) }),
          ctx.UI.Text({
            text: '日志文件',
            style: 'labelMedium',
            fontWeight: 'bold',
            color: String(c.onSurface),
            weight: 1
          }),
          ctx.UI.Text({
            text: snap ? humanBytes(snap.bytes) : '—',
            style: 'labelSmall',
            color: String(c.onSurfaceVariant)
          })
        ]),
        ctx.UI.Text({
          text: getLogPath(),
          style: 'labelSmall',
          color: String(c.onSurfaceVariant)
        })
      ])
    ])
  );

  // ---- 操作行：刷新 / 复制 / 清空 ----
  blocks.push(
    ctx.UI.Row({ spacing: 8, fillMaxWidth: true }, [
      ctx.UI.Button({
        onClick: async () => { await load(); },
        weight: 1,
        enabled: !busy,
        contentColor: String(c.onPrimary),
        content: ctx.UI.Text({ text: '刷新', style: 'labelLarge', fontWeight: 'bold' })
      }),
      ctx.UI.OutlinedButton({
        onClick: async () => { await doCopy(); },
        weight: 1,
        enabled: !busy,
        content: ctx.UI.Text({ text: '复制', style: 'labelLarge' })
      }),
      ctx.UI.OutlinedButton({
        onClick: async () => { await doClear(); },
        weight: 1,
        enabled: !busy,
        content: ctx.UI.Text({ text: '清空', style: 'labelLarge' })
      })
    ])
  );

  // ---- 日志正文 ----
  if (!snap) {
    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
        ctx.UI.Column({ padding: 16, spacing: 8 }, [
          ctx.UI.Icon({ name: 'bolt', size: 24, tint: String(c.onSurfaceVariant) }),
          ctx.UI.Text({
            text: '尚未加载日志',
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onSurface)
          }),
          ctx.UI.Text({
            text: '点上方「刷新」读取',
            style: 'bodySmall',
            color: String(c.onSurfaceVariant)
          })
        ])
      ])
    );
  } else if (snap.found === false) {
    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.errorContainer) }, [
        ctx.UI.Column({ padding: 14, spacing: 6 }, [
          ctx.UI.Text({
            text: '该轮会话不存在',
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onErrorContainer)
          }),
          ctx.UI.Text({
            text: '可能已被轮转或清空，点「刷新」重读会话列表',
            style: 'labelSmall',
            color: String(c.onErrorContainer)
          })
        ])
      ])
    );
  } else {
    const content = String(snap.content || '');
    const lines = content.length ? content.split('\n') : ['（日志为空）'];
    const MAX_LINES = 400;
    const startIdx = lines.length > MAX_LINES ? lines.length - MAX_LINES : 0;

    const lineNodes: ComposeNode[] = [];
    if (startIdx > 0) {
      lineNodes.push(
        ctx.UI.Text({
          text: '… 前面还有 ' + startIdx + ' 行（可点「复制」取全文）…',
          style: 'labelSmall',
          color: String(c.onSurfaceVariant)
        })
      );
    }
    for (let i = startIdx; i < lines.length; i++) {
      const raw = lines[i];
      lineNodes.push(
        ctx.UI.Text({
          key: 'ln_' + i,
          text: raw.length ? raw : ' ',
          style: 'labelSmall',
          color: lineColor(raw)
        })
      );
    }

    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
        ctx.UI.Column({ padding: 10, spacing: 1 }, [
          ctx.UI.Row({ spacing: 6, verticalAlignment: 'center' }, [
            ctx.UI.Icon({ name: 'code', size: 14, tint: String(c.primary) }),
            ctx.UI.Text({
              text: '日志内容（' + (lines.length - startIdx) + ' 行）',
              style: 'labelMedium',
              fontWeight: 'bold',
              color: String(c.onSurface),
              weight: 1
            })
          ]),
          ctx.UI.Divider({ thickness: 0.5, color: String(c.outlineVariant) })
        ].concat(lineNodes))
      ])
    );
  }

  // ---- 猫 ----
  if (cat) {
    blocks.push(
      ctx.UI.Card({
        fillMaxWidth: true,
        containerColor: String(c.primaryContainer),
        modifier: ctx.Modifier.clickable(async () => {
          catState[1](buildCatBanner(pickSlogan()));
        })
      }, [
        ctx.UI.Column({ padding: 14, spacing: 2 }, [
          ctx.UI.Text({ text: cat, style: 'labelMedium', color: String(c.onPrimaryContainer) }),
          ctx.UI.Text({ text: '（点一下换个心情）', style: 'labelSmall', color: String(c.onPrimaryContainer) })
        ])
      ])
    );
  }

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface),
    onLoad: async () => { await load(); }
  }, [
    topBar,
    ctx.UI.LazyColumn({
      weight: 1,
      fillMaxWidth: true,
      padding: { horizontal: 16, vertical: 12 },
      spacing: 10
    }, blocks)
  ]);
}