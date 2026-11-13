// 危险操作确认框（devtool_check）
//
// 由 XML <devtool_check>{"id":"..."}</devtool_check> 触发渲染。
// state 由 main.ts 的 onCheckXmlRender 注入：
//   _id / _packageId / _action / _summary / _detail / _status / _title / _hint / _chatId
//
// 用户点「确认」→ pending 落盘改 approved，并发消息唤醒 AI 继续执行
// 用户点「驳回」→ 落盘改 rejected，AI 放弃
//
// 注意：会话过长时聊天里的 XML 可能点不动，所以底部固定有一行
// 「若无法点击，请移步至『待确认操作』页面」，对应 devtool_confirm 路由。

import type { ComposeNode } from '../../model/compose';

const PENDING_ROOT = '/storage/emulated/0/Download/Operit/cleanOnExit';
const RED = '#FF4D4F';
const GREEN = '#4CAF50';

function stripLinePrefixes(text: string): string {
  if (!text) return text;
  return String(text).replace(/^\s*\d+\|/gm, '');
}

function pendingPath(packageId: string, id: string): string {
  return PENDING_ROOT + '/' + packageId + '/pending/' + id + '.json';
}

function actionLabel(action: string): string {
  if (action === 'destroy') return '整包摧毁';
  if (action === 'archive') return '整包归档';
  if (action === 'delete_dir') return '删除目录';
  if (action === 'rollback_old') return '回滚到过旧版本';
  if (action === 'revert_to') return '批量回滚';
  return action || '未知操作';
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  const idState = ctx.useState('_id', '');
  const pkgState = ctx.useState('_packageId', '');
  const actionState = ctx.useState('_action', '');
  const summaryState = ctx.useState('_summary', '');
  const detailState = ctx.useState('_detail', '');
  const statusState = ctx.useState('_status', 'pending');
  const titleState = ctx.useState('_title', '需要你批准');
  const hintState = ctx.useState('_hint', '该操作涉及大量不可逆操作，请谨慎选择');
  const chatIdState = ctx.useState('_chatId', '');
  const busyState = ctx.useState('_busy', false);
  const errState = ctx.useState('_err', '');

  const id = String(idState[0] || '');
  const packageId = String(pkgState[0] || '');
  const action = String(actionState[0] || '');
  const summary = String(summaryState[0] || '');
  const detail = String(detailState[0] || '');
  const status = String(statusState[0] || 'pending');
  const title = String(titleState[0] || '需要你批准');
  const hint = String(hintState[0] || '该操作涉及大量不可逆操作，请谨慎选择');
  const chatId = String(chatIdState[0] || '');
  const busy = !!busyState[0];
  const err = String(errState[0] || '');

  function statusText(): string {
    if (status === 'approved') return '已确认，AI 将继续执行';
    if (status === 'rejected') return '已驳回，操作不会执行';
    if (status === 'done') return '已完成';
    if (status === 'failed') return '执行失败';
    return '等待你确认…';
  }

  function statusColor(): string {
    if (status === 'approved' || status === 'done') return GREEN;
    if (status === 'rejected' || status === 'failed') return RED;
    return String(c.onSurfaceVariant);
  }

  async function resolveStatus(next: string): Promise<boolean> {
    if (!id || !packageId) {
      errState[1]('缺少确认记录信息，无法更新状态');
      return false;
    }
    try {
      const path = pendingPath(packageId, id);
      const raw: any = await ctx.callTool('read_file', { path: path });
      const content = raw && raw.content !== undefined ? stripLinePrefixes(String(raw.content)) : '';
      const rec: any = content ? JSON.parse(content) : { id: id, packageId: packageId };
      rec.status = next;
      rec.updatedAt = new Date().toISOString();
      await ctx.callTool('write_file', { path: path, content: JSON.stringify(rec) });
      statusState[1](next);
      return true;
    } catch (e) {
      errState[1]('更新确认状态失败：' + String((e as any).message || e));
      return false;
    }
  }

  async function notifyAI(text: string): Promise<void> {
    try {
      await (Tools as any).Chat.sendMessage(text, chatId || undefined, undefined, undefined, { runtime: 'main' });
    } catch (e) {
      // 唤醒失败不阻塞界面
    }
  }

  async function onConfirm(): Promise<void> {
    if (busy || status !== 'pending') return;
    busyState[1](true);
    const ok = await resolveStatus('approved');
    busyState[1](false);
    if (ok) {
      await notifyAI('[已批准] 「' + actionLabel(action) + '」（' + (summary || id) + '），请继续执行。');
    }
  }

  async function onReject(): Promise<void> {
    if (busy || status !== 'pending') return;
    busyState[1](true);
    const ok = await resolveStatus('rejected');
    busyState[1](false);
    if (ok) {
      await notifyAI('[已驳回] 「' + actionLabel(action) + '」（' + (summary || id) + '），请勿执行。');
    }
  }

  // ---- 头部：主标题 + 小字 ----
  const header = ctx.UI.Column({ spacing: 4, fillMaxWidth: true }, [
    ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
      ctx.UI.Icon({ name: 'warning', size: 22, tint: RED }),
      ctx.UI.Text({
        text: title,
        style: 'titleLarge',
        fontWeight: 'bold',
        color: String(c.onSurface),
        weight: 1
      })
    ]),
    ctx.UI.Text({ text: hint, style: 'bodySmall', color: String(c.onSurfaceVariant) })
  ]);

  // ---- 详情卡 ----
  const detailRows: ComposeNode[] = [
    ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
      ctx.UI.Text({ text: actionLabel(action), style: 'titleSmall', fontWeight: 'bold', color: RED }),
      ctx.UI.Text({ text: '#' + id, style: 'labelSmall', color: String(c.onSurfaceVariant), weight: 1 })
    ])
  ];
  if (summary) {
    detailRows.push(ctx.UI.Text({ text: summary, style: 'bodyMedium', color: String(c.onSurface) }));
  }
  if (detail) {
    detailRows.push(ctx.UI.Divider({ thickness: 0.5, color: String(c.outlineVariant) }));
    detailRows.push(ctx.UI.Text({ text: detail, style: 'bodySmall', color: String(c.onSurfaceVariant) }));
  }
  detailRows.push(ctx.UI.Divider({ thickness: 0.5, color: String(c.outlineVariant) }));
  detailRows.push(ctx.UI.Text({ text: statusText(), style: 'labelMedium', fontWeight: 'bold', color: statusColor() }));
  if (err) {
    detailRows.push(ctx.UI.Text({ text: err, style: 'bodySmall', color: RED }));
  }

  const detailCard = ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
    ctx.UI.Column({ padding: 14, spacing: 8 }, detailRows)
  ]);

  // ---- 按钮（仅 pending 时显示）----
  const rootChildren: ComposeNode[] = [header, detailCard];

  if (status === 'pending') {
    rootChildren.push(
      ctx.UI.Row({ spacing: 10, fillMaxWidth: true }, [
        ctx.UI.Button({
          onClick: async () => { await onConfirm(); },
          weight: 1,
          containerColor: RED,
          contentColor: '#FFFFFF',
          enabled: !busy,
          content: busy
            ? ctx.UI.CircularProgressIndicator({ strokeWidth: 2, color: '#FFFFFF' })
            : ctx.UI.Text({ text: '确认', style: 'labelLarge', fontWeight: 'bold' })
        }),
        ctx.UI.OutlinedButton({
          onClick: async () => { await onReject(); },
          weight: 1,
          enabled: !busy,
          content: ctx.UI.Text({ text: '驳回', style: 'labelLarge' })
        })
      ])
    );
  }

  // ---- 兜底注释（会话过长时 XML 可能点不动）----
  rootChildren.push(
    ctx.UI.Text({
      text: '*若无法点击，请移步至「待确认操作」页面',
      style: 'labelSmall',
      color: String(c.onSurfaceVariant)
    })
  );

  return ctx.UI.Column({
    fillMaxWidth: true,
    spacing: 12,
    padding: { horizontal: 16, vertical: 16 }
  }, rootChildren);
}