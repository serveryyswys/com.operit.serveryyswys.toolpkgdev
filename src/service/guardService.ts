// 危险操作守卫：统一决定「直接执行」还是「要求确认」
//
// 三档策略：
//   1) 跳过开关打开 → 直接执行
//   2) 未超阈值 → 直接执行
//   3) 超阈值 / 天然危险（destroy） → 创建 pending 记录，返回 confirm_id + XML 提示
//
// 返回结构让工具层可以直接拼消息，不用重复写文案。

import type { ToolResult } from '../model/constants';
import type { ConfirmDraft, DangerousAction } from '../model/confirm';
import { createConfirm, isBypassEnabled } from './confirmService';
import { readSettings } from './settingsService';

/** 守卫判定的结果 */
export interface GuardDecision {
  /** true = 需要确认（已创建 pending 记录） */
  needConfirm: boolean;
  /** 需要确认时的记录 id */
  confirmId?: string;
  /** 需要确认时该返回给调用方的提示文本（含 XML） */
  message?: string;
  /** 需要确认时的完整记录（供工具层透传） */
  record?: any;
}

/** 拼给 AI 看的确认提示（含 XML 标签） */
function buildConfirmMessage(
  id: string,
  packageId: string,
  actionLabel: string,
  summary: string,
  title?: string,
  hint?: string
): string {
  const xmlObj: any = { id: id, packageId: packageId };
  if (title) xmlObj.title = title;
  if (hint) xmlObj.hint = hint;
  const xml = '<devtool_check>' + JSON.stringify(xmlObj) + '</devtool_check>';

  return '[需要确认] ' + actionLabel + '（' + summary + '）\n'
    + '已生成确认请求 #' + id + '。\n'
    + '请输出下面这一行渲染确认框，等待用户批准：\n'
    + xml + '\n'
    + '用户批准后，请再次调用本工具并传 confirm_id=' + id + ' 以执行。\n'
    + '（若聊天里的确认框点不动，可让用户打开「待确认操作」页面完成确认）';
}

/** 动作 → 中文名 */
function labelOf(action: DangerousAction): string {
  if (action === 'destroy') return '整包摧毁';
  if (action === 'archive') return '整包归档';
  if (action === 'delete_dir') return '删除目录';
  if (action === 'rollback_old') return '回滚到过旧版本';
  if (action === 'revert_to') return '批量回滚';
  return action;
}

/**
 * 守卫入口：判断某个危险动作要不要确认。
 *
 * @param params 工具入参（用于读 confirm_id / package_id）
 * @param action 动作类型
 * @param summary 一句话摘要
 * @param detail 影响明细
 * @param forceConfirm 是否无条件要求确认（destroy / archive 这类）
 */
export async function guardDangerous(
  params: any,
  action: DangerousAction,
  summary: string,
  detail: string,
  forceConfirm: boolean
): Promise<GuardDecision> {
  const packageId = String((params && params.package_id) || '');

  // 1) 跳过开关：直接执行
  if (isBypassEnabled()) {
    return { needConfirm: false };
  }

  // 2) 非强制且不需要确认
  if (!forceConfirm) {
    return { needConfirm: false };
  }

  // 3) 读配置里的默认文案，创建 pending
  let title = '';
  let hint = '';
  try {
    const s = await readSettings('com.operit.serveryyswys.toolpkgdev');
    title = s.confirmTitle || '';
    hint = s.confirmHint || '';
  } catch (e) {
    // 读配置失败就用界面里的默认值
  }

  const draft: ConfirmDraft = {
    action: action,
    summary: summary,
    detail: detail,
    packageId: packageId,
    payload: {
      tool: 'devtool',
      action: action,
      params: params
    }
  };

  const rec = await createConfirm(draft);
  return {
    needConfirm: true,
    confirmId: rec.id,
    record: rec,
    message: buildConfirmMessage(rec.id, packageId, labelOf(action), summary, title, hint)
  };
}

/**
 * 检查调用方是否带着「已批准的 confirm_id」。
 *
 * 返回：
 *   - { kind: 'execute' }  可以执行
 *   - { kind: 'pending' }  记录还没被用户处理
 *   - { kind: 'rejected' } 用户驳回
 *   - { kind: 'missing' }  记录不存在 / 不属于该项目
 */
export async function checkConfirmed(
  params: any,
  readConfirmFn: (packageId: string, id: string) => Promise<any>
): Promise<{ kind: 'execute' | 'pending' | 'rejected' | 'missing'; record?: any }> {
  const confirmId = String((params && params.confirm_id) || '').trim();
  if (!confirmId) return { kind: 'execute' };
  const packageId = String((params && params.package_id) || '');
  const rec = await readConfirmFn(packageId, confirmId);
  if (!rec) return { kind: 'missing' };
  if (rec.status === 'approved') return { kind: 'execute', record: rec };
  if (rec.status === 'rejected') return { kind: 'rejected', record: rec };
  return { kind: 'pending', record: rec };
}