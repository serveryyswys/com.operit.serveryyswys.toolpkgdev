// 编译 / 传输 / 辅助工具：tsc / tsc_check / upload / export / import / list_opt / purge
//                            以及 opm 集成（init/search/install/remove/license/changelog/build/verify/pack/version）

import { ok, fail, failFrom, requireString, optString, optBool, optNumber, optStringArray } from './result';
import type { ToolResult } from '../model/constants';
import * as tscService from '../service/tscService';
import * as transferService from '../service/transferService';
import * as autoSnapService from '../service/autoSnapService';
import { assertCapability } from '../service/capabilityService';

/** 执行 tsc 编译 */
export async function tsc(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    // 前置守卫：只有 TS 类型项目才能编译
    assertCapability(packageId, 'tsc');

    const r = await tscService.runTsc({
      packageId: packageId,
      extraArgs: optStringArray(params, 'extra_args'),
      timeoutMs: optNumber(params, 'timeout_ms')
    });
    // 编译失败必须走 fail 分支：
    //   - 之前无论 ok 与否都调 ok()，导致工具返回 success:true，
    //     AI 看到"成功"就不会去修代码，问题被吞掉。
    //   - 失败时把 tsc 的原始输出（含 error TSxxxx 行）完整带出来，
    //     否则 AI 拿不到出错位置，没法改。
    if (!r.ok) {
      return fail(
        '编译失败（exitCode ' + r.exitCode + '）：' + (r.output || '（tsc 无输出）'),
        {
          ok: false,
          exitCode: r.exitCode,
          output: r.output,
          workDir: r.workDir,
          outDir: r.outDir,
          written: r.written,
          durationMs: r.durationMs,
          cleaned: r.cleaned
        }
      );
    }
    return ok(
      r,
      '编译成功：产出 ' + r.written.length + ' 个文件，耗时 ' + r.durationMs + 'ms'
    );
  } catch (e) {
    return failFrom(e, 'tsc 失败');
  }
}

/** 检查 tsc 环境 */
export async function tscCheck(params: any): Promise<ToolResult> {
  try {
    const r = await tscService.checkTscAvailable();
    return ok(r, r.available ? ('tsc 可用，版本 ' + r.version) : ('tsc 不可用：' + r.output));
  } catch (e) {
    return failFrom(e, 'tsc_check 失败');
  }
}

/** 上传单个文件 */
export async function upload(params: any): Promise<ToolResult> {
  try {
    const r = await transferService.uploadFile({
      packageId: requireString(params, 'package_id', '插件包名'),
      localPath: requireString(params, 'local_path', '源文件绝对路径'),
      virtualPath: optString(params, 'virtual_path'),
      description: requireString(params, 'description', '本次上传的说明'),
      overwrite: optBool(params, 'overwrite', false)
    });
    return ok(r, '上传成功: ' + r.path + '（' + r.size + ' 字节' + (r.isBinary ? '，二进制' : '') + '）');
  } catch (e) {
    return failFrom(e, 'upload 失败');
  }
}

/** 上传整个目录 */
export async function uploadDir(params: any): Promise<ToolResult> {
  try {
    const r = await transferService.uploadDir({
      packageId: requireString(params, 'package_id', '插件包名'),
      localDir: requireString(params, 'local_dir', '源目录绝对路径'),
      virtualDir: optString(params, 'virtual_dir'),
      description: requireString(params, 'description', '本次上传的说明'),
      overwrite: optBool(params, 'overwrite', false)
    });
    return ok(r, '上传完成：成功 ' + r.uploaded.length + ' 个，跳过 ' + r.skipped.length + ' 个');
  } catch (e) {
    return failFrom(e, 'upload_dir 失败');
  }
}

/** 导出到 opt 物理落地区 */
export async function exportFiles(params: any): Promise<ToolResult> {
  try {
    const r = await transferService.exportToOpt({
      packageId: requireString(params, 'package_id', '插件包名'),
      virtualPath: optString(params, 'virtual_path'),
      targetDir: optString(params, 'target_dir'),
      overwrite: optBool(params, 'overwrite', false)
    });
    const msg = '导出完成：写入 ' + r.files.length + ' 个文件到 ' + r.physicalTarget
      + (r.skipped.length ? '；跳过 ' + r.skipped.length + ' 个（目标已存在）' : '');
    return ok(r, msg);
  } catch (e) {
    return failFrom(e, 'export 失败');
  }
}

/** 从 opt 导入回来 */
export async function importFiles(params: any): Promise<ToolResult> {
  try {
    const r = await transferService.importFromOpt({
      packageId: requireString(params, 'package_id', '插件包名'),
      physicalPath: requireString(params, 'physical_path', 'opt 下的相对路径或完整路径'),
      virtualDir: optString(params, 'virtual_dir'),
      description: requireString(params, 'description', '本次导入的说明'),
      overwrite: optBool(params, 'overwrite', false)
    });
    return ok(r, '导入完成：成功 ' + r.imported.length + ' 个，跳过 ' + r.skipped.length + ' 个');
  } catch (e) {
    return failFrom(e, 'import 失败');
  }
}

/** 列出 opt 目录 */
export async function listOpt(params: any): Promise<ToolResult> {
  try {
    const r = transferService.listOptDir(
      requireString(params, 'package_id', '插件包名'),
      optString(params, 'sub_path')
    );
    return ok({ total: r.length, entries: r }, '共 ' + r.length + ' 项');
  } catch (e) {
    return failFrom(e, 'list_opt 失败');
  }
}

/** 清空自动快照（危险） */
export async function purgeAutoSnap(params: any): Promise<ToolResult> {
  try {
    if (!optBool(params, 'confirm', false)) {
      throw new Error('清空自动快照不可逆，请传 confirm=true');
    }
    const r = await autoSnapService.purge(requireString(params, 'package_id', '插件包名'));
    return ok(r, '已清空 ' + r.removed + ' 条自动快照记录');
  } catch (e) {
    return failFrom(e, 'purge_autosnap 失败');
  }
}