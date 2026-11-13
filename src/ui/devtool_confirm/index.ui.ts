// 确认收件箱（devtool_confirm）
//
// 存在的理由：Operit 有个「恒古 bug」——会话过长时聊天里的 XML 确认框
// 不一定点得动。所以每个 XML 确认框底部都写了「若无法点击，请移步至本页」，
// 这个页面就是那条兜底通路。
//
// 页面逻辑：
//   1) onLoad 扫所有 pending 记录，取最近一条（pending 优先）
//   2) 展示和 XML 确认框完全一样的信息结构 + 确认/驳回
//   3) 下面列出其余记录，点一条切过去
//
// 与 XML 版的差异：这里操作完不需要回头唤醒 AI（没有 chatId），
// 只改记录状态；用户回到聊天重新触发即可。

import type { ComposeNode } from '../../model/compose';
import {
  findLatestPending,
  listHistory,
  setConfirmStatus,
  isBypassEnabled
} from '../../service/confirmService';
import type { ConfirmRecord } from '../../model/confirm';

const RED = '#FF4D4F';
const GREEN = '#4CAF50';

function actionLabel(action: string): string {
  if (action === 'destroy') return '整包摧毁';
  if (action === 'archive') return '整包归档';
  if (action === 'delete_dir') return '删除目录';
  if (action === 'rollback_old') return '回滚到过旧版本';
  if (action === 'revert_to') return '批量回滚';
  return action || '未知操作';
}

function statusText(status: string): string {
  if (status === 'approved') return '已确认，等待 AI 继续';
  if (status === 'rejected') return '已驳回';
  if (status === 'done') return '已完成';
  if (status === 'failed') return '执行失败';
  return '等待确认';
}

function statusColor(status: string): string {
  if (status === 'approved' || status === 'done') return GREEN;
  if (status === 'rejected' || status === 'failed') return RED;
  return '#888888';
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  const curState = ctx.useState('cf_cur', '');
  const listState = ctx.useState('cf_list', '');
  const busyState = ctx.useState('cf_busy', false);
  const errState = ctx.useState('cf_err', '');

  const curRaw = String(curState[0] || '');
  const listRaw = String(listState[0] || '');
  const busy = !!busyState[0];
  const err = String(errState[0] || '');

  let cur: ConfirmRecord | null = null;
  if (curRaw) {
    try { cur = JSON.parse(curRaw); } catch (e) { cur = null; }
  }
  let list: ConfirmRecord[] = [];
  if (listRaw) {
    try { list = JSON.parse(listRaw); } catch (e) { list = []; }
  }

  /** 加载：最近一条待确认 + 全部历史 */
  async function loadAll(): Promise<void> {
    errState[1]('');
    try {
      const latest = await findLatestPending();
      curState[1](latest ? JSON.stringify(latest) : '');
      const all = await listHistory();
      listState[1](JSON.stringify(all));
    } catch (e) {
      errState[1]('读取确认记录失败：' + String((e as any).message || e));
    }
  }

  /** 切换到某条记录 */
  function selectRec(rec: ConfirmRecord): void {
    curState[1](JSON.stringify(rec));
  }

  /** 确认 / 驳回 */
  async function resolve(next: 'approved' | 'rejected'): Promise<void> {
    if (busy || !cur) return;
    busyState[1](true);
    try {
      const updated = await setConfirmStatus(cur.packageId, cur.id, next);
      if (updated) {
        curState[1](JSON.stringify(updated));
        const all = await listHistory();
        listState[1](JSON.stringify(all));
        ctx.showToast(next === 'approved' ? '已批准' : '已驳回');
      } else {
        errState[1]('记录已失效，请刷新');
      }
    } catch (e) {
      errState[1]('操作失败：' + String((e as any).message || e));
    }
    busyState[1](false);
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
        text: '待确认操作',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: '聊天里的确认框点不动时，在这里确认',
        style: 'labelSmall',
        color: String(c.onSurfaceVariant)
      })
    ]),
    // 刷新按钮（自绘圆形，不用 IconButton）
    ctx.UI.Box({
      width: 36,
      height: 36,
      contentAlignment: 'center',
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => { await loadAll(); })
    }, [ctx.UI.Icon({ name: 'refresh', size: 18, tint: String(c.onSurfaceVariant) })])
  ]);

  const blocks: ComposeNode[] = [];

  // ---- 当前记录 ----
  if (!cur) {
    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
        ctx.UI.Column({ padding: 16, spacing: 8 }, [
          ctx.UI.Icon({ name: 'checkCircle', size: 28, tint: GREEN }),
          ctx.UI.Text({
            text: '没有待确认的操作',
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onSurface)
          }),
          ctx.UI.Text({
            text: '危险操作触发时，确认窗口会出现在这里。',
            style: 'bodySmall',
            color: String(c.onSurfaceVariant)
          })
        ])
      ])
    );
  } else {
    const isPending = cur.status === 'pending';
    const detailChildren: ComposeNode[] = [
      ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
        ctx.UI.Icon({ name: 'warning', size: 18, tint: RED }),
        ctx.UI.Text({
          text: actionLabel(cur.action),
          style: 'titleSmall',
          fontWeight: 'bold',
          color: RED
        }),
        ctx.UI.Text({
          text: '#' + cur.id,
          style: 'labelSmall',
          color: String(c.onSurfaceVariant),
          weight: 1
        })
      ])
    ];

    if (cur.summary) {
      detailChildren.push(
        ctx.UI.Text({ text: cur.summary, style: 'bodyMedium', color: String(c.onSurface) })
      );
    }
    if (cur.detail) {
      detailChildren.push(ctx.UI.Divider({ thickness: 0.5, color: String(c.outlineVariant) }));
      detailChildren.push(
        ctx.UI.Text({ text: cur.detail, style: 'bodySmall', color: String(c.onSurfaceVariant) })
      );
    }
    detailChildren.push(ctx.UI.Divider({ thickness: 0.5, color: String(c.outlineVariant) }));
    detailChildren.push(
      ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
        ctx.UI.Text({
          text: statusText(cur.status),
          style: 'labelMedium',
          fontWeight: 'bold',
          color: statusColor(cur.status)
        }),
        ctx.UI.Text({
          text: cur.packageId,
          style: 'labelSmall',
          color: String(c.onSurfaceVariant),
          weight: 1
        })
      ])
    );

    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.errorContainer) }, [
        ctx.UI.Column({ padding: 16, spacing: 10 }, [
          // 标题区：主标题 + 小字（与 XML 版一致）
          ctx.UI.Text({
            text: '需要你批准',
            style: 'titleLarge',
            fontWeight: 'bold',
            color: String(c.onErrorContainer)
          }),
          ctx.UI.Text({
            text: '该操作涉及大量不可逆操作，请谨慎选择',
            style: 'bodySmall',
            color: String(c.onErrorContainer)
          }),
          ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
            ctx.UI.Column({ padding: 14, spacing: 8 }, detailChildren)
          ])
        ])
      ])
    );

    // ---- 按钮 ----
    if (isPending) {
      blocks.push(
        ctx.UI.Row({ spacing: 10 }, [
          ctx.UI.Button({
            onClick: async () => { await resolve('approved'); },
            weight: 1,
            containerColor: RED,
            contentColor: '#FFFFFF',
            enabled: !busy,
            content: busy
              ? ctx.UI.CircularProgressIndicator({ strokeWidth: 2, color: '#FFFFFF' })
              : ctx.UI.Text({
                  text: '确认',
                  style: 'labelLarge',
                  fontWeight: 'bold'
                })
          }),
          ctx.UI.OutlinedButton({
            onClick: async () => { await resolve('rejected'); },
            weight: 1,
            enabled: !busy,
            content: ctx.UI.Text({
              text: '驳回',
              style: 'labelLarge'
            })
          })
        ])
      );
    }

    // 更小的注释（用户要求的第三行）
    blocks.push(
      ctx.UI.Text({
        text: '*若聊天中的确认框无法点击，请在本页完成确认。',
        style: 'labelSmall',
        color: String(c.onSurfaceVariant),
        paddingStart: 4
      })
    );
  }

  if (err) {
    blocks.push(
      ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.errorContainer) }, [
        ctx.UI.Column({ padding: 12, spacing: 4 }, [
          ctx.UI.Text({ text: err, style: 'bodySmall', color: String(c.onErrorContainer) })
        ])
      ])
    );
  }

  // ---- 其余记录 ----
  if (list.length > 1) {
    blocks.push(
      ctx.UI.Text({
        text: '历史记录（' + list.length + '）',
        style: 'labelLarge',
        fontWeight: 'bold',
        color: String(c.primary),
        paddingStart: 4
      })
    );
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (cur && rec.id === cur.id) continue;
      const isCurPending = rec.status === 'pending';
      blocks.push(
        ctx.UI.Card({
          fillMaxWidth: true,
          key: 'rec_' + rec.id,
          containerColor: String(c.surfaceVariant),
          modifier: ctx.Modifier.clickable(async () => { selectRec(rec); })
        }, [
          ctx.UI.Column({ padding: 12, spacing: 4 }, [
            ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
              ctx.UI.Icon({
                name: isCurPending ? 'warning' : 'checkCircle',
                size: 15,
                tint: statusColor(rec.status)
              }),
              ctx.UI.Text({
                text: actionLabel(rec.action),
                style: 'labelMedium',
                fontWeight: 'bold',
                color: String(c.onSurface),
                weight: 1
              }),
              ctx.UI.Text({
                text: statusText(rec.status),
                style: 'labelSmall',
                color: statusColor(rec.status)
              })
            ]),
            ctx.UI.Text({
              text: rec.summary || rec.id,
              style: 'bodySmall',
              color: String(c.onSurfaceVariant),
              maxLines: 2,
              overflow: 'ellipsis'
            })
          ])
        ])
      );
    }
  }

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface),
    onLoad: loadAll
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