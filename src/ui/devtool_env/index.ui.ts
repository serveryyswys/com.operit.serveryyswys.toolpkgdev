// 环境检查页（devtool_env）
//
// 针对「莫名其妙的加载空白」的处理：
//   首屏**立刻**渲染 5 个待检项骨架（状态 = 检测中），异步只负责把每项状态填成
//   ok / warn / fail。也就是说：进页面就有东西看，而不是等 toolCall 全部返回。
//
// 针对「薛定谔的加载」的处理：
//   onLoad 只在根节点触发一次，可能因为引擎复用而不跑。
//   所以：页面内保留显式「重新检查」按钮；并且 _busy / _done 两个 state 一起用，
//   判断依据不是「有没有数据」而是「有没有跑完」。

import type { ComposeNode } from '../../model/compose';
import { runEnvCheck } from '../../service/envCheckService';
import type { CheckItem } from '../../service/envCheckService';

const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';

/** 骨架：进页面就先显示的 5 项 */
const SKELETON: Array<{ id: string; label: string }> = [
  { id: 'dir-dev-package', label: '开发目录写入' },
  { id: 'dir-cleanonexit', label: '确认记录目录写入' },
  { id: 'opm', label: 'opm 构建工具' },
  { id: 'tsc', label: 'TypeScript 编译器' },
  { id: 'node-operit', label: 'node.operit 依赖' }
];

/** 等级 → 图标 */
function levelIcon(level: string): string {
  if (level === 'ok') return 'checkCircle';
  if (level === 'warn') return 'warning';
  if (level === 'fail') return 'error';
  return 'bolt'; // 检测中
}

/** 等级 → 颜色 */
function levelColor(level: string): string {
  if (level === 'ok') return '#4CAF50';
  if (level === 'warn') return '#FFA726';
  if (level === 'fail') return '#FF4D4F';
  return '#9E9E9E';
}

/** 等级 → 文案 */
function levelText(level: string): string {
  if (level === 'ok') return '通过';
  if (level === 'warn') return '警告';
  if (level === 'fail') return '失败';
  return '检测中';
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  const reportState = ctx.useState('env2_report', '');
  const busyState = ctx.useState('env2_busy', false);
  const doneState = ctx.useState('env2_done', false);

  const reportRaw = String(reportState[0] || '');
  const busy = !!busyState[0];
  const done = !!doneState[0];

  // 解析结果；解析不出来就用空
  let items: CheckItem[] = [];
  let report: any = null;
  if (reportRaw) {
    try {
      report = JSON.parse(reportRaw);
      if (report && Array.isArray(report.items)) items = report.items;
    } catch (e) { report = null; }
  }

  /** 跑检查 */
  async function doCheck(): Promise<void> {
    if (busy) return;

    // ---- 关键：所有「点亮转圈」的 setState 必须在第一个 await 之前同步发出 ----
    // DSL 的 setState 只在 action 派发期间有接收方，await 之后这一轮派发就结束了，
    // 之后的 setState 不触发重绘（点击 → 转圈 这一步就画不出来）。
    busyState[1](true);
    doneState[1](false);

    // 先把骨架清掉，让界面立刻回到「检测中」态
    reportState[1]('');

    // 从这里开始才是异步阶段，后面的 setState 只负责收尾
    let payload: any = null;
    try {
      const r = await runEnvCheck(PKG_ID);
      payload = r;
    } catch (e) {
      payload = {
        items: SKELETON.map(function (s) {
          return {
            id: s.id,
            label: s.label,
            level: 'fail',
            message: '检查中断：' + String((e as any).message || e)
          };
        }),
        okCount: 0,
        warnCount: 0,
        failCount: SKELETON.length,
        healthy: false,
        checkedAt: new Date().toISOString()
      };
    }

    // 收尾：写入结果 + 关掉转圈（这一步可能不触发重绘，但下次进页面能读到）
    reportState[1](JSON.stringify(payload));
    busyState[1](false);
    doneState[1](true);
  }

  // ---- 顶栏 ----
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
        text: '环境检查',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: 'opm / tsc / 目录写入 / node.operit',
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
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => { await doCheck(); })
    }, [ctx.UI.Icon({ name: 'search', size: 18, tint: String(c.onSurfaceVariant) })])
  ]);

  // ---- 汇总条（始终渲染，不给空白）----
  let summaryLine = '点右上角开始检查';
  let summaryColor = '#9E9E9E';
  let okN = 0;
  let warnN = 0;
  let failN = 0;
  if (busy) {
    summaryLine = '正在检查…';
    summaryColor = '#5B8DEF';
  } else if (report) {
    okN = Number(report.okCount || 0);
    warnN = Number(report.warnCount || 0);
    failN = Number(report.failCount || 0);
    summaryLine = okN + ' 通过 · ' + warnN + ' 警告 · ' + failN + ' 失败';
    summaryColor = failN > 0 ? '#FF4D4F' : (warnN > 0 ? '#FFA726' : '#4CAF50');
  }

  const summaryCard = ctx.UI.Card({
    fillMaxWidth: true,
    containerColor: String(c.primaryContainer)
  }, [
    ctx.UI.Column({ padding: 14, spacing: 6 }, [
      ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
        busy
          ? ctx.UI.CircularProgressIndicator({ strokeWidth: 2, color: String(c.primary) })
          : ctx.UI.Icon({
              name: report ? (failN > 0 ? 'error' : 'checkCircle') : 'bolt',
              size: 18,
              tint: summaryColor
            }),
        ctx.UI.Text({
          text: summaryLine,
          style: 'titleSmall',
          fontWeight: 'bold',
          color: String(c.onPrimaryContainer),
          weight: 1
        })
      ]),
      ctx.UI.Text({
        text: report
          ? '检查时间：' + String(report.checkedAt || '')
          : '首次进入会自动跑一次；若没动静，点右下角或右上角的按钮手动触发',
        style: 'labelSmall',
        color: String(c.onPrimaryContainer)
      })
    ])
  ]);

  // ---- 检查项：优先用结果，没有就用骨架 ----
  const rows: ComposeNode[] = [];
  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const color = levelColor(it.level);
      const children: ComposeNode[] = [
        ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
          ctx.UI.Icon({ name: levelIcon(it.level), size: 16, tint: color }),
          ctx.UI.Text({
            text: it.label,
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onSurface),
            weight: 1
          }),
          ctx.UI.Text({
            text: levelText(it.level),
            style: 'labelSmall',
            fontWeight: 'bold',
            color: color
          })
        ]),
        ctx.UI.Text({
          text: it.message,
          style: 'bodySmall',
          color: String(c.onSurfaceVariant)
        })
      ];
      // hint 用图标 + 文字，不用 emoji
      if (it.hint) {
        children.push(
          ctx.UI.Row({ spacing: 6, verticalAlignment: 'center' }, [
            ctx.UI.Icon({ name: 'bolt', size: 13, tint: '#FFA726' }),
            ctx.UI.Text({
              text: it.hint,
              style: 'labelSmall',
              color: String(c.onSurfaceVariant),
              weight: 1
            })
          ])
        );
      }
      rows.push(
        ctx.UI.Card({
          fillMaxWidth: true,
          key: 'env_item_' + it.id,
          containerColor: String(c.surfaceVariant)
        }, [ctx.UI.Column({ padding: 12, spacing: 6 }, children)])
      );
    }
  } else {
    // 骨架：进页面立刻看到 5 项，状态都是「检测中」
    for (let i = 0; i < SKELETON.length; i++) {
      const s = SKELETON[i];
      rows.push(
        ctx.UI.Card({
          fillMaxWidth: true,
          key: 'env_skel_' + s.id,
          containerColor: String(c.surfaceVariant)
        }, [
          ctx.UI.Column({ padding: 12, spacing: 6 }, [
            ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
              ctx.UI.Icon({ name: 'bolt', size: 16, tint: levelColor('') }),
              ctx.UI.Text({
                text: s.label,
                style: 'titleSmall',
                fontWeight: 'bold',
                color: String(c.onSurface),
                weight: 1
              }),
              ctx.UI.Text({
                text: '检测中',
                style: 'labelSmall',
                color: levelColor('')
              })
            ]),
            ctx.UI.Text({
              text: '等待检查…',
              style: 'bodySmall',
              color: String(c.onSurfaceVariant)
            })
          ])
        ])
      );
    }
  }

  // ---- 底部按钮：显式的「重新检查」，不依赖 onLoad ----
  const actionRow = ctx.UI.Row({ spacing: 10, fillMaxWidth: true }, [
    ctx.UI.Button({
      // 必须显式写成 async 箭头：直接传函数引用时宿主拿不到「这是 async」的语义
      onClick: async () => { await doCheck(); },
      weight: 1,
      // 检查中禁用 → 宿主自动置灰（不用手改颜色）
      enabled: !busy,
      // 容器色留默认（primary），只指定内容色 → 保证和容器成对
      contentColor: String(c.onPrimary),
      content: busy
        ? ctx.UI.CircularProgressIndicator({ strokeWidth: 2, color: String(c.onPrimary) })
        : ctx.UI.Text({
            text: done ? '重新检查' : '开始检查',
            style: 'labelLarge',
            fontWeight: 'bold'
          })
    })
  ]);

  const blocks: ComposeNode[] = [summaryCard, actionRow];
  for (let i = 0; i < rows.length; i++) blocks.push(rows[i]);

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface),
    onLoad: doCheck
  }, [
    topBar,
    ctx.UI.LazyColumn({
      weight: 1,
      fillMaxWidth: true,
      padding: { horizontal: 16, vertical: 12 },
      spacing: 8
    }, blocks)
  ]);
}