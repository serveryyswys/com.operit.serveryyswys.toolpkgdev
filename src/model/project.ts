// 项目模型：项目元信息 + 注册表条目

/** init 时选定的项目类型 */
export type ProjectType = 'js' | 'ts' | 'toolpkg-js' | 'toolpkg-ts';

export const PROJECT_TYPES: ProjectType[] = ['js', 'ts', 'toolpkg-js', 'toolpkg-ts'];

/** 项目是 script 脚本还是 toolpkg 工程 */
export function isToolPkgType(t: ProjectType): boolean {
  return t === 'toolpkg-js' || t === 'toolpkg-ts';
}

/** 项目用 TS 编写还是 JS 编写 */
export function isTsType(t: ProjectType): boolean {
  return t === 'ts' || t === 'toolpkg-ts';
}

/** 项目内的 metadata.json 结构 */
export interface ProjectMetadata {
  /** 插件包名，也是项目目录名 */
  packageId: string;
  /** 项目类型 */
  type: ProjectType;
  /** 显示名 */
  displayName: string;
  /** 描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 许可证 SPDX 标识，UNLICENSED 表示不写 */
  license: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 最后修改时间 ISO 字符串 */
  updatedAt: string;
  /** 项目结构版本，方便后续迁移 */
  schemaVersion: number;
}

/** 注册表条目（存 registry.json） */
export interface RegistryEntry {
  packageId: string;
  type: ProjectType;
  /** 项目绝对路径 */
  path: string;
  createdAt: string;
  updatedAt: string;
}

/** 注册表文件结构 */
export interface RegistryFile {
  version: number;
  entries: RegistryEntry[];
}

/** 判断一个项目类型需要哪些模板文件 */
export interface TemplatePlan {
  /** 相对于项目虚拟根的文件路径列表 */
  files: string[];
}

/** 每种项目类型生成的模板文件（虚拟路径，不带前导斜杠） */
export const TEMPLATE_PLAN: { [t in ProjectType]: string[] } = {
  // 纯 script，JS 编写：只出一个脚本文件
  'js': ['{name}.js'],
  // 纯 script，TS 编写：源码 + 编译产物占位
  'ts': ['src/{name}.ts'],
  // toolpkg，JS 编写
  'toolpkg-js': ['manifest.json', 'dist/main.js'],
  // toolpkg，TS 编写
  'toolpkg-ts': ['manifest.json', 'tsconfig.json', 'src/main.ts']
};