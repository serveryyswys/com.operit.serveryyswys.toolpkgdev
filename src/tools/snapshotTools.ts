// 快照工具：自动快照（history/show/revert/revert_to）与版本快照（stage/commit/diff/rollback/list）

import { ok, failFrom, requireString, optString, optBool, optNumber, optStringArray } from './result';
import type { ToolResult } from '../model/constants';
import * as autoSnapService from '../service/autoSnapService';
import * as snapshotService from '../service/snapshotService';

// ---- 自动快照 ----

/** 查变更流水 */
export async function history(params: any): Promise<ToolResult> {
  try {
    const r = await autoSnapService.history(requireString(params, 'package_id', '插件包名'), {
      path: optString(params, 'path'),
      limit: optNumber(params, 'limit'),
      offset: optNumber(params, 'offset')
    });
    return ok(r, '共 ' + r.total + ' 条变更记录，本次返回 ' + r.records.length + ' 条');
  } catch (e) {
    return failFrom(e, 'history 失败');
  }
}

/** 自动快照预览：紧凑列表，突出 id 与 description */
export async function historyPreview(params: any): Promise<ToolResult> {
  try {
    const r = await autoSnapService.preview(requireString(params, 'package_id', '插件包名'), {
      path: optString(params, 'path'),
      limit: optNumber(params, 'limit'),
      offset: optNumber(params, 'offset'),
      onlyActive: optBool(params, 'only_active', true)
    });
    const lines = r.items.map(function (it) { return it.summary; });
    return ok(
      Object.assign({}, r, { lines: lines }),
      '共 ' + r.total + ' 条自动快照，本次预览 ' + r.shown + ' 条'
    );
  } catch (e) {
    return failFrom(e, 'history_preview 失败');
  }
}

/** 手动触发一次剪枝 */
export async function autosnapPrune(params: any): Promise<ToolResult> {
  try {
    const r = await autoSnapService.pruneNow(requireString(params, 'package_id', '插件包名'));
    return ok(
      r,
      r.pruned > 0
        ? '已剪枝 ' + r.pruned + ' 条旧快照，当前保留 ' + r.remain + ' 条（上限 ' + r.limit + '）'
        : '无需剪枝，当前 ' + r.remain + ' 条，上限 ' + r.limit + ' 条'
    );
  } catch (e) {
    return failFrom(e, 'autosnap_prune 失败');
  }
}

/** 查看或修改自动快照保留上限 */
export async function autosnapRetention(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const limit = optNumber(params, 'limit');

    if (limit === undefined) {
      const cur = await autoSnapService.getRetentionLimit(packageId);
      return ok({ limit: cur }, '当前自动快照保留上限：' + cur + ' 条');
    }

    const r = await autoSnapService.setRetentionLimit(packageId, limit);
    return ok(
      r,
      '保留上限已设为 ' + r.limit + ' 条'
        + (r.pruned > 0 ? '，并立即剪枝 ' + r.pruned + ' 条旧快照' : '')
    );
  } catch (e) {
    return failFrom(e, 'autosnap_retention 失败');
  }
}

/** 查看某条记录的 diff */
export async function showRecord(params: any): Promise<ToolResult> {
  try {
    const id = optNumber(params, 'id');
    if (id === undefined) throw new Error('缺少必填参数 id');
    const r = await autoSnapService.showRecord(requireString(params, 'package_id', '插件包名'), id);
    return ok(r, '记录 #' + id + '：' + r.record.changeType + ' ' + r.record.path);
  } catch (e) {
    return failFrom(e, 'show_record 失败');
  }
}

/** 回滚单条记录 */
export async function revert(params: any): Promise<ToolResult> {
  try {
    const id = optNumber(params, 'id');
    if (id === undefined) throw new Error('缺少必填参数 id');
    const r = await autoSnapService.revertRecord(requireString(params, 'package_id', '插件包名'), id);
    return ok(r, '已回滚 #' + id + '：' + r.action + ' ' + r.path);
  } catch (e) {
    return failFrom(e, 'revert 失败');
  }
}

/** 回滚到某条记录之前 */
export async function revertTo(params: any): Promise<ToolResult> {
  try {
    const id = optNumber(params, 'from_id');
    if (id === undefined) throw new Error('缺少必填参数 from_id');
    if (!optBool(params, 'confirm', false)) {
      throw new Error('批量回滚不可逆，请传 confirm=true');
    }
    const r = await autoSnapService.revertToBefore(requireString(params, 'package_id', '插件包名'), id);
    return ok(r, '已回滚 ' + r.revertedCount + ' 条变更');
  } catch (e) {
    return failFrom(e, 'revert_to 失败');
  }
}

/** 时间线摘要 */
export async function timeline(params: any): Promise<ToolResult> {
  try {
    const r = await autoSnapService.timeline(
      requireString(params, 'package_id', '插件包名'),
      optNumber(params, 'limit')
    );
    return ok({ days: r }, '共 ' + r.length + ' 天有变更');
  } catch (e) {
    return failFrom(e, 'timeline 失败');
  }
}

// ---- 版本快照 ----

/** 暂存全部 / 暂存单条 / 标记删除 / 查看 / 清空 */
export async function stage(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const action = (optString(params, 'action') || 'add_all').toLowerCase();

    if (action === 'add_all') {
      const r = await snapshotService.stageAll(packageId);
      return ok(r, '已暂存 ' + r.staged + ' 个文件，标记删除 ' + r.removed + ' 个，跳过 ' + r.skipped + ' 个未变更');
    }
    if (action === 'add') {
      const r = await snapshotService.stagePath(packageId, requireString(params, 'path', '虚拟路径'));
      return ok(r, '已暂存: ' + r.path);
    }
    if (action === 'remove') {
      const r = await snapshotService.stageRemove(packageId, requireString(params, 'path', '虚拟路径'));
      return ok(r, '已标记删除: ' + r.path);
    }
    if (action === 'show') {
      const r = await snapshotService.showStaging(packageId);
      return ok(r, '暂存区共 ' + r.total + ' 项（待提交 ' + r.staged.length + '，待删除 ' + r.deleted.length + '）');
    }
    if (action === 'clear') {
      const r = await snapshotService.clearStaging(packageId);
      return ok(r, '已清空暂存区，移除 ' + r.cleared + ' 项');
    }
    throw new Error('action 必须是 add_all / add / remove / show / clear');
  } catch (e) {
    return failFrom(e, 'stage 失败');
  }
}

/** 提交版本快照 */
export async function commit(params: any): Promise<ToolResult> {
  try {
    const r = await snapshotService.commit(requireString(params, 'package_id', '插件包名'), {
      displayVersion: requireString(params, 'display_version', '显示版本号，例如 1.0.0'),
      description: optString(params, 'description'),
      author: optString(params, 'author'),
      step: optNumber(params, 'step')
    });
    return ok(r, '已提交版本 ' + r.node.displayVersion + '（序号 ' + r.node.versionId + '），'
      + '共 ' + r.fileCount + ' 个文件，应用 ' + r.stagedApplied + ' 项，删除 ' + r.deletedApplied + ' 项');
  } catch (e) {
    return failFrom(e, 'commit 失败');
  }
}

/** 列出历史版本 */
export async function historyNodes(params: any): Promise<ToolResult> {
  try {
    const r = await snapshotService.listNodes(
      requireString(params, 'package_id', '插件包名'),
      optNumber(params, 'page'),
      optNumber(params, 'limit')
    );
    return ok(r, '共 ' + r.total + ' 个版本，本页 ' + r.nodes.length + ' 个');
  } catch (e) {
    return failFrom(e, 'history_nodes 失败');
  }
}

/** 某版本的文件清单 */
export async function filesAt(params: any): Promise<ToolResult> {
  try {
    const r = await snapshotService.listNodeFiles(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'display_version', '显示版本号')
    );
    return ok(r, '版本 ' + r.node.displayVersion + ' 共 ' + r.files.length + ' 个文件');
  } catch (e) {
    return failFrom(e, 'files_at 失败');
  }
}

/** 读某版本的文件内容 */
export async function readAt(params: any): Promise<ToolResult> {
  try {
    const r = await snapshotService.readFileAtVersion(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'display_version', '显示版本号'),
      requireString(params, 'path', '虚拟路径')
    );
    return ok(r, '读取成功: ' + r.path);
  } catch (e) {
    return failFrom(e, 'read_at 失败');
  }
}

/** 与某版本对比（工作区） / 或两版本区间对比 */
export async function diff(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const right = optString(params, 'right_version');

    let r;
    if (right) {
      r = await snapshotService.intervalDiff(
        packageId,
        requireString(params, 'left_version', '左侧版本号'),
        right
      );
    } else {
      r = await snapshotService.diff(packageId, requireString(params, 'display_version', '显示版本号'));
    }
    return ok(r, '新增 ' + r.added + '，修改 ' + r.modified + '，删除 ' + r.deleted);
  } catch (e) {
    return failFrom(e, 'diff 失败');
  }
}

/** 回滚到某个版本 */
export async function rollback(params: any): Promise<ToolResult> {
  try {
    if (!optBool(params, 'confirm', false)) {
      throw new Error('回滚会重写虚拟文件系统并删除后续版本，请传 confirm=true');
    }
    const r = await snapshotService.rollback(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'display_version', '显示版本号'),
      { keepHistory: optBool(params, 'keep_history', false) }
    );

    let msg = '已回滚到 ' + r.node.displayVersion + '：恢复 ' + r.restored + ' 个文件，移除 ' + r.removed
      + ' 个，删除后续版本 ' + r.nodesDeleted + ' 个';
    if (r.conflicts.length) {
      msg += '；' + r.conflicts.length + ' 个文本冲突已用 git 风格标记合并';
    }
    if (r.binaryConflicts.length) {
      msg += '；' + r.binaryConflicts.length + ' 个二进制冲突已改名保留';
    }
    if (r.keptUntracked.length) {
      msg += '；保留 ' + r.keptUntracked.length + ' 个未跟踪文件';
    }
    if (r.conflicts.length || r.binaryConflicts.length) {
      msg += '。请检查冲突文件后再提交';
    }
    return ok(r, msg);
  } catch (e) {
    return failFrom(e, 'rollback 失败');
  }
}

/** 拉取历史版本到物理目录 */
export async function pull(params: any): Promise<ToolResult> {
  try {
    const r = await snapshotService.pullFromHistory(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'display_version', '显示版本号'),
      requireString(params, 'output_path', '输出目录绝对路径')
    );
    return ok(r, '已拉取 ' + r.written.length + ' 个文件到 ' + r.outputPath);
  } catch (e) {
    return failFrom(e, 'pull 失败');
  }
}