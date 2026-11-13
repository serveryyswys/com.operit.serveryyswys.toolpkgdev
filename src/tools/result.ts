// 工具层统一结果包装与参数校验

import type { ToolResult } from '../model/constants';

export function ok<T>(data: T, message?: string): ToolResult<T> {
  return {
    success: true,
    message: message || 'ok',
    data: data
  };
}

export function fail(message: string, data?: any): ToolResult {
  return {
    success: false,
    message: message,
    data: data
  };
}

/** 从异常转标准失败结果 */
export function failFrom(e: any, prefix?: string): ToolResult {
  const msg = e && e.message ? String(e.message) : String(e);
  return fail((prefix ? prefix + ': ' : '') + msg);
}

/** 必填字符串参数 */
export function requireString(params: any, key: string, label?: string): string {
  const v = params ? params[key] : undefined;
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error('缺少必填参数 ' + key + (label ? '（' + label + '）' : ''));
  }
  return String(v).trim();
}

/** 可选字符串参数 */
export function optString(params: any, key: string): string | undefined {
  const v = params ? params[key] : undefined;
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.trim() === '' ? undefined : s;
}

/** 布尔参数，兼容 "true"/"1"/true */
export function optBool(params: any, key: string, def?: boolean): boolean | undefined {
  const v = params ? params[key] : undefined;
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return def;
}

/** 数字参数 */
export function optNumber(params: any, key: string, def?: number): number | undefined {
  const v = params ? params[key] : undefined;
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return n;
}

/** 数组参数，兼容 JSON 字符串、逗号分隔 */
export function optStringArray(params: any, key: string): string[] | undefined {
  const v = params ? params[key] : undefined;
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(function (x) { return String(x); });
  const s = String(v).trim();
  if (s.charAt(0) === '[') {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(function (x) { return String(x); });
    } catch (e) { /* 落到逗号分隔 */ }
  }
  return s.split(/[,\n]/).map(function (x) { return x.trim(); }).filter(function (x) { return !!x; });
}