// 首页（devtool_home）—— 整个包的唯一入口
//
// 设计要点（针对实际踩到的四个问题）：
//   1) 空白加载：Home 只显示「静态可达」的信息 + 一个可以立刻点的按钮，
//      不把「必须等异步」当成首屏内容
//   2) emoji：全部改用 m3 Icon（name 取 gallery 验证过的名字）
//   3) 没有入口：本页就是入口，三个子页都从这里 navigate 过去
//   4) 薛定谔的加载：onLoad 只在根节点触发一次，所以子页不能靠 onLoad 保证有数据；
//      这里给每个子页都配了「点击即进」的入口 + 页面内自带刷新按钮
//
// 路由：toolpkg:com.operit.serveryyswys.toolpkgdev:ui:home

import type { ComposeNode } from '../../model/compose';
import { findLatestPending } from '../../service/confirmService';
import { readSettings } from '../../service/settingsService';
import { listProjects } from '../../service/projectService';
import { isBypassEnabled } from '../../service/confirmService';

const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';

/** 与 main.ts 的 routeOf 保持一致 */
function routeOf(moduleId: string): string {
  return 'toolpkg:' + PKG_ID + ':ui:' + moduleId;
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  // 概览数据（JSON 字符串，state 只认基本类型）
  const overviewState = ctx.useState('home_overview', '');
  const busyState = ctx.useState('home_busy', false);

  const overviewRaw = String(overviewState[0] || '');
  const busy = !!busyState[0];

  let ov: any = null;
  if (overviewRaw) {
    try { ov = JSON.parse(overviewRaw); } catch (e) { ov = null; }
  }

  /** 拉概览：待确认数 + 项目数 + 权限开关 + 阈值摘要 */
  async function loadOverview(): Promise<void> {
    if (busy) return;
    busyState[1](true);
    const out: any = {
      pendingId: '',
      pendingAction: '',
      pendingSummary: '',
      projectCount: 0,
      bypass: false,
      deleteThreshold: 20,
      rollbackThreshold: 3
    };
    try {
      const p = await findLatestPending();
      if (p) {
        out.pendingId = p.id;
        out.pendingAction = p.action;
        out.pendingSummary = p.summary || '';
      }
    } catch (e) { /* 读不到按无待确认处理 */ }
    try {
      out.projectCount = listProjects().length;
    } catch (e) { out.projectCount = 0; }
    try {
      out.bypass = isBypassEnabled();
    } catch (e) { out.bypass = false; }
    try {
      const s = await readSettings(PKG_ID);
      out.deleteThreshold = s.deleteDirFileCount;
      out.rollbackThreshold = s.rollbackVersionSpan;
    } catch (e) { /* 用默认值 */ }

    overviewState[1](JSON.stringify(out));
    busyState[1](false);
  }

  /** 动作 → 中文 */
  function actionLabel(a: string): string {
    if (a === 'destroy') return '整包摧毁';
    if (a === 'archive') return '整包归档';
    if (a === 'delete_dir') return '删除目录';
    if (a === 'rollback_old') return '回滚到过旧版本';
    if (a === 'revert_to') return '批量回滚';
    return a || '未知操作';
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
    ctx.UI.Row({ spacing: 8, verticalAlignment: 'center', weight: 1 }, [
      ctx.UI.Icon({ name: 'code', size: 20, tint: String(c.primary) }),
      ctx.UI.Text({
        text: 'ToolpkgDev',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      })
    ]),
    // 刷新（自绘圆形，不用 IconButton）
    ctx.UI.Box({
      width: 36,
      height: 36,
      contentAlignment: 'center',
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => { await loadOverview(); })
    }, [ctx.UI.Icon({ name: 'search', size: 18, tint: String(c.onSurfaceVariant) })])
  ]);

  /** 通用入口卡：图标 + 标题 + 副标题 + 右侧箭头 */
  function entryCard(
    key: string,
    iconName: string,
    title: string,
    subtitle: string,
    route: string,
    tintColor: string
  ): ComposeNode {
    return ctx.UI.Card({
      fillMaxWidth: true,
      key: key,
      containerColor: String(c.surfaceVariant),
      modifier: ctx.Modifier.clickable(async () => { ctx.navigate(route); })
    }, [
      ctx.UI.Row({
        fillMaxWidth: true,
        padding: { horizontal: 14, vertical: 14 },
        spacing: 12,
        verticalAlignment: 'center'
      }, [
        // 图标底座
        ctx.UI.Box({
          width: 38,
          height: 38,
          contentAlignment: 'center',
          background: tintColor,
          modifier: ctx.Modifier.clip({ type: 'circle' })
        }, [
          ctx.UI.Icon({ name: iconName, size: 20, tint: '#FFFFFF' })
        ]),
        ctx.UI.Column({ weight: 1, spacing: 2 }, [
          ctx.UI.Text({
            text: title,
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onSurface)
          }),
          ctx.UI.Text({
            text: subtitle,
            style: 'labelSmall',
            color: String(c.onSurfaceVariant),
            maxLines: 2,
            overflow: 'ellipsis'
          })
        ]),
        ctx.UI.Icon({ name: 'chevronRight', size: 18, tint: String(c.onSurfaceVariant) })
      ])
    ]);
  }

  const blocks: ComposeNode[] = [];

  // ---- 待确认横幅（只在有 pending 时出现，且排在最前）----
  if (ov && ov.pendingId) {
    blocks.push(
      ctx.UI.Card({
        fillMaxWidth: true,
        key: 'home_pending_banner',
        containerColor: String(c.errorContainer),
        modifier: ctx.Modifier.clickable(async () => { ctx.navigate(routeOf('confirm')); })
      }, [
        ctx.UI.Row({
          fillMaxWidth: true,
          padding: { horizontal: 14, vertical: 12 },
          spacing: 10,
          verticalAlignment: 'center'
        }, [
          ctx.UI.Icon({ name: 'warning', size: 22, tint: '#FF4D4F' }),
          ctx.UI.Column({ weight: 1, spacing: 2 }, [
            ctx.UI.Text({
              text: '有 1 个操作待你批准',
              style: 'titleSmall',
              fontWeight: 'bold',
              color: String(c.onErrorContainer)
            }),
            ctx.UI.Text({
              text: actionLabel(ov.pendingAction) + '：' + (ov.pendingSummary || ov.pendingId),
              style: 'labelSmall',
              color: String(c.onErrorContainer),
              maxLines: 2,
              overflow: 'ellipsis'
            })
          ]),
          ctx.UI.Icon({ name: 'chevronRight', size: 18, tint: String(c.onErrorContainer) })
        ])
      ])
    );
  }

  // ---- 概览卡 ----
  const summaryRows: ComposeNode[] = [];
  if (!ov) {
    summaryRows.push(
      ctx.UI.Text({
        text: busy ? '正在读取…' : '点右上角刷新读取当前状态',
        style: 'bodySmall',
        color: String(c.onSurfaceVariant)
      })
    );
  } else {
    summaryRows.push(
      ctx.UI.Row({ spacing: 18 }, [
        ctx.UI.Column({ spacing: 0 }, [
          ctx.UI.Text({
            text: String(ov.projectCount),
            style: 'headlineSmall',
            fontWeight: 'bold',
            color: String(c.primary)
          }),
          ctx.UI.Text({ text: '已登记项目', style: 'labelSmall', color: String(c.onSurfaceVariant) })
        ]),
        ctx.UI.Column({ spacing: 0, weight: 1 }, [
          ctx.UI.Row({ spacing: 6, verticalAlignment: 'center' }, [
            ctx.UI.Icon({
              name: ov.bypass ? 'bolt' : 'check',
              size: 15,
              tint: ov.bypass ? '#FFA726' : '#4CAF50'
            }),
            ctx.UI.Text({
              text: ov.bypass ? '确认已关闭' : '确认已开启',
              style: 'labelMedium',
              fontWeight: 'bold',
              color: ov.bypass ? '#FFA726' : '#4CAF50'
            })
          ]),
          ctx.UI.Text({
            text: '删除 >' + ov.deleteThreshold + ' 文件 / 回滚 >' + ov.rollbackThreshold + ' 版本时确认',
            style: 'labelSmall',
            color: String(c.onSurfaceVariant),
            maxLines: 2
          })
        ])
      ])
    );
  }

  blocks.push(
    ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.primaryContainer) }, [
      ctx.UI.Column({ padding: 14, spacing: 8 }, summaryRows)
    ])
  );

  // ---- 三个入口 ----
  blocks.push(
    ctx.UI.Text({
      text: '功能入口',
      style: 'labelLarge',
      fontWeight: 'bold',
      color: String(c.primary),
      paddingStart: 4,
      paddingTop: 8
    })
  );
  blocks.push(
    entryCard(
      'home_ent', 'checkCircle', '环境检查', 'opm / tsc / 目录可写 / node.operit 依赖', routeOf('env'), '#4CAF50'
    ),
    entryCard(
      'home_set', 'settings', '基础配置', '确认开关、危险阈值、依赖上限、快照保留', routeOf('settings'), '#5B8DEF'
    ),
    entryCard(
      'home_cfm', 'warning', '待确认操作', '聊天里的确认框点不动时，在这里完成确认', routeOf('confirm'), '#FF7043'
    ),
    entryCard(
      'home_logs', 'code', '运行日志', '查看启动记录与错误堆栈，定位渲染 / 工具异常', routeOf('logs'), '#7E57C2'
    ),
    entryCard(
      'home_about', 'description', '关于', '版本信息、开源许可声明与仓库入口', routeOf('about'), '#607D8B'
    )
  );

  // ---- 说明 ----
  blocks.push(
    ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
      ctx.UI.Column({ padding: 14, spacing: 6 }, [
        ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
          ctx.UI.Icon({ name: 'folder', size: 16, tint: String(c.onSurfaceVariant) }),
          ctx.UI.Text({
            text: '开发目录',
            style: 'labelMedium',
            fontWeight: 'bold',
            color: String(c.onSurface)
          })
        ]),
        ctx.UI.Text({
          text: '/storage/emulated/0/Download/Operit/dev_package',
          style: 'labelSmall',
          color: String(c.onSurfaceVariant)
        })
      ])
    ])
  );

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface),
    onLoad: loadOverview
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