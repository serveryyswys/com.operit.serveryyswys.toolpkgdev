// SPDX-FileCopyrightText: 2026 yyswys-yjyj
// SPDX-License-Identifier: GPL-3.0-or-later
//
// 开源许可声明页（devtool_licenses）
//
// 内容结构抄 overmem 的 OpenSourcePage（本项目 / 宿主平台 / 直接依赖 / 经平台间接使用
// / 完整许可证文本 / 无担保声明），但**视觉与组件全部按本项目的风格重写**：
//   - 页面骨架用我们的 topBar + LazyColumn(weight:1)，不是 overmem 的 IconButton 顶栏
//   - 卡片用 Card + Row/Column 手写，不用 ListItem / Spacer（我们 types 里没有 Spacer）
//   - 页面内**不画返回箭头**：ctx.navigate 只有 push 没有 pop，返回交给系统返回键
//
// 数据全部来自 model/opensource.ts，那个文件里只列我们**真正用到**的依赖。
import type { ComposeNode } from '../../model/compose';
import {
  SELF_INFO,
  LIB_SECTIONS,
  LICENSE_LINKS,
  licenseColor
} from '../../model/opensource';
import type { LibInfo } from '../../model/opensource';

/** 打开外部链接 */
async function openUrl(ctx: any, url: string): Promise<void> {
  if (!url) return;
  try {
    await (Tools as any).System.intent({
      action: 'android.intent.action.VIEW',
      uri: url
    });
  } catch (e) {
    ctx.showToast('打开链接失败：' + url);
  }
}

/** 许可证徽标 */
function licenseBadge(ctx: any, label: string, kind: any): ComposeNode {
  const bg = licenseColor(kind);
  return ctx.UI.Box({
    background: bg,
    padding: { horizontal: 6, vertical: 2 },
    modifier: ctx.Modifier.clip({ cornerRadius: 4 })
  }, [
    ctx.UI.Text({
      text: label,
      style: 'labelSmall',
      fontWeight: 'bold',
      color: '#FFFFFF'
    })
  ]);
}

/** 一张作品卡片 */
function libCard(ctx: any, c: any, lib: LibInfo): ComposeNode {
  const rows: ComposeNode[] = [
    // 第一行：作品名 + 许可证徽标
    ctx.UI.Row({
      fillMaxWidth: true,
      spacing: 8,
      verticalAlignment: 'center'
    }, [
      ctx.UI.Text({
        text: lib.name,
        style: 'bodyMedium',
        fontWeight: 'bold',
        color: String(c.onSurface),
        weight: 1,
        maxLines: 2
      }),
      licenseBadge(ctx, lib.license, lib.kind)
    ]),
    // 版权人
    ctx.UI.Text({
      text: lib.author,
      style: 'labelSmall',
      color: String(c.onSurfaceVariant)
    }),
    // 用途说明
    ctx.UI.Text({
      text: lib.usage,
      style: 'bodySmall',
      color: String(c.onSurface)
    })
  ];
  // 有主页就加一行可点的链接
  if (lib.url) {
    rows.push(
      ctx.UI.Row({
        fillMaxWidth: true,
        spacing: 4,
        verticalAlignment: 'center',
        modifier: ctx.Modifier.clickable(async () => { await openUrl(ctx, String(lib.url)); })
      }, [
        ctx.UI.Icon({ name: 'link', size: 13, tint: String(c.primary) }),
        ctx.UI.Text({
          text: String(lib.url),
          style: 'labelSmall',
          color: String(c.primary),
          maxLines: 1,
          overflow: 'ellipsis',
          weight: 1
        })
      ])
    );
  }
  return ctx.UI.Card({
    fillMaxWidth: true,
    key: 'lib_' + lib.name,
    containerColor: String(c.surfaceVariant)
  }, [
    ctx.UI.Column({ padding: 12, spacing: 5 }, rows)
  ]);
}

/** 分区标题 */
function sectionHeader(ctx: any, c: any, icon: string, title: string, color?: string): ComposeNode {
  return ctx.UI.Row({
    fillMaxWidth: true,
    spacing: 6,
    verticalAlignment: 'center',
    paddingStart: 4,
    paddingTop: 6
  }, [
    ctx.UI.Icon({ name: icon, size: 15, tint: color || String(c.primary) }),
    ctx.UI.Text({
      text: title,
      style: 'labelLarge',
      fontWeight: 'bold',
      color: color || String(c.primary)
    })
  ]);
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  // ---- 顶栏 ----
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
        text: '开源许可',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: '本项目使用与依赖的开源作品',
        style: 'labelSmall',
        color: String(c.onSurfaceVariant)
      })
    ]),
    // 仓库入口
    ctx.UI.Box({
      width: 36,
      height: 36,
      contentAlignment: 'center',
      modifier: ctx.Modifier.clip({ type: 'circle' }).clickable(async () => {
        await openUrl(ctx, SELF_INFO.repoUrl);
      })
    }, [
      ctx.UI.Icon({ name: 'link', size: 18, tint: String(c.onSurfaceVariant) })
    ])
  ]);

  const blocks: ComposeNode[] = [];

  // ---- 说明 ----
  blocks.push(
    ctx.UI.Text({
      text: '本页披露 ToolpkgDev 在实现过程中使用或依赖的开源作品。只列真实用到的，未引入的一律不列。',
      style: 'bodySmall',
      color: String(c.onSurfaceVariant),
      paddingStart: 4,
      paddingEnd: 4
    })
  );

  // ---- 本项目 ----
  blocks.push(sectionHeader(ctx, c, 'code', '本项目'));
  blocks.push(
    ctx.UI.Card({
      fillMaxWidth: true,
      key: 'self',
      containerColor: String(c.secondaryContainer)
    }, [
      ctx.UI.Column({ padding: 14, spacing: 6 }, [
        ctx.UI.Row({ fillMaxWidth: true, spacing: 8, verticalAlignment: 'center' }, [
          ctx.UI.Text({
            text: SELF_INFO.name,
            style: 'titleSmall',
            fontWeight: 'bold',
            color: String(c.onSecondaryContainer),
            weight: 1
          }),
          licenseBadge(ctx, SELF_INFO.license, 'GPL-3.0')
        ]),
        ctx.UI.Text({
          text: SELF_INFO.author,
          style: 'labelSmall',
          color: String(c.onSecondaryContainer)
        }),
        ctx.UI.Text({
          text: SELF_INFO.desc,
          style: 'bodySmall',
          color: String(c.onSecondaryContainer)
        }),
        ctx.UI.Text({
          text: 'v' + SELF_INFO.version + ' · ' + SELF_INFO.packageId,
          style: 'labelSmall',
          color: String(c.onSecondaryContainer)
        })
      ])
    ])
  );

  // ---- 各依赖分区 ----
  for (let i = 0; i < LIB_SECTIONS.length; i++) {
    const sec = LIB_SECTIONS[i];
    blocks.push(sectionHeader(ctx, c, sec.icon, sec.title, sec.color));
    if (sec.note) {
      blocks.push(
        ctx.UI.Text({
          text: sec.note,
          style: 'labelSmall',
          color: String(c.onSurfaceVariant),
          paddingStart: 4,
          paddingEnd: 4
        })
      );
    }
    for (let k = 0; k < sec.items.length; k++) {
      blocks.push(libCard(ctx, c, sec.items[k]));
    }
  }

  // ---- 完整许可证文本 ----
  blocks.push(sectionHeader(ctx, c, 'description', '完整许可证文本'));
  for (let i = 0; i < LICENSE_LINKS.length; i++) {
    const lk = LICENSE_LINKS[i];
    blocks.push(
      ctx.UI.Card({
        fillMaxWidth: true,
        key: 'lic_' + i,
        containerColor: String(c.surfaceVariant),
        modifier: ctx.Modifier.clickable(async () => { await openUrl(ctx, lk.url); })
      }, [
        ctx.UI.Row({
          fillMaxWidth: true,
          padding: 12,
          spacing: 8,
          verticalAlignment: 'center'
        }, [
          ctx.UI.Icon({ name: 'description', size: 15, tint: String(c.onSurfaceVariant) }),
          ctx.UI.Text({
            text: lk.label,
            style: 'bodySmall',
            color: String(c.onSurface),
            weight: 1
          }),
          ctx.UI.Icon({ name: 'chevronRight', size: 15, tint: String(c.onSurfaceVariant) })
        ])
      ])
    );
  }

  // ---- 无担保声明 ----
  blocks.push(
    ctx.UI.Card({
      fillMaxWidth: true,
      containerColor: String(c.errorContainer)
    }, [
      ctx.UI.Column({ padding: 14, spacing: 6 }, [
        ctx.UI.Row({ spacing: 6, verticalAlignment: 'center' }, [
          ctx.UI.Icon({ name: 'warning', size: 15, tint: String(c.onErrorContainer) }),
          ctx.UI.Text({
            text: '无担保声明',
            style: 'labelMedium',
            fontWeight: 'bold',
            color: String(c.onErrorContainer)
          })
        ]),
        ctx.UI.Text({
          text: '本软件按"原样"提供，不附带任何形式的担保，包括但不限于适销性或特定用途适用性的默示担保。在任何情况下，作者或版权持有人均不对因本软件或本软件的使用而产生的任何索赔、损害或其他责任负责。',
          style: 'bodySmall',
          color: String(c.onErrorContainer)
        })
      ])
    ])
  );

  // ---- 底部说明 ----
  blocks.push(
    ctx.UI.Text({
      text: '本插件运行所依赖的 Operit 平台还使用了若干其他开源库，完整列表可在 Operit 应用的「关于 → 开源许可」中查看。',
      style: 'labelSmall',
      color: String(c.onSurfaceVariant),
      paddingStart: 4,
      paddingEnd: 4
    })
  );

  return ctx.UI.Column({
    fillMaxSize: true,
    background: String(c.surface)
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