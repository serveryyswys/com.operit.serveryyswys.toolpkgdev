// 四套项目模板：全部写死在代码里，init 时按类型取用
//
// 类型 -> 产出文件：
//   js         : {name}.js                                    纯脚本，JS
//   ts         : src/{name}.ts                                纯脚本，TS
//   toolpkg-js : manifest.json + dist/main.js + {name}.js     工具包，JS
//   toolpkg-ts : manifest.json + tsconfig.json + src/main.ts  工具包，TS

import type { ProjectType } from '../model/project';

export interface TemplateFile {
  /** 虚拟路径（相对 mydata 根，不带前导斜杠） */
  path: string;
  content: string;
}

export interface TemplateContext {
  /** 插件包名，例如 com.example.demo */
  packageId: string;
  /** 派生出的短名，用于文件名，例如 demo */
  shortName: string;
  displayName: string;
  description: string;
  author: string;
  license: string;
  year: number;
}

/** 从包名派生短名：取最后一段，去掉非法字符 */
export function deriveShortName(packageId: string): string {
  const parts = String(packageId).split('.');
  let last = parts[parts.length - 1] || packageId;
  last = last.replace(/[^A-Za-z0-9_-]/g, '');
  if (!last) last = 'plugin';
  return last;
}

/** 生成 LICENSE 的版权头（apache 系需要 NOTICE，这里统一走 SPDX 头） */
function spdxHeader(license: string, author: string, year: number, commentStyle: 'js' | 'none'): string {
  if (!license || license === 'UNLICENSED') return '';
  if (commentStyle === 'none') return '';
  return '// SPDX-FileCopyrightText: ' + year + ' ' + author + '\n' +
    '// SPDX-License-Identifier: ' + license + '\n';
}

/** 纯脚本 JS 模板 */
function jsScriptTemplate(ctx: TemplateContext): TemplateFile[] {
  const header = spdxHeader(ctx.license, ctx.author, ctx.year, 'js');
  return [{
    path: 'mydata/' + ctx.shortName + '.js',
    content: header +
      '// ' + ctx.displayName + '\n' +
      '// ' + ctx.description + '\n\n' +
      '// 沙盒脚本入口：工具通过 METADATA 注释块声明，运行时用 complete() 返回结果\n' +
      'function main(params) {\n' +
      '  return { success: true, message: \'hello from ' + ctx.shortName + '\', data: params || {} };\n' +
      '}\n\n' +
      'try {\n' +
      '  var __r = main(typeof params !== \'undefined\' ? params : {});\n' +
      '  complete(__r);\n' +
      '} catch (e) {\n' +
      '  complete({ success: false, message: String(e && e.message ? e.message : e) });\n' +
      '}\n'
  }];
}

/** 纯脚本 TS 模板 */
function tsScriptTemplate(ctx: TemplateContext): TemplateFile[] {
  const header = spdxHeader(ctx.license, ctx.author, ctx.year, 'js');
  return [{
    path: 'mydata/src/' + ctx.shortName + '.ts',
    content: header +
      '// ' + ctx.displayName + '\n' +
      '// ' + ctx.description + '\n\n' +
      'declare function complete(result: any): void;\n' +
      'declare const params: any;\n\n' +
      'interface Result {\n' +
      '  success: boolean;\n' +
      '  message: string;\n' +
      '  data?: any;\n' +
      '}\n\n' +
      'function main(input: any): Result {\n' +
      '  return { success: true, message: \'hello from ' + ctx.shortName + '\', data: input || {} };\n' +
      '}\n\n' +
      'try {\n' +
      '  const r = main(typeof params !== \'undefined\' ? params : {});\n' +
      '  complete(r);\n' +
      '} catch (e) {\n' +
      '  complete({ success: false, message: String(e && (e as Error).message ? (e as Error).message : e) });\n' +
      '}\n'
  }];
}

/** toolpkg manifest 模板 */
function toolpkgManifest(ctx: TemplateContext, mainFile: string, isTs: boolean): string {
  const obj: any = {
    schema_version: 1,
    toolpkg_id: ctx.packageId,
    version: '0.1.0',
    api_version: '1.0.1',
    requires: [],
    author: [ctx.author],
    main: mainFile,
    display_name: {
      zh: ctx.displayName,
      en: ctx.displayName
    },
    description: {
      zh: ctx.description,
      en: ctx.description
    },
    enabled_by_default: true,
    subpackages: [
      {
        id: ctx.shortName,
        entry: 'dist/packages/' + ctx.shortName + '.js',
        enabled_by_default: true,
        display_name: {
          zh: ctx.shortName + ' 工具',
          en: ctx.shortName
        },
        description: {
          zh: ctx.displayName + ' 提供的工具集。',
          en: 'Tools provided by ' + ctx.displayName + '.'
        }
      }
    ]
  };
  // 只有开源许可证才写 license 字段
  if (ctx.license && ctx.license !== 'UNLICENSED') {
    obj.license = ctx.license;
  }
  return JSON.stringify(obj, null, 2) + '\n';
}

/** toolpkg 的 tsconfig */
function toolpkgTsconfig(): string {
  const obj = {
    compilerOptions: {
      target: 'es2020',
      module: 'commonjs',
      lib: ['es2020'],
      moduleResolution: 'node',
      ignoreDeprecations: '6.0',
      strict: false,
      noImplicitAny: false,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      removeComments: false,
      outDir: 'dist',
      rootDir: 'src',
      typeRoots: ['../types'],
      types: []
    },
    include: ['src/**/*.ts', '../types/**/*.d.ts'],
    exclude: ['node_modules', 'dist']
  };
  return JSON.stringify(obj, null, 2) + '\n';
}

/** toolpkg JS 模板：入口 + 子包 */
function toolpkgJsTemplate(ctx: TemplateContext): TemplateFile[] {
  const header = spdxHeader(ctx.license, ctx.author, ctx.year, 'js');
  const mainEntry = 'dist/main.js';
  const subEntry = 'dist/packages/' + ctx.shortName + '.js';

  return [
    {
      path: 'mydata/manifest.json',
      content: toolpkgManifest(ctx, mainEntry, false)
    },
    {
      path: 'mydata/dist/main.js',
      content: header +
        '// ToolPkg 主入口：只做注册，不承担常驻逻辑\n' +
        'function registerToolPkg() {\n' +
        '  return true;\n' +
        '}\n\n' +
        'exports.registerToolPkg = registerToolPkg;\n'
    },
    {
      path: 'mydata/' + subEntry,
      content: header +
        '/*\n' +
        'METADATA\n' +
        '{\n' +
        '  "name": "' + ctx.shortName + '",\n' +
        '  "description": {\n' +
        '    "zh": "' + ctx.displayName + ' 工具集",\n' +
        '    "en": "' + ctx.displayName + ' tools"\n' +
        '  },\n' +
        '  "enabledByDefault": true,\n' +
        '  "env": [],\n' +
        '  "tools": [\n' +
        '    {\n' +
        '      "name": "hello",\n' +
        '      "description": {\n' +
        '        "zh": "示例工具：回显传入的名字",\n' +
        '        "en": "Example tool: echo the given name"\n' +
        '      },\n' +
        '      "parameters": [\n' +
        '        {\n' +
        '          "name": "name",\n' +
        '          "description": { "zh": "要回显的名字", "en": "Name to echo" },\n' +
        '          "type": "string",\n' +
        '          "required": false\n' +
        '        }\n' +
        '      ]\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '*/\n\n' +
        'function hello(params) {\n' +
        '  var name = params && params.name ? String(params.name) : \'world\';\n' +
        '  complete({ success: true, message: \'hello \' + name, data: { name: name } });\n' +
        '}\n\n' +
        'exports.hello = hello;\n'
    }
  ];
}

/** toolpkg TS 模板 */
function toolpkgTsTemplate(ctx: TemplateContext): TemplateFile[] {
  const header = spdxHeader(ctx.license, ctx.author, ctx.year, 'js');
  const mainEntry = 'dist/main.js';
  const subEntry = 'dist/packages/' + ctx.shortName + '.js';

  return [
    {
      path: 'mydata/manifest.json',
      content: toolpkgManifest(ctx, mainEntry, true)
    },
    {
      path: 'mydata/tsconfig.json',
      content: toolpkgTsconfig()
    },
    {
      path: 'mydata/src/main.ts',
      content: header +
        '// ToolPkg 主入口：只做注册，不承担常驻逻辑\n' +
        '// 用 export function 而不是 exports.xxx：TS 原生语法，编译后自动映射到 CommonJS exports\n' +
        'export function registerToolPkg(): boolean {\n' +
        '  return true;\n' +
        '}\n'
    },
    {
      path: 'mydata/src/packages/' + ctx.shortName + '.ts',
      content: header +
        '/*\n' +
        'METADATA\n' +
        '{\n' +
        '  "name": "' + ctx.shortName + '",\n' +
        '  "description": {\n' +
        '    "zh": "' + ctx.displayName + ' 工具集",\n' +
        '    "en": "' + ctx.displayName + ' tools"\n' +
        '  },\n' +
        '  "enabledByDefault": true,\n' +
        '  "env": [],\n' +
        '  "tools": [\n' +
        '    {\n' +
        '      "name": "hello",\n' +
        '      "description": {\n' +
        '        "zh": "示例工具：回显传入的名字",\n' +
        '        "en": "Example tool: echo the given name"\n' +
        '      },\n' +
        '      "parameters": [\n' +
        '        {\n' +
        '          "name": "name",\n' +
        '          "description": { "zh": "要回显的名字", "en": "Name to echo" },\n' +
        '          "type": "string",\n' +
        '          "required": false\n' +
        '        }\n' +
        '      ]\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '*/\n\n' +
        '// complete 由 ToolPkg 运行期注入\n' +
        'declare function complete(result: any): void;\n\n' +
        'interface HelloParams {\n' +
        '  name?: string;\n' +
        '}\n\n' +
        'export function hello(params: HelloParams): void {\n' +
        '  const name = params && params.name ? String(params.name) : \'world\';\n' +
        '  complete({ success: true, message: \'hello \' + name, data: { name: name } });\n' +
        '}\n'
    }
  ];
}

/** 按类型返回模板文件列表 */
export function buildTemplates(type: ProjectType, ctx: TemplateContext): TemplateFile[] {
  if (type === 'js') return jsScriptTemplate(ctx);
  if (type === 'ts') return tsScriptTemplate(ctx);
  if (type === 'toolpkg-js') return toolpkgJsTemplate(ctx);
  if (type === 'toolpkg-ts') return toolpkgTsTemplate(ctx);
  throw new Error('未知的项目类型: ' + type);
}