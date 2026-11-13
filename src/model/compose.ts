// Compose DSL 类型桥接
//
// types/compose-dsl.d.ts 里只导出了 ComposeDslContext / ComposeColor 等，
// ComposeNode 是全局声明（declare global），不能直接 import。
// 这里统一出口，避免 ui/ 下每个文件都写 typeof 断言。

/** DSL 节点：用 any 表示，宿主侧会按对象结构消费，本地不需要精确类型 */
export type ComposeNode = any;

/** 复用官方类型声明 */
export type { ComposeDslContext, ComposeColor } from '../../../types/compose-dsl';

/** 屏幕函数签名：校验页 / 配置页都用它 */
export type ScreenFn = (ctx: any) => ComposeNode;