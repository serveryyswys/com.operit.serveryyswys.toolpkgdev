// SPDX-FileCopyrightText: 2026 yyswys-yjyj
// SPDX-License-Identifier: GPL-3.0-or-later
//
// ToolPkg 主入口（manifest.main = dist/main.js）
//
// 注册四件事：
//   1) 三条 UI 路由：环境检查 / 基础配置
//   2) XML 渲染插件：<devtool_check>{"id":"..."}</devtool_check> → 危险操作确认框
//   3) 聊天输入菜单开关：「跳过危险操作确认」
//   4) 工具箱入口（toolbox UI module）
//
// 硬约束（来自 UIGallery 的 PITFALLS）：
//   - registerUiRoute 的 id 全包唯一，重复 = 整包装不上
//   - Screen 用 default export
//   - 页面里不画返回箭头，返回交给系统返回键

import EnvScreen from './ui/devtool_env/index.ui.js';
import SettingsScreen from './ui/devtool_settings/index.ui.js';
import CheckScreen from './ui/devtool_check/index.ui.js';
import ConfirmScreen from './ui/devtool_confirm/index.ui.js';
import HomeScreen from './ui/devtool_home/index.ui.js';
import LogsScreen from './ui/devtool_logs/index.ui.js';
import AboutScreen from './ui/devtool_about/index.ui.js';
import LicensesScreen from './ui/devtool_licenses/index.ui.js';
import { logInfo, logDebug, logError, logException } from './util/logger';

/** 安全地打对象（logger 未导出 logObject 时的兜底） */
function logObjectSafe(tag: string, label: string, obj: any): void {
  try {
    let s = '';
    try { s = JSON.stringify(obj); } catch (e) { s = String(obj); }
    logDebug(tag, label + ': ' + s);
  } catch (e) { /* 吞掉 */ }
}

/** 安全地打 warn */
function logWarnSafe(tag: string, msg: string): void {
  try {
    logDebug(tag, '[WARN] ' + msg);
  } catch (e) { /* 吞掉 */ }
}

const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';

/** 拼 route 字符串的唯一入口，避免一处手写一处拼装 */
function routeOf(moduleId: string): string {
  return 'toolpkg:' + PKG_ID + ':ui:' + moduleId;
}

/** 权限开关的 toggle id */
const TOGGLE_BYPASS = 'devtool_bypass_confirm';

/** 确认记录根目录 */
const PENDING_ROOT = '/storage/emulated/0/Download/Operit/cleanOnExit';

/** 从 XML 里抠出 JSON */
function parseXmlPayload(xmlContent: string, tag: string): any {
  try {
    const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
    const m = String(xmlContent || '').match(re);
    if (!m) return null;
    return JSON.parse(m[1].trim());
  } catch (e) {
    return null;
  }
}

/** 去行号前缀 */
function stripLinePrefixes(text: string): string {
  if (!text) return text;
  return String(text).replace(/^\s*\d+\|/gm, '');
}

/** 读一条确认记录 */
async function readPendingRecord(packageId: string, id: string): Promise<any | null> {
  try {
    const path = PENDING_ROOT + '/' + packageId + '/pending/' + id + '.json';
    const r: any = await (Tools as any).Files.read(path);
    const raw = r && r.content !== undefined ? stripLinePrefixes(String(r.content)) : '';
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * XML 渲染：<devtool_check>{"id":"...","packageId":"...","title":"...","hint":"..."}</devtool_check>
 *
 * packageId 可省略：省略时会扫 cleanOnExit 下所有项目目录找这个 id。
 * title / hint 可覆盖记录里的默认文案。
 */
export async function onCheckXmlRender(event: any): Promise<any> {
  logInfo('XmlRender', '===== onCheckXmlRender 被调用 =====');
  try {
    const payload = (event && event.eventPayload) || {};
    logDebug('XmlRender', 'eventName=' + String(event && event.eventName));
    logDebug('XmlRender', 'tagName=' + String(payload.tagName));
    logDebug('XmlRender', 'xmlContent 长度=' + String((payload.xmlContent || '').length));

    if (payload.tagName !== 'devtool_check') {
      logDebug('XmlRender', 'tagName 不匹配，返回 handled:false');
      return { handled: false };
    }
    const data = parseXmlPayload(payload.xmlContent, 'devtool_check');
    logObjectSafe('XmlRender', 'parsed payload', data);
    const id = data && String(data.id || '').trim();
    if (!id) {
      logWarnSafe('XmlRender', '缺少 id');
      return { handled: true, text: '（确认框缺少 id）' };
    }

  // packageId 优先用 XML 里给的，其次扫目录找
  let packageId = data && String(data.packageId || '').trim();
  if (!packageId) {
    try {
      const listing: any = await (Tools as any).Files.list(PENDING_ROOT);
      const entries = (listing && (listing.files || listing.entries || listing.children)) || [];
      for (let i = 0; i < entries.length; i++) {
        const name = String(entries[i].name || entries[i].fileName || '');
        if (!name) continue;
        const rec = await readPendingRecord(name, id);
        if (rec) { packageId = name; break; }
      }
    } catch (e) {
      // 目录不存在时留空
    }
  }

  if (!packageId) {
    return { handled: true, text: '（确认记录不存在或已过期：' + id + '）' };
  }

  const rec = await readPendingRecord(packageId, id);
  if (!rec) {
    return { handled: true, text: '（确认记录不存在或已过期：' + id + '）' };
  }

  // 聊天 id：用于确认后回调唤醒 AI
  let chatId = '';
  try {
    const fn: any = (globalThis as any).getChatId;
    if (typeof fn === 'function') chatId = String(fn() || '');
  } catch (e) {
    chatId = '';
  }
  logInfo('XmlRender', '准备返回 composeDsl: id=' + rec.id + ', pkg=' + packageId
    + ', action=' + String(rec.action) + ', screen=' + String(typeof CheckScreen));
  return {
    handled: true,
    composeDsl: {
      screen: CheckScreen,
      state: {
        _id: rec.id,
        _packageId: rec.packageId || packageId,
        _action: rec.action || '',
        _summary: rec.summary || '',
        _detail: rec.detail || '',
        _status: rec.status || 'pending',
        _title: String((data && data.title) || rec.title || '需要你批准'),
        _hint: String((data && data.hint) || rec.hint || '该操作涉及大量不可逆操作，请谨慎选择'),
        _chatId: chatId
      }
    }
  };
  } catch (e) {
    logException('XmlRender', e);
    return { handled: true, text: '（确认框渲染失败，详见日志）' };
  }
}

/** 读开关 */
function readBypass(): boolean {
  try {
    const v = (Tools as any).SoftwareSettings.readEnvironmentVariable('DEVTOL_CHECK_BYPASS');
    return String(v || '').toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
}

/** 输入菜单开关：跳过危险操作确认 */
export async function onInputMenuToggle(event: any): Promise<any[]> {
  const payload = (event && event.eventPayload) || {};
  const action = String(payload.action || '');
  const toggleId = String(payload.toggleId || '');

  if (action === 'toggle' && toggleId === TOGGLE_BYPASS) {
    const cur = readBypass();
    try {
      (Tools as any).SoftwareSettings.writeEnvironmentVariable('DEVTOL_CHECK_BYPASS', String(!cur));
    } catch (e) {
      // 写失败时保持原值
    }
  }

  return [
    {
      id: TOGGLE_BYPASS,
      title: '跳过危险操作确认',
      description: '开启后 摧毁 / 大目录删除 / 过旧回滚 将不再弹确认框，直接执行',
      icon: 'shield',
      isChecked: readBypass(),
      slot: 'general'
    }
  ];
}

export function registerToolPkg(): boolean {
  logInfo('Main', '===== registerToolPkg 开始 =====');
  try {
    // ---- UI 路由 ----
    // home 是唯一入口，其余三条都从 home navigate 过去
    logDebug('Main', '注册 UI 路由…');
    ToolPkg.registerUiRoute({
      id: 'devtool_home_route',
      route: routeOf('home'),
      screen: HomeScreen,
      title: { zh: 'ToolpkgDev', en: 'ToolpkgDev' }
    });
    logDebug('Main', '  ✓ home');
    ToolPkg.registerUiRoute({
      id: 'devtool_env_route',
      route: routeOf('env'),
      screen: EnvScreen,
      title: { zh: '环境检查', en: 'Environment Check' }
    });
    logDebug('Main', '  ✓ env');
    ToolPkg.registerUiRoute({
      id: 'devtool_settings_route',
      route: routeOf('settings'),
      screen: SettingsScreen,
      title: { zh: '基础配置', en: 'Settings' }
    });
    logDebug('Main', '  ✓ settings');
    // 兜底页：会话过长时聊天里的 XML 确认框可能点不动，用户从这里进来确认
    ToolPkg.registerUiRoute({
      id: 'devtool_confirm_route',
      route: routeOf('confirm'),
      screen: ConfirmScreen,
      title: { zh: '待确认操作', en: 'Pending Confirmations' }
    });
    logDebug('Main', '  ✓ confirm');
    ToolPkg.registerUiRoute({
      id: 'devtool_logs_route',
      route: routeOf('logs'),
      screen: LogsScreen,
      title: { zh: '运行日志', en: 'Runtime Logs' }
    });
    logDebug('Main', '  ✓ logs');
    // 关于：项目身份 + 版本 + 致谢入口
    ToolPkg.registerUiRoute({
      id: 'devtool_about_route',
      route: routeOf('about'),
      screen: AboutScreen,
      title: { zh: '关于', en: 'About' }
    });
    logDebug('Main', '  ✓ about');
    // 开源许可声明：只列本项目真实使用的依赖
    ToolPkg.registerUiRoute({
      id: 'devtool_licenses_route',
      route: routeOf('licenses'),
      screen: LicensesScreen,
      title: { zh: '开源许可', en: 'Licenses' }
    });
    logDebug('Main', '  ✓ licenses');

    // ---- 工具箱入口：指向 home，而不是直接掉进环境检查 ----
    ToolPkg.registerToolboxUiModule({
      id: 'devtool_toolbox',
      screen: HomeScreen,
      title: { zh: 'ToolpkgDev 开发工具', en: 'ToolpkgDev' }
    });
    logDebug('Main', '  ✓ toolbox');

    // ---- XML 渲染：危险操作确认框 ----
    logDebug('Main', '注册 XML 渲染插件 tag=devtool_check…');
    logDebug('Main', '  handler 类型: ' + typeof onCheckXmlRender);
    logDebug('Main', '  CheckScreen 类型: ' + typeof CheckScreen);
    ToolPkg.registerXmlRenderPlugin({
      id: 'devtool_check_render',
      tag: 'devtool_check',
      function: onCheckXmlRender
    });
    logInfo('Main', '  ✓ XML 渲染插件已注册 (devtool_check)');

    // ---- 聊天输入菜单开关 ----
    ToolPkg.registerInputMenuTogglePlugin({
      id: 'devtool_toggle_plugin',
      function: onInputMenuToggle
    });
    logInfo('Main', '  ✓ 输入菜单开关已注册');

    logInfo('Main', '===== registerToolPkg 完成，全部注册成功 =====');
  } catch (e) {
    logException('Main', e);
    return false;
  }
  return true;
}