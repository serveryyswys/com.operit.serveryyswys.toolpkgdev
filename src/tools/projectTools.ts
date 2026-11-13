// 项目与文件工具：init / init_questionnaire / status / list_projects
//                     read / write / delete / apply_file / grep / sed / list

import { ok, failFrom, requireString, optString, optBool, optNumber, optStringArray } from './result';
import type { ToolResult } from '../model/constants';
import * as projectService from '../service/projectService';
import * as vfsService from '../service/vfsService';
import * as searchService from '../service/searchService';
import { capabilityMatrix } from '../service/capabilityService';
import { LICENSE_CHOICES } from '../model/constants';
import { PROJECT_TYPES } from '../model/project';

/** init：直接按参数初始化项目 */
export async function init(params: any): Promise<ToolResult> {
  try {
    const r = await projectService.initProject({
      packageId: requireString(params, 'package_id', '插件包名，例如 com.example.demo'),
      type: requireString(params, 'type', 'js / ts / toolpkg-js / toolpkg-ts') as any,
      displayName: optString(params, 'display_name'),
      description: optString(params, 'description'),
      author: optString(params, 'author'),
      license: optString(params, 'license'),
      force: optBool(params, 'force', false)
    });
    const msg = '项目已初始化: ' + r.packageId + '（' + r.type + '），共 ' + r.createdFiles.length + ' 个模板文件'
      + (r.warnings.length ? '；警告 ' + r.warnings.length + ' 条' : '');
    return ok(r, msg);
  } catch (e) {
    return failFrom(e, 'init 失败');
  }
}

/** init_questionnaire：生成问卷 JSON，让用户在 UI 里决定项目参数 */
export async function initQuestionnaire(params: any): Promise<ToolResult> {
  try {
    const questions: any[] = [
      {
        id: 'package_id',
        type: 'text',
        question: '插件包名（也是项目目录名）',
        subtitle: '只能包含字母、数字、点、下划线、连字符，至少 2 个字符，例如 com.example.demo',
        required: true
      },
      {
        id: 'type',
        type: 'single',
        question: '项目类型',
        subtitle: 'js/ts 是普通脚本；toolpkg-js/toolpkg-ts 是完整工具包工程',
        options: [
          'js —— 纯脚本，JS 编写',
          'ts —— 纯脚本，TS 编写',
          'toolpkg-js —— 工具包工程，JS 编写',
          'toolpkg-ts —— 工具包工程，TS 编写'
        ],
        required: true
      },
      {
        id: 'display_name',
        type: 'text',
        question: '显示名',
        subtitle: '给用户看的插件名称',
        required: false
      },
      {
        id: 'description',
        type: 'textarea',
        question: '插件描述',
        subtitle: '一句话说明这个插件做什么',
        required: false
      },
      {
        id: 'author',
        type: 'text',
        question: '作者名',
        subtitle: '会写进 manifest 与版权头',
        required: false
      },
      {
        id: 'license',
        type: 'single',
        question: '开源许可证',
        subtitle: '会下载官方全文写入 LICENSE，并写进 manifest 的 license 字段',
        options: LICENSE_CHOICES.map(function (c) { return c.label + ' [' + c.spdx + ']'; }),
        required: true
      },
      {
        id: 'force',
        type: 'single',
        question: '项目已存在时怎么办',
        subtitle: '同名项目已存在时的处理方式',
        options: ['保留原有，不覆盖', '强制覆盖重建'],
        required: true
      }
    ];

    const questionnaire = {
      title: 'ToolpkgDev 项目初始化',
      questions: questions
    };

    return ok({
      questionnaire: questionnaire,
      xml: '<questionnaire>' + JSON.stringify(questionnaire) + '</questionnaire>',
      hint: '把 xml 字段的内容原样输出即可让用户填写；用户提交后按答案调用 init 工具。'
    }, '已生成初始化问卷，把 xml 输出给用户即可');
  } catch (e) {
    return failFrom(e, 'init_questionnaire 失败');
  }
}

/** 项目状态 */
export async function status(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const r = await projectService.projectStatus(packageId);
    if (!r.meta && !r.registered) {
      return ok(r, '项目不存在或未注册: ' + packageId);
    }
    return ok(r, '项目状态已读取: ' + packageId);
  } catch (e) {
    return failFrom(e, 'status 失败');
  }
}

/** 查看项目能力矩阵 */
export async function capabilities(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const m = capabilityMatrix(packageId);
    if (!m.type) {
      return ok(m, '项目不存在或缺少 metadata.json: ' + packageId);
    }
    const tscState = m.tsc.allowed ? '可用' : '不可用';
    const opmState = m.opm.allowed ? '可用' : '不可用';
    return ok(
      m,
      '项目类型 ' + m.type + '：tsc ' + tscState + '，opm ' + opmState
    );
  } catch (e) {
    return failFrom(e, 'capabilities 失败');
  }
}

/** 读取 / 修改项目 metadata */
export async function metadata(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');

    // 包名 / 项目名修改是硬性禁止，优先拦截（不能落到查询分支）
    if (params.new_package_id !== undefined || params.rename !== undefined ||
        params.packageId !== undefined || params.name !== undefined) {
      throw new Error('包名 / 项目名不可修改：它与项目目录路径绑定。如需改名请新建项目后迁移内容。');
    }

    // 无任何可改字段时，视为查询
    const hasPatch =
      params.type !== undefined ||
      params.display_name !== undefined ||
      params.description !== undefined ||
      params.author !== undefined ||
      params.license !== undefined;

    if (!hasPatch) {
      const meta = projectService.readMetadata(packageId);
      return ok(
        { meta: meta, editable: ['type', 'displayName', 'description', 'author', 'license'] },
        '项目 ' + meta.packageId + '：' + meta.displayName + '（' + meta.type + '）'
      );
    }

    const patch: projectService.MetadataPatch = {
      type: params.type,
      displayName: params.display_name,
      description: params.description,
      author: params.author,
      license: params.license
    };

    const r = projectService.updateMetadata(packageId, patch);

    let msg = r.changed.length
      ? '已更新字段：' + r.changed.join('、')
      : '没有任何字段发生变化';
    if (r.unchanged.length) {
      msg += '；' + r.unchanged.length + ' 个字段值未变';
    }
    if (r.ignored.length) {
      msg += '；忽略未知字段：' + r.ignored.join('、');
    }
    return ok(r, msg);
  } catch (e) {
    return failFrom(e, 'metadata 失败');
  }
}

/** 列出全部项目 */
export async function listProjects(params: any): Promise<ToolResult> {
  try {
    const entries = projectService.listProjects();
    return ok({
      total: entries.length,
      projects: entries
    }, '共有 ' + entries.length + ' 个项目');
  } catch (e) {
    return failFrom(e, 'list_projects 失败');
  }
}

/** 读文件 */
export async function read(params: any): Promise<ToolResult> {
  try {
    const r = await vfsService.readFile(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'path', '虚拟路径，例如 /mydata/src/main.ts'),
      {
        offset: optNumber(params, 'offset'),
        limit: optNumber(params, 'limit')
      }
    );
    return ok(r, '读取成功: ' + r.path + '（' + r.size + ' 字节）');
  } catch (e) {
    return failFrom(e, 'read 失败');
  }
}

/** 写文件 */
export async function write(params: any): Promise<ToolResult> {
  try {
    const packageId = requireString(params, 'package_id', '插件包名');
    const path = requireString(params, 'path', '虚拟路径');
    const description = requireString(params, 'description', '本次写入的说明');

    const binaryB64 = optString(params, 'content_base64');
    const isBinary = binaryB64 !== undefined ? 1 : 0;
    const content = isBinary === 1 ? binaryB64! : (typeof params.content === 'string' ? params.content : '');

    if (isBinary === 0 && (params.content === undefined || params.content === null)) {
      throw new Error('缺少内容参数 content（文本）或 content_base64（二进制）');
    }

    const r = await vfsService.writeFile(packageId, path, content, isBinary, {
      tool: 'write',
      description: description
    });
    return ok(r, (r.isNew ? '创建' : '更新') + '成功: ' + r.path + '（' + r.size + ' 字节）');
  } catch (e) {
    return failFrom(e, 'write 失败');
  }
}

/** 删除文件或目录 */
export async function del(params: any): Promise<ToolResult> {
  try {
    const r = await vfsService.deleteEntry(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'path', '虚拟路径'),
      {
        tool: 'delete',
        description: requireString(params, 'description', '本次删除的说明'),
        recursive: optBool(params, 'recursive', false)
      }
    );
    return ok(r, '删除成功，共移除 ' + r.deletedFiles.length + ' 个文件');
  } catch (e) {
    return failFrom(e, 'delete 失败');
  }
}

/** 片段替换（补丁式） */
export async function applyFile(params: any): Promise<ToolResult> {
  try {
    const r = await vfsService.applyPatch(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'path', '虚拟路径'),
      requireString(params, 'old', '要被替换的原文片段'),
      typeof params.new === 'string' ? params.new : '',
      {
        tool: 'apply_file',
        description: requireString(params, 'description', '本次修改的说明'),
        occurrence: optNumber(params, 'occurrence')
      }
    );
    return ok(r, '已替换 ' + r.replaced + ' 处: ' + r.path);
  } catch (e) {
    return failFrom(e, 'apply_file 失败');
  }
}

/** 正则搜索 */
export async function grep(params: any): Promise<ToolResult> {
  try {
    const r = await searchService.grep(requireString(params, 'package_id', '插件包名'), {
      pattern: requireString(params, 'pattern', '搜索模式'),
      fixed: optBool(params, 'fixed', false),
      ignoreCase: optBool(params, 'ignore_case', false),
      paths: optStringArray(params, 'paths'),
      include: optStringArray(params, 'include'),
      exclude: optStringArray(params, 'exclude'),
      maxResults: optNumber(params, 'max_results'),
      maxPerLine: optNumber(params, 'max_per_line')
    });
    return ok(r, '匹配 ' + r.totalMatches + ' 处，涉及 ' + r.filesMatched + ' 个文件'
      + (r.truncated ? '（已截断）' : ''));
  } catch (e) {
    return failFrom(e, 'grep 失败');
  }
}

/** 批量正则替换（preview / apply） */
export async function sed(params: any): Promise<ToolResult> {
  try {
    const action = (optString(params, 'action') || 'preview').toLowerCase();
    if (action !== 'preview' && action !== 'apply') {
      throw new Error('action 只能是 preview 或 apply');
    }
    const r = await searchService.sed(requireString(params, 'package_id', '插件包名'), {
      find: requireString(params, 'find', '要查找的内容'),
      replace: typeof params.replace === 'string' ? params.replace : '',
      fixed: optBool(params, 'fixed', false),
      ignoreCase: optBool(params, 'ignore_case', false),
      global: optBool(params, 'global', false),
      paths: optStringArray(params, 'paths') || [],
      include: optStringArray(params, 'include'),
      action: action as any,
      description: optString(params, 'description')
    });
    const head = r.action === 'preview' ? '预览：' : '已应用：';
    return ok(r, head + '影响 ' + r.filesChanged + ' 个文件，共 ' + r.totalReplacements + ' 处替换');
  } catch (e) {
    return failFrom(e, 'sed 失败');
  }
}

/** 列目录 */
export async function list(params: any): Promise<ToolResult> {
  try {
    const r = await vfsService.listDir(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'path', '虚拟路径'),
      optBool(params, 'recursive', false)
    );
    return ok({ path: params.path, total: r.length, entries: r }, '共 ' + r.length + ' 项');
  } catch (e) {
    return failFrom(e, 'list 失败');
  }
}

/** 文件元信息 */
export async function stat(params: any): Promise<ToolResult> {
  try {
    const r = await vfsService.statFile(
      requireString(params, 'package_id', '插件包名'),
      requireString(params, 'path', '虚拟路径')
    );
    return ok(r, r.exists ? ('存在：' + r.path + (r.isDirectory ? '（目录）' : '（' + r.size + ' 字节）')) : '不存在: ' + r.path);
  } catch (e) {
    return failFrom(e, 'stat 失败');
  }
}