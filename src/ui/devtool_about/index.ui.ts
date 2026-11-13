// SPDX-FileCopyrightText: 2026 yyswys-yjyj
// SPDX-License-Identifier: GPL-3.0-or-later
//
// 关于页（devtool_about）
//
// 内容：项目身份 / 技术信息 / 能力概览 / 链接入口（开源许可、仓库）。
// 风格照本项目：topBar + LazyColumn(weight:1) + Card，页面内不画返回箭头。
//
// 为什么要独立一个 About 页而不是塞进设置页：
//   设置页是「改行为」的地方（阈值、开关），About 是「看身份」的地方（版本、许可、致谢）。
//   两者混在一起，用户找东西会互相干扰，也会让设置页越滚越长。
import type { ComposeNode } from '../../model/compose';
import { SELF_INFO } from '../../model/opensource';
import { PKG_ID } from '../../model/constants';

/** 拼路由（与 main.ts 的 routeOf 一致） */
function routeOf(moduleId: string): string {
  return 'toolpkg:' + PKG_ID + ':ui:' + moduleId;
}

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

/** 一行「标签 : 值」 */
function infoRow(ctx: any, c: any, label: string, value: string): ComposeNode {
  return ctx.UI.Row({
    fillMaxWidth: true,
    spacing: 8,
    verticalAlignment: 'center'
  }, [
    ctx.UI.Text({
      text: label,
      style: 'labelSmall',
      color: String(c.onSurfaceVariant)
    }),
    ctx.UI.Text({
      text: value,
      style: 'labelSmall',
      color: String(c.onSurface),
      weight: 1,
      maxLines: 2,
      overflow: 'ellipsis'
    })
  ]);
}

/** 一个可点的入口行 */
function linkRow(
  ctx: any,
  c: any,
  key: string,
  icon: string,
  title: string,
  subtitle: string,
  onTap: () => Promise<void>
): ComposeNode {
  return ctx.UI.Card({
    fillMaxWidth: true,
    key: key,
    containerColor: String(c.surfaceVariant),
    modifier: ctx.Modifier.clickable(onTap)
  }, [
    ctx.UI.Row({
      fillMaxWidth: true,
      padding: 14,
      spacing: 10,
      verticalAlignment: 'center'
    }, [
      ctx.UI.Icon({ name: icon, size: 18, tint: String(c.primary) }),
      ctx.UI.Column({ weight: 1, spacing: 2 }, [
        ctx.UI.Text({
          text: title,
          style: 'bodyMedium',
          fontWeight: 'bold',
          color: String(c.onSurface)
        }),
        ctx.UI.Text({
          text: subtitle,
          style: 'labelSmall',
          color: String(c.onSurfaceVariant),
          maxLines: 1,
          overflow: 'ellipsis'
        })
      ]),
      ctx.UI.Icon({ name: 'chevronRight', size: 16, tint: String(c.onSurfaceVariant) })
    ])
  ]);
}

export default function Screen(ctx: any): ComposeNode {
  const c = ctx.MaterialTheme.colorScheme;

  /** 页内跳转 */
  async function go(moduleId: string): Promise<void> {
    try {
      await ctx.navigate(routeOf(moduleId));
    } catch (e) {
      ctx.showToast('跳转失败：' + moduleId);
    }
  }

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
        text: '关于',
        style: 'titleMedium',
        fontWeight: 'bold',
        color: String(c.onSurface)
      }),
      ctx.UI.Text({
        text: SELF_INFO.name + ' v' + SELF_INFO.version,
        style: 'labelSmall',
        color: String(c.onSurfaceVariant)
      })
    ])
  ]);

  const blocks: ComposeNode[] = [];

  // ---- 身份卡 ----
  blocks.push(
    ctx.UI.Card({
      fillMaxWidth: true,
      containerColor: String(c.primaryContainer)
    }, [
      ctx.UI.Column({ padding: 16, spacing: 10 }, [
        ctx.UI.Row({ fillMaxWidth: true, spacing: 12, verticalAlignment: 'center' }, [
          ctx.UI.Box({
            width: 48,
            height: 48,
            background: String(c.primary),
            contentAlignment: 'center',
            modifier: ctx.Modifier.clip({ cornerRadius: 12 })
          }, [
            ctx.UI.Icon({ name: 'code', size: 26, tint: String(c.onPrimary) })
          ]),
          ctx.UI.Column({ weight: 1, spacing: 3 }, [
            ctx.UI.Text({
              text: SELF_INFO.name,
              style: 'titleMedium',
              fontWeight: 'bold',
              color: String(c.onPrimaryContainer)
            }),
            ctx.UI.Text({
              text: '版本 ' + SELF_INFO.version,
              style: 'labelMedium',
              color: String(c.onPrimaryContainer)
            })
          ])
        ]),
        ctx.UI.Text({
          text: SELF_INFO.desc,
          style: 'bodySmall',
          color: String(c.onPrimaryContainer)
        })
      ])
    ])
  );

  // ---- 技术信息 ----
  blocks.push(
    ctx.UI.Card({
      fillMaxWidth: true,
      containerColor: String(c.surfaceVariant)
    }, [
      ctx.UI.Column({ padding: 14, spacing: 8 }, [
        ctx.UI.Text({
          text: '技术信息',
          style: 'labelLarge',
          fontWeight: 'bold',
          color: String(c.onSurface)
        }),
        infoRow(ctx, c, '包名', SELF_INFO.packageId),
        infoRow(ctx, c, '许可证', SELF_INFO.license),
        infoRow(ctx, c, '版本', 'v' + SELF_INFO.version),
        infoRow(ctx, c, '作者', SELF_INFO.author.replace('Copyright (C) ', '')),
        infoRow(ctx, c, '工具数', '50'),
        infoRow(ctx, c, '界面数', '7')
      ])
    ])
  );

  // ---- 能力概览 ----
  blocks.push(
    ctx.UI.Card({
      fillMaxWidth: true,
      containerColor: String(c.surfaceVariant)
    }, [
      ctx.UI.Column({ padding: 14, spacing: 8 }, [
        ctx.UI.Text({
          text: '能力概览',
          style: 'labelLarge',
          fontWeight: 'bold',
          color: String(c.onSurface)
        }),
        ctx.UI.Text({
          text: '虚拟文件系统（storage.db）· 细粒度自动快照 · 项目版本快照 · tsc 编译 · opm 打包集成 · 询问制危险操作守卫 · 持久化日志（按会话切分）',
          style: 'bodySmall',
          color: String(c.onSurfaceVariant)
        })
      ])
    ])
  );

  // ---- 链接入口 ----
  blocks.push(
    linkRow(
      ctx, c, 'about_lic', 'description',
      '开源许可',
      '本项目使用与依赖的开源作品',
      async () => { await go('licenses'); }
    )
  );
  blocks.push(
    linkRow(
      ctx, c, 'about_repo', 'link',
      '开源仓库',
      SELF_INFO.repoUrl,
      async () => { await openUrl(ctx, SELF_INFO.repoUrl); }
    )
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
      spacing: 10
    }, blocks)
  ]);
}