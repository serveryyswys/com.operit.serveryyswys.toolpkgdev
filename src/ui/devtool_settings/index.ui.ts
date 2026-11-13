// 基础配置页（devtool_settings）
//
// 三块内容：
//   1) 权限总开关：跳过确认（对应聊天控制栏的 toggle，两处同源）
//   2) 危险阈值：删除目录文件数、回滚版本跨度
//   3) 其他：依赖提取上限、自动快照保留、确认框默认文案
//
// 关键约束：
//   - 输入用 TextField，没有 OutlinedTextField
//   - 没有 Slider，数字用 − 值 + 手搭
//   - 保存后要给出反馈（ctx.showToast）

import type { ComposeNode } from '../../model/compose';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../../service/settingsService';
import type { DevtoolSettings } from '../../service/settingsService';
import { isBypassEnabled, setBypassEnabled } from '../../service/confirmService';

import { DEV_PACKAGE_ROOT } from '../../model/constants';

const PKG_ID = 'com.operit.serveryyswys.toolpkgdev';

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  // 状态：整份配置用 JSON 字符串存，state 只认基本类型
  const cfgState = ctx.useState('set_cfg', '');
  const bypassState = ctx.useState('set_bypass', false);
  const busyState = ctx.useState('set_busy', false);
  // 是否已经从磁盘读到过真实配置（onLoad 可能不跑，所以要显式标记）
  const loadedState = ctx.useState('set_loaded', false);

  const cfgRaw = String(cfgState[0] || '');
  const bypass = !!bypassState[0];
  const busy = !!busyState[0];
  const loaded = !!loadedState[0];

  let cfg: DevtoolSettings = DEFAULT_SETTINGS;
  if (cfgRaw) {
    try { cfg = JSON.parse(cfgRaw); } catch (e) { cfg = DEFAULT_SETTINGS; }
  }

  /** 首次加载：读配置 + 读开关 */
  async function loadAll(): Promise<void> {
    try {
      const s = await readSettings(PKG_ID);
      cfgState[1](JSON.stringify(s));
      bypassState[1](isBypassEnabled());
      loadedState[1](true);
    } catch (e) {
      // 读失败用默认值
      cfgState[1](JSON.stringify(DEFAULT_SETTINGS));
      bypassState[1](false);
      loadedState[1](false);
    }
  }

  /** 保存配置 */
  async function save(patch: Partial<DevtoolSettings>): Promise<void> {
    if (busy) return;
    // 同步阶段先点亮 busy（await 之后的 setState 不触发重绘）
    busyState[1](true);

    let next: DevtoolSettings | null = null;
    let errMsg = '';
    try {
      next = await writeSettings(PKG_ID, patch);
    } catch (e) {
      errMsg = String((e as any).message || e);
    }

    // 收尾
    if (next) cfgState[1](JSON.stringify(next));
    busyState[1](false);
    try {
      ctx.showToast(next ? '已保存' : '保存失败：' + errMsg);
    } catch (e) { /* toast 失败不影响 */ }
  }

  /** 切换跳过确认 */
  async function toggleBypass(): Promise<void> {
    const next = !bypass;
    try {
      setBypassEnabled(next);
      bypassState[1](next);
      ctx.showToast(next ? '已关闭确认（危险）' : '已开启确认');
    } catch (e) {
      ctx.showToast('切换失败：' + String((e as any).message || e));
    }
  }

  /** 恢复默认 */
  async function resetAll(): Promise<void> {
    if (busy) return;
    // 同步阶段点亮 busy
    busyState[1](true);

    let next: DevtoolSettings | null = null;
    let errMsg = '';
    try {
      next = await writeSettings(PKG_ID, Object.assign({}, DEFAULT_SETTINGS));
    } catch (e) {
      errMsg = String((e as any).message || e);
    }

    if (next) cfgState[1](JSON.stringify(next));
    busyState[1](false);
    try {
      ctx.showToast(next ? '已恢复默认配置' : '恢复失败：' + errMsg);
    } catch (e) { /* toast 失败不影响 */ }
  }

  // ---- 顶栏（无 TopAppBar，Row 手搭）----
  const topBar = ctx.UI.Row({
    fillMaxWidth: true,
    height: 54,
    verticalAlignment: 'center',
    background: String(c.surface),
    paddingStart: 16,
    paddingEnd: 12,
    modifier: ctx.Modifier.statusBarsPadding()
  }, [
    ctx.UI.Column({ weight: 1, spacing: 0 }, [
      ctx.UI.Text({
        text: '基础配置',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: loaded ? '确认阈值 / 依赖上限 / 自动快照保留' : '尚未读取磁盘配置，点右上角刷新',
        style: 'labelSmall',
        color: String(c.onSurfaceVariant)
      })
    ]),
    ctx.UI.Box({
      width: 36,
      height: 36,
      contentAlignment: 'center',
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => { await loadAll(); })
    }, [ctx.UI.Icon({ name: 'search', size: 18, tint: String(c.onSurfaceVariant) })])
  ]);

  /** 一行：标题 + 子说明 + 右侧控件 */
  function rowItem(title: string, subtitle: string, control: ComposeNode, key: string): ComposeNode {
    return ctx.UI.Card({ fillMaxWidth: true, key: key, containerColor: String(c.surfaceVariant) }, [
      ctx.UI.Row({
        fillMaxWidth: true,
        padding: { horizontal: 14, vertical: 12 },
        spacing: 10,
        verticalAlignment: 'center'
      }, [
        ctx.UI.Column({ weight: 1, spacing: 2 }, [
          ctx.UI.Text({ text: title, style: 'bodyMedium', fontWeight: 'bold', color: String(c.onSurface) }),
          ctx.UI.Text({ text: subtitle, style: 'labelSmall', color: String(c.onSurfaceVariant) })
        ]),
        control
      ])
    ]);
  }

  /** 数字步进器：− 值 +（没有 Slider） */
  function stepper(
    value: number,
    onChange: (v: number) => void,
    step: number,
    min: number,
    keyPrefix: string
  ): ComposeNode {
    const dec = () => {
      const v = Math.max(min, Math.floor(value - step));
      if (v !== value) onChange(v);
    };
    const inc = () => {
      onChange(Math.floor(value + step));
    };
    const circleBtn = (label: string, onTap: () => void, k: string): ComposeNode =>
      ctx.UI.Box({
        key: k,
        width: 32,
        height: 32,
        contentAlignment: 'center',
        background: String(c.primaryContainer),
        modifier: ctx.Modifier
          .clip({ cornerRadius: 16 })
          .clickable(onTap)
      }, [
        ctx.UI.Text({ text: label, style: 'titleMedium', fontWeight: 'bold', color: String(c.onPrimaryContainer) })
      ]);

    return ctx.UI.Row({ spacing: 8, verticalAlignment: 'center' }, [
      circleBtn('−', dec, keyPrefix + '_dec'),
      ctx.UI.Box({ width: 52, contentAlignment: 'center' }, [
        ctx.UI.Text({
          text: String(value),
          style: 'titleMedium',
          fontWeight: 'bold',
          color: String(c.onSurface)
        })
      ]),
      circleBtn('+', inc, keyPrefix + '_inc')
    ]);
  }

  // ---- 权限开关 ----
  const switchNode = ctx.UI.Switch({
    checked: bypass,
    onCheckedChange: toggleBypass
  });

  // ---- 组装 ----
  const blocks: ComposeNode[] = [];

  // 权限区
  blocks.push(
    ctx.UI.Text({
      text: '权限',
      style: 'labelLarge',
      fontWeight: 'bold',
      color: String(c.primary),
      paddingStart: 4,
      paddingTop: 4
    })
  );
  blocks.push(
    rowItem(
      '跳过危险操作确认',
      bypass
        ? '已关闭确认：摧毁 / 大目录删除 / 过旧回滚会直接执行'
        : '已开启确认：危险操作会弹出确认框等你批准',
      switchNode,
      'row_bypass'
    )
  );

  // 危险阈值区
  blocks.push(
    ctx.UI.Text({
      text: '危险阈值',
      style: 'labelLarge',
      fontWeight: 'bold',
      color: String(c.primary),
      paddingStart: 4,
      paddingTop: 12
    })
  );
  blocks.push(
    rowItem(
      '删除目录阈值',
      '删除的目录内文件数超过 ' + cfg.deleteDirFileCount + ' 个时，需要确认',
      stepper(cfg.deleteDirFileCount, (v) => save({ deleteDirFileCount: v }), 5, 5, 'del'),
      'row_del_threshold'
    )
  );
  blocks.push(
    rowItem(
      '回滚跨度阈值',
      '向前回滚超过 ' + cfg.rollbackVersionSpan + ' 个版本时，需要确认',
      stepper(cfg.rollbackVersionSpan, (v) => save({ rollbackVersionSpan: v }), 1, 1, 'rb'),
      'row_rb_threshold'
    )
  );

  // 其他区
  blocks.push(
    ctx.UI.Text({
      text: '构建与快照',
      style: 'labelLarge',
      fontWeight: 'bold',
      color: String(c.primary),
      paddingStart: 4,
      paddingTop: 12
    })
  );
  blocks.push(
    rowItem(
      '依赖提取上限',
      'opm_build 提取 node_modules 到 db 的单次上限',
      stepper(cfg.dependencyMaxMb, (v) => save({ dependencyMaxMb: v }), 50, 10, 'dep'),
      'row_dep_max'
    )
  );
  blocks.push(
    rowItem(
      '自动快照保留',
      '超出这个条数的自动快照会被剪掉（最新保留）',
      stepper(cfg.autosnapRetention, (v) => save({ autosnapRetention: v }), 50, 50, 'snap'),
      'row_snap'
    )
  );

  // 确认框文案
  blocks.push(
    ctx.UI.Text({
      text: '确认框默认文案',
      style: 'labelLarge',
      fontWeight: 'bold',
      color: String(c.primary),
      paddingStart: 4,
      paddingTop: 12
    })
  );
  blocks.push(
    ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
      ctx.UI.Column({ padding: 14, spacing: 8 }, [
        ctx.UI.Text({ text: '主标题', style: 'labelMedium', fontWeight: 'bold', color: String(c.onSurface) }),
        ctx.UI.TextField({
          value: cfg.confirmTitle,
          onValueChange: (v: string) => save({ confirmTitle: v }),
          singleLine: true,
          placeholder: DEFAULT_SETTINGS.confirmTitle
        }),
        ctx.UI.Text({ text: '小字说明', style: 'labelMedium', fontWeight: 'bold', color: String(c.onSurface) }),
        ctx.UI.TextField({
          value: cfg.confirmHint,
          onValueChange: (v: string) => save({ confirmHint: v }),
          singleLine: false,
          maxLines: 3,
          placeholder: DEFAULT_SETTINGS.confirmHint
        })
      ])
    ])
  );

  // 底部：路径信息 + 恢复默认
  blocks.push(
    ctx.UI.Card({ fillMaxWidth: true, containerColor: String(c.surfaceVariant) }, [
      ctx.UI.Column({ padding: 14, spacing: 6 }, [
        ctx.UI.Text({ text: '开发目录', style: 'labelMedium', fontWeight: 'bold', color: String(c.onSurface) }),
        ctx.UI.Text({ text: DEV_PACKAGE_ROOT, style: 'labelSmall', color: String(c.onSurfaceVariant) })
      ])
    ])
  );
  blocks.push(
    ctx.UI.OutlinedButton({
      onClick: async () => { await resetAll(); },
      fillMaxWidth: true,
      enabled: !busy,
      content: ctx.UI.Text({
        text: '恢复默认配置',
        style: 'labelLarge'
      })
    })
  );

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface),
    onLoad: loadAll
  }, [
    topBar,
    ctx.UI.LazyColumn({
      weight: 1,
      fillMaxWidth: true,
      padding: { horizontal: 16, vertical: 12 },
      spacing: 8
    }, blocks)
  ]);
}