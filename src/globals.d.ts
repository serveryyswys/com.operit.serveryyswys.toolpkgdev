// ToolPkg 运行期全局声明补充
//
// 为什么需要这个文件：
//   - opm 打包时会把裸名 require 重写为归档内相对路径，ToolPkg 运行期确实有 require
//   - 但默认 types 里没有 node 类型，TS 会报 TS2591 "Cannot find name 'require'"
//   - 这里只补最小声明，不引入 @types/node（避免把 Node 全量类型拉进来污染沙盒 API）

declare function require(moduleName: string): any;

declare const process: any;
declare const Buffer: any;
declare const __dirname: string;
declare const __filename: string;

declare interface NodeModule {
  exports: any;
}
declare const module: NodeModule;
declare const exports: any;
