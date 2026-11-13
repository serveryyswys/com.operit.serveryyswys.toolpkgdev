// 权限确认模型：不可逆操作前的询问制记录
//
// 设计来源：对齐 toolpkg_market 的 pending 机制，但语义更通用：
//   - 任何「大范围/不可逆」操作都可以托管给这套记录
//   - 记录落在 cleanOnExit/<pkg>/pending/*.json，和项目 db 解耦
//   - 状态流转 pending -> approved / rejected -> done / failed

/** 确认记录的状态 */
export type ConfirmStatus = 'pending' | 'approved' | 'rejected' | 'done' | 'failed';

/** 触发确认的危险动作类型 */
export type DangerousAction =
  | 'destroy'        // 整包摧毁
  | 'archive'        // 整包归档 / 取消归档
  | 'delete_dir'     // 删除目录且超过阈值
  | 'rollback_old'   // 回滚到过旧版本
  | 'revert_to';     // 批量回滚

/** 一条待确认 / 已确认记录 */
export interface ConfirmRecord {
  /** 记录 id，形如 c + base36 时间 + 随机后缀 */
  id: string;
  /** 危险动作类型 */
  action: DangerousAction;
  /** 面向用户的一句话摘要（动作 + 目标） */
  summary: string;
  /** 影响明细：用户点开能看到后果 */
  detail: string;
  /** 本次操作绑定的项目 */
  packageId: string;
  /** 原始工具参数（用户确认后按这份参数执行） */
  payload: any;
  status: ConfirmStatus;
  createdAt: string;
  updatedAt?: string;
  /** status=done 时的结果摘要 */
  result?: string;
  /** status=failed 时的错误信息 */
  error?: string;
}

/** 生成确认记录时的入参（status / createdAt 由服务层补） */
export interface ConfirmDraft {
  action: DangerousAction;
  summary: string;
  detail: string;
  packageId: string;
  payload: any;
}

/** 权限总开关状态（聊天控制栏里可切） */
export interface PermissionState {
  /** true = 跳过确认直接执行；false = 询问制（默认） */
  bypassConfirm: boolean;
}
