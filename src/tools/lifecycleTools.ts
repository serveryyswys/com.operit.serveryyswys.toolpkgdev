// 生命周期工具：destroy / archive / unarchive / confirm_status
//
// 三个工具都接危险守卫：
//   destroy    → 无条件要求确认（破坏力最大）
//   archive    → 默认要求确认（一次性改变项目可用性）
//   unarchive  → 不要求确认（恢复类操作）

import { ok, failFrom, requireString, optString, optBool } from './result';
import type { ToolResult } from '../model/constants';
import {
  previewDestroy,
  destroyProject,
  archiveProject,
  unarchiveProject,
  isArchived,
  readArchiveMarker
} from '../service/lifecycleService';
import { guardDangerous, checkConfirmed } from '../service/guardService';
import { readConfirm, updateConfirm } from '../service/confirmService';

/** 字节数转人类可读 */
function humanBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 整包摧毁：删项目目录 + storage.db + 注册表条目，不可恢复。
 *
 * 流程：
 *   1) 带 confirm_id 且已批准 → 执行
 *   2) 没带 confirm_id → 生成预览 + 创建 pending，返回 XML
 */
export async function destroy(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');

    // 1) 先看有没有带 confirm_id
    const conf = await checkConfirmed(params, readConfirm);
    if (conf.kind === 'rejected') {
      return ok({ cancelled: true }, '用户已驳回，未执行摧毁');
    }
    if (conf.kind === 'pending') {
      return ok(
        { pending: true, confirm_id: String(params.confirm_id || '') },
        '该确认请求仍在等待用户批准，请先让用户完成确认'
      );
    }
    if (conf.kind === 'missing') {
      return failFrom(
        new Error('确认记录不存在或已失效：' + String(params.confirm_id || '')),
        'destroy 失败'
      );
    }

    // 2) 有已批准的记录 → 执行
    if (conf.kind === 'execute' && String(params.confirm_id || '').trim()) {
      const r = await destroyProject(packageId);
      try {
        await updateConfirm(packageId, String(params.confirm_id), {
          status: 'done',
          result: '已删除 ' + r.removedPath
        });
      } catch (e) {
        // 状态回写失败不影响业务结果
      }
      return ok(r, '已摧毁项目：' + packageId + '（目录已删除' + (r.unregistered ? '，注册表已移除' : '') + '）');
    }

    // 3) 没带 confirm_id → 生成预览并走守卫
    const preview = await previewDestroy(packageId);
    if (!preview.hasMetadata) {
      return failFrom(new Error('项目不存在：' + packageId), 'destroy 失败');
    }

    const summary = '摧毁项目 ' + packageId + '（' + preview.fileCount + ' 个文件，'
      + humanBytes(preview.totalBytes) + '，' + preview.snapshotCount + ' 个版本快照）';
    const detail = [
      '项目目录：' + preview.projectPath,
      '虚拟文件：' + preview.fileCount + ' 个 / ' + humanBytes(preview.totalBytes),
      '版本快照：' + preview.snapshotCount + ' 个',
      '自动快照：' + preview.autoSnapCount + ' 条',
      'opt 落地区：' + preview.optFileCount + ' 个文件',
      '归档状态：' + (preview.archived ? '已归档' : '未归档'),
      '',
      '注意：此操作不可恢复——storage.db、.devtool、opt 与登记信息都会被删除。'
    ].join('\n');

    const g = await guardDangerous(params, 'destroy', summary, detail, true);
    if (g.needConfirm) {
      return ok(
        {
          need_confirm: true,
          confirm_id: g.confirmId,
          preview: preview,
          xml: '<devtool_check>' + JSON.stringify({ id: g.confirmId, packageId: packageId }) + '</devtool_check>'
        },
        g.message || '需要确认'
      );
    }

    // 跳过开关打开：直接执行
    const r = await destroyProject(packageId);
    return ok(r, '已摧毁项目：' + packageId + '（已跳过确认）');
  } catch (e) {
    return failFrom(e, 'destroy 失败');
  }
}

/** 归档 / 取消归档 */
export async function archive(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const mode = optString(params, 'mode') || 'archive';
    const note = optString(params, 'note');
    const force = optBool(params, 'force', false);

    // 取消归档：直接执行，不需要确认
    if (mode === 'unarchive') {
      const r = await unarchiveProject(packageId);
      return ok(
        r,
        r.markerRemoved ? '已取消归档：' + packageId : '项目本就没有归档：' + packageId
      );
    }
    if (mode !== 'archive') {
      throw new Error('mode 只能是 archive / unarchive，收到：' + mode);
    }

    // 归档：查状态 + 守卫
    if (isArchived(packageId)) {
      return ok(
        { alreadyArchived: true, marker: readArchiveMarker(packageId) },
        '项目已处于归档状态：' + packageId
      );
    }

    // force=true 时跳过确认（给脚本化场景用）
    if (!force) {
      const conf = await checkConfirmed(params, readConfirm);
      if (conf.kind === 'rejected') {
        return ok({ cancelled: true }, '用户已驳回，未执行归档');
      }
      if (conf.kind === 'pending') {
        return ok(
          { pending: true, confirm_id: String(params.confirm_id || '') },
          '该确认请求仍在等待用户批准'
        );
      }
      if (conf.kind === 'missing') {
        return failFrom(new Error('确认记录不存在：' + String(params.confirm_id || '')), 'archive 失败');
      }

      const hasApproved = conf.kind === 'execute' && String(params.confirm_id || '').trim();
      if (!hasApproved) {
        const summary = '归档项目 ' + packageId;
        const detail = [
          '归档只写一个标记文件，不动任何数据。',
          '归档后：读类工具仍可用，写类工具会拒绝执行。',
          note ? '归档说明：' + note : ''
        ].filter(function (x) { return !!x; }).join('\n');

        const g = await guardDangerous(params, 'archive', summary, detail, true);
        if (g.needConfirm) {
          return ok(
            {
              need_confirm: true,
              confirm_id: g.confirmId,
              xml: '<devtool_check>' + JSON.stringify({ id: g.confirmId, packageId: packageId }) + '</devtool_check>'
            },
            g.message || '需要确认'
          );
        }
      } else {
        // 更新记录为 done
        try {
          await updateConfirm(packageId, String(params.confirm_id), { status: 'done', result: '已归档' });
        } catch (e) { /* 忽略 */ }
      }
    }

    const r = await archiveProject(packageId, note);
    return ok(r, '已归档项目：' + packageId);
  } catch (e) {
    return failFrom(e, 'archive 失败');
  }
}
