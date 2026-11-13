// 版本快照服务：时间线快照（移植 snapshotver 语义，但数据全在 storage.db）
//
// 与自动快照的分工：
//   自动快照 = 每次写/删/上传的细粒度流水（autosnap_records），给「改错了立刻后悔」用
//   版本快照 = 显式提交的里程碑（snapshot_nodes + snapshot_files），给「回到某个版本」用
//
// 提交模型：
//   add    -> 把当前虚拟文件树同步进 staging
//   remove -> 在 staging 标记删除
//   commit -> staging 落成新节点（同时写全量文件树，便于任意版本重建）
//   diff   -> 目标节点与当前 staging/工作区对比
//   rollback -> 物理重建虚拟文件树到目标版本，并删除其后节点

import { openProjectDb } from '../storage/database';
import * as vfs from '../storage/vfsDao';
import * as snap from '../storage/snapshotDao';
import { normalizeVirtualPath } from '../util/paths';
import { nowIso } from '../util/time';
import { sha256Hex, utf8ByteLength, b64ByteLength } from '../util/bytes';
import { unifiedDiff } from '../util/diff';
import { mkdirp, writeText, writeBinaryB64 } from '../util/files';
import type { SnapshotNode, DiffResult, DiffFile, ChangeType } from '../model/snapshot';

/**
 * 暂存区全量同步（等价 git add -A）：
 *   - 现有文件：与最新节点比对，内容不同的进 staged
 *   - head 树里有、但当前 vfs 里已不存在的文件：标记为 deleted
 */
export async function stageAll(packageId: string): Promise<{
  staged: number;
  skipped: number;
  removed: number;
}> {
  const db = await openProjectDb(packageId);
  const files = vfs.listAllFiles(db);
  const now = nowIso();
  let staged = 0;
  let skipped = 0;
  let removed = 0;

  // 与最新节点对比，内容相同的不必重复 stage
  const latest = snap.latestNode(db);
  let latestMap: { [p: string]: string } = {};
  if (latest) {
    const lf = snap.listSnapshotFiles(db, latest.id);
    for (let i = 0; i < lf.length; i++) latestMap[lf[i].path] = lf[i].checksum;
  }

  // 当前 vfs 里存在的路径集合
  const liveSet: { [p: string]: boolean } = {};

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    liveSet[f.path] = true;
    if (latestMap[f.path] === f.checksum) {
      skipped++;
      continue;
    }
    snap.putStaging(db, {
      path: f.path,
      isBinary: f.isBinary,
      content: f.content,
      checksum: f.checksum,
      state: 'staged',
      updatedAt: now
    });
    staged++;
  }

  // head 树里有、当前已不存在的 -> 标记删除
  const headPaths = Object.keys(latestMap);
  for (let i = 0; i < headPaths.length; i++) {
    const p = headPaths[i];
    if (liveSet[p]) continue;
    snap.putStaging(db, {
      path: p,
      isBinary: 0,
      content: null,
      checksum: null,
      state: 'deleted',
      updatedAt: now
    });
    removed++;
  }

  return { staged: staged, skipped: skipped, removed: removed };
}

/** 暂存单条路径（等价 git add <path>） */
export async function stagePath(packageId: string, path: string): Promise<{ staged: boolean; path: string }> {
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  const f = vfs.getFile(db, p);
  if (!f) throw new Error('文件不存在: ' + path);
  snap.putStaging(db, {
    path: p,
    isBinary: f.isBinary,
    content: f.content,
    checksum: f.checksum,
    state: 'staged',
    updatedAt: nowIso()
  });
  return { staged: true, path: p };
}

/** 标记某路径在下次提交中删除 */
export async function stageRemove(packageId: string, path: string): Promise<{ removed: boolean; path: string }> {
  const db = await openProjectDb(packageId);
  const p = normalizeVirtualPath(path);
  snap.putStaging(db, {
    path: p,
    isBinary: 0,
    content: null,
    checksum: null,
    state: 'deleted',
    updatedAt: nowIso()
  });
  return { removed: true, path: p };
}

/** 暂存区总览 */
export async function showStaging(packageId: string): Promise<{
  total: number;
  staged: Array<{ path: string; size: number }>;
  deleted: string[];
}> {
  const db = await openProjectDb(packageId);
  const list = snap.listStaging(db);
  const staged: Array<{ path: string; size: number }> = [];
  const deleted: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.state === 'deleted') {
      deleted.push(e.path);
    } else {
      const size = e.isBinary === 1
        ? b64ByteLength(e.content || '')
        : utf8ByteLength(e.content || '');
      staged.push({ path: e.path, size: size });
    }
  }
  return { total: list.length, staged: staged, deleted: deleted };
}

/** 清空暂存区 */
export async function clearStaging(packageId: string): Promise<{ cleared: number }> {
  const db = await openProjectDb(packageId);
  const n = snap.countStaging(db);
  snap.clearStaging(db);
  return { cleared: n };
}

/** 提交一个快照节点 */
export async function commit(
  packageId: string,
  options: {
    displayVersion: string;
    description?: string;
    author?: string;
    /** 版本号递增步长，默认 1 */
    step?: number;
  }
): Promise<{
  node: SnapshotNode;
  fileCount: number;
  stagedApplied: number;
  deletedApplied: number;
}> {
  if (!options || !options.displayVersion) throw new Error('commit 需要 displayVersion');
  const displayVersion = String(options.displayVersion).trim();
  if (!displayVersion) throw new Error('displayVersion 不能为空');

  const db = await openProjectDb(packageId);

  // 唯一性
  const dup = snap.getNodeByDisplay(db, displayVersion);
  if (dup) throw new Error('显示版本号已存在: ' + displayVersion);

  const staging = snap.listStaging(db);
  if (!staging.length) throw new Error('暂存区为空，请先 add/remove 后再 commit');

  const maxVid = snap.maxVersionId(db);
  const versionId = maxVid + (options.step && options.step > 0 ? options.step : 1);
  const latest = snap.latestNode(db);
  const now = nowIso();

  const nodeId = snap.insertNode(
    db,
    versionId,
    displayVersion,
    options.description || '',
    options.author || '',
    now,
    latest ? latest.id : null
  );

  // 先复制父节点全量树，再应用 staging 覆盖
  const tree: { [p: string]: { isBinary: number; content: string | null; checksum: string; changeType: ChangeType } } = {};
  if (latest) {
    const parentFiles = snap.listSnapshotFiles(db, latest.id);
    for (let i = 0; i < parentFiles.length; i++) {
      const pf = parentFiles[i];
      tree[pf.path] = {
        isBinary: pf.isBinary,
        content: pf.content,
        checksum: pf.checksum,
        changeType: 'modify'
      };
    }
  }

  let stagedApplied = 0;
  let deletedApplied = 0;

  for (let i = 0; i < staging.length; i++) {
    const e = staging[i];
    if (e.state === 'deleted') {
      delete tree[e.path];
      deletedApplied++;
    } else {
      const existed = !!tree[e.path];
      tree[e.path] = {
        isBinary: e.isBinary,
        content: e.content,
        checksum: e.checksum || '',
        changeType: existed ? 'modify' : 'create'
      };
      stagedApplied++;
    }
  }

  const paths = Object.keys(tree);
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const t = tree[p];
    snap.insertSnapshotFile(db, {
      snapshotId: nodeId,
      path: p,
      changeType: t.changeType,
      isBinary: t.isBinary,
      content: t.content,
      checksum: t.checksum
    });
  }

  snap.clearStaging(db);

  const node = snap.getNodeById(db, nodeId);
  if (!node) throw new Error('快照节点写入后读取失败');
  return {
    node: node,
    fileCount: paths.length,
    stagedApplied: stagedApplied,
    deletedApplied: deletedApplied
  };
}

/** 分页列出节点 */
export async function listNodes(packageId: string, page?: number, limit?: number): Promise<{
  total: number;
  page: number;
  limit: number;
  nodes: Array<SnapshotNode & { fileCount: number }>;
}> {
  const db = await openProjectDb(packageId);
  const p = page && page > 0 ? page : 1;
  const l = limit && limit > 0 ? Math.min(200, limit) : 10;
  const rows = snap.listNodes(db, p, l);
  const out: Array<SnapshotNode & { fileCount: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    const n = rows[i];
    out.push(Object.assign({}, n, { fileCount: snap.countSnapshotFiles(db, n.id) }));
  }
  return { total: snap.countNodes(db), page: p, limit: l, nodes: out };
}

/** 某节点的文件清单 */
export async function listNodeFiles(packageId: string, displayVersion: string): Promise<{
  node: SnapshotNode;
  files: Array<{ path: string; changeType: ChangeType; isBinary: number; size: number; checksum: string }>;
}> {
  const db = await openProjectDb(packageId);
  const node = snap.getNodeByDisplay(db, displayVersion);
  if (!node) throw new Error('版本不存在: ' + displayVersion);
  const rows = snap.listSnapshotFiles(db, node.id);
  const files = rows.map(function (r) {
    const size = r.isBinary === 1 ? b64ByteLength(r.content || '') : utf8ByteLength(r.content || '');
    return {
      path: r.path,
      changeType: r.changeType,
      isBinary: r.isBinary,
      size: size,
      checksum: r.checksum
    };
  });
  return { node: node, files: files };
}

/** 读某版本的单文件内容 */
export async function readFileAtVersion(
  packageId: string,
  displayVersion: string,
  path: string
): Promise<{ path: string; isBinary: boolean; content: string; checksum: string }> {
  const db = await openProjectDb(packageId);
  const node = snap.getNodeByDisplay(db, displayVersion);
  if (!node) throw new Error('版本不存在: ' + displayVersion);
  const p = normalizeVirtualPath(path);
  const rows = snap.listSnapshotFiles(db, node.id);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].path === p) {
      return {
        path: p,
        isBinary: rows[i].isBinary === 1,
        content: rows[i].content || '',
        checksum: rows[i].checksum
      };
    }
  }
  throw new Error('该版本中不存在文件: ' + path);
}

/** diff：目标版本 vs 当前工作区（暂存区优先，否则与虚拟文件系统比） */
export async function diff(packageId: string, displayVersion: string): Promise<DiffResult> {
  const db = await openProjectDb(packageId);
  const node = snap.getNodeByDisplay(db, displayVersion);
  if (!node) throw new Error('版本不存在: ' + displayVersion);

  const snapFiles = snap.listSnapshotFiles(db, node.id);
  const snapMap: { [p: string]: { isBinary: number; content: string | null; checksum: string } } = {};
  for (let i = 0; i < snapFiles.length; i++) {
    const f = snapFiles[i];
    snapMap[f.path] = { isBinary: f.isBinary, content: f.content, checksum: f.checksum };
  }

  // 当前状态：暂存区覆盖优先
  const currentMap: { [p: string]: { isBinary: number; content: string | null; checksum: string } } = {};
  const live = vfs.listAllFiles(db);
  for (let i = 0; i < live.length; i++) {
    const f = live[i];
    currentMap[f.path] = { isBinary: f.isBinary, content: f.content, checksum: f.checksum };
  }
  const staging = snap.listStaging(db);
  for (let i = 0; i < staging.length; i++) {
    const e = staging[i];
    if (e.state === 'deleted') delete currentMap[e.path];
    else currentMap[e.path] = { isBinary: e.isBinary, content: e.content, checksum: e.checksum || '' };
  }

  const allPaths: { [p: string]: boolean } = {};
  Object.keys(snapMap).forEach(function (p) { allPaths[p] = true; });
  Object.keys(currentMap).forEach(function (p) { allPaths[p] = true; });

  const files: DiffFile[] = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;

  const sorted = Object.keys(allPaths).sort();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const a = snapMap[p];
    const b = currentMap[p];

    if (!a && b) {
      added++;
      files.push({ path: p, changeType: 'create', patch: null });
    } else if (a && !b) {
      deleted++;
      files.push({ path: p, changeType: 'delete', patch: null });
    } else if (a && b && a.checksum !== b.checksum) {
      modified++;
      let patch: string | null = null;
      if (a.isBinary === 0 && b.isBinary === 0) {
        patch = unifiedDiff(a.content || '', b.content || '', p);
      }
      files.push({ path: p, changeType: 'modify', patch: patch });
    }
  }

  return {
    from: displayVersion,
    to: 'working',
    added: added,
    modified: modified,
    deleted: deleted,
    files: files
  };
}

/** 区间 diff：两个版本之间 */
export async function intervalDiff(
  packageId: string,
  leftVersion: string,
  rightVersion: string
): Promise<DiffResult> {
  const db = await openProjectDb(packageId);
  const left = snap.getNodeByDisplay(db, leftVersion);
  const right = snap.getNodeByDisplay(db, rightVersion);
  if (!left) throw new Error('左侧版本不存在: ' + leftVersion);
  if (!right) throw new Error('右侧版本不存在: ' + rightVersion);

  const lf = snap.listSnapshotFiles(db, left.id);
  const rf = snap.listSnapshotFiles(db, right.id);
  const lmap: { [p: string]: { isBinary: number; content: string | null; checksum: string } } = {};
  const rmap: { [p: string]: { isBinary: number; content: string | null; checksum: string } } = {};
  for (let i = 0; i < lf.length; i++) lmap[lf[i].path] = { isBinary: lf[i].isBinary, content: lf[i].content, checksum: lf[i].checksum };
  for (let i = 0; i < rf.length; i++) rmap[rf[i].path] = { isBinary: rf[i].isBinary, content: rf[i].content, checksum: rf[i].checksum };

  const allPaths: { [p: string]: boolean } = {};
  Object.keys(lmap).forEach(function (p) { allPaths[p] = true; });
  Object.keys(rmap).forEach(function (p) { allPaths[p] = true; });

  const files: DiffFile[] = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;

  const sorted = Object.keys(allPaths).sort();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const a = lmap[p];
    const b = rmap[p];
    if (!a && b) {
      added++;
      files.push({ path: p, changeType: 'create', patch: null });
    } else if (a && !b) {
      deleted++;
      files.push({ path: p, changeType: 'delete', patch: null });
    } else if (a && b && a.checksum !== b.checksum) {
      modified++;
      let patch: string | null = null;
      if (a.isBinary === 0 && b.isBinary === 0) patch = unifiedDiff(a.content || '', b.content || '', p);
      files.push({ path: p, changeType: 'modify', patch: patch });
    }
  }

  return {
    from: leftVersion,
    to: rightVersion,
    added: added,
    modified: modified,
    deleted: deleted,
    files: files
  };
}

/**
 * 把指定版本的文件树恢复到虚拟文件系统（回滚）。
 *
 * 冲突策略（对齐 snapshotver）：
 *   - 「未跟踪文件」= 磁盘（这里是当前 vfs）中有、但**当前 head 树不跟踪**的文件。
 *     典型来源：历史上删掉了，之后又被重新创建。
 *     这类文件**绝不静默删除或覆盖**。
 *   - 文本冲突：目标版本要写这个名字，而当前 vfs 里有一份未跟踪的同名文件
 *     -> 用 git 风格冲突标记合并：
 *        <<<<<<< HEAD
 *        <当前内容>
 *        =======
 *        <目标版本内容>
 *        >>>>>>> version/<versionId>
 *   - 二进制冲突：无法嵌标记
 *     -> 把当前那份改名成 `{name}.rollback-conflict-v{versionId}` 保留，
 *        目标版本那份写回原名。两边都不丢。
 */
export async function rollback(
  packageId: string,
  displayVersion: string,
  options?: { keepHistory?: boolean }
): Promise<{
  node: SnapshotNode;
  restored: number;
  removed: number;
  nodesDeleted: number;
  conflicts: Array<{ path: string; marker: string }>;
  binaryConflicts: Array<{ path: string; preservedAs: string }>;
  keptUntracked: Array<{ path: string }>;
}> {
  const db = await openProjectDb(packageId);
  const node = snap.getNodeByDisplay(db, displayVersion);
  if (!node) throw new Error('版本不存在: ' + displayVersion);

  const target = snap.listSnapshotFiles(db, node.id);
  const targetMap: { [p: string]: { isBinary: number; content: string | null; checksum: string } } = {};
  for (let i = 0; i < target.length; i++) {
    const f = target[i];
    targetMap[f.path] = { isBinary: f.isBinary, content: f.content, checksum: f.checksum };
  }

  // 回滚前的最新节点（head）：用来判定「哪些文件是未跟踪的」
  const head = snap.latestNode(db);
  const headMap: { [p: string]: boolean } = {};
  if (head) {
    const hf = snap.listSnapshotFiles(db, head.id);
    for (let i = 0; i < hf.length; i++) headMap[hf[i].path] = true;
  }

  const now = nowIso();
  let restored = 0;
  let removed = 0;

  const conflicts: Array<{ path: string; marker: string }> = [];
  const binaryConflicts: Array<{ path: string; preservedAs: string }> = [];
  const keptUntracked: Array<{ path: string }> = [];

  // ---- 第一步：删除「当前有、目标没有」的文件 ----
  // 只删 head 树仍跟踪的文件；未被 head 跟踪的保留，避免毁掉用户数据。
  const live = vfs.listAllFiles(db);
  for (let i = 0; i < live.length; i++) {
    const p = live[i].path;
    if (targetMap[p]) continue;

    if (!headMap[p]) {
      // 未跟踪文件：保留并报告
      keptUntracked.push({ path: p });
      continue;
    }
    vfs.deleteFile(db, p);
    removed++;
  }

  // ---- 第二步：把目标树写回 vfs ----
  const paths = Object.keys(targetMap);
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const t = targetMap[p];
    const targetContent = t.content === null ? '' : t.content;
    const targetIsBinary = t.isBinary;
    const current = vfs.getFile(db, p);
    const isUntracked = current && !headMap[p];

    let finalContent = targetContent;
    let finalIsBinary = targetIsBinary;
    let finalChecksum = t.checksum;
    let finalSize = targetIsBinary === 1 ? b64ByteLength(targetContent) : utf8ByteLength(targetContent);

    if (isUntracked) {
      // 冲突：当前 vfs 有一份未跟踪的同名文件，目标版本也要写这个名字
      if (current.isBinary === 1 || targetIsBinary === 1) {
        // 二进制：把当前那份改名保留，目标那份写回原名
        const segs = p.split('/');
        const name = segs[segs.length - 1];
        const newName = name + '.rollback-conflict-v' + node.versionId;
        const preservePath = (segs.slice(0, segs.length - 1).concat([newName])).join('/');

        // 若已存在同名保留文件，先覆盖
        const prev = vfs.getFile(db, preservePath);
        if (prev) vfs.deleteFile(db, preservePath);

        vfs.putFile(
          db, preservePath, current.isBinary, current.content,
          b64ByteLength(current.content) === 0 ? current.size : (current.isBinary === 1 ? b64ByteLength(current.content) : utf8ByteLength(current.content)),
          current.checksum, now, true
        );
        binaryConflicts.push({ path: p, preservedAs: newName });
        // 落到下面的正常写入（目标内容写回原名）
      } else {
        // 文本：写 git 风格冲突标记
        const marker =
          '<<<<<<< HEAD\n' +
          current.content +
          '\n=======\n' +
          targetContent +
          '\n>>>>>>> version/' + node.versionId + '\n';
        finalContent = marker;
        finalIsBinary = 0;
        finalChecksum = sha256Hex(marker);
        finalSize = utf8ByteLength(marker);
        conflicts.push({ path: p, marker: 'version/' + node.versionId });
      }
    }

    // 补父目录
    const segs2 = p.split('/');
    let cur = '';
    for (let k = 0; k < segs2.length - 1; k++) {
      cur = cur ? cur + '/' + segs2[k] : segs2[k];
      vfs.putDir(db, cur, now);
    }

    vfs.putFile(db, p, finalIsBinary, finalContent, finalSize, finalChecksum, now, !vfs.getFile(db, p));
    restored++;
  }

  // ---- 第三步：删除目标之后的节点（默认行为）----
  let nodesDeleted = 0;
  if (!options || options.keepHistory !== true) {
    const all = snap.listNodes(db, 1, 10000);
    for (let i = 0; i < all.length; i++) {
      if (all[i].versionId > node.versionId) nodesDeleted++;
    }
    snap.deleteNodesFrom(db, node.versionId + 1);
  }

  snap.clearStaging(db);
  return {
    node: node,
    restored: restored,
    removed: removed,
    nodesDeleted: nodesDeleted,
    conflicts: conflicts,
    binaryConflicts: binaryConflicts,
    keptUntracked: keptUntracked
  };
}

/** 拉取历史版本到物理目录（不改变当前项目） */
export async function pullFromHistory(
  packageId: string,
  displayVersion: string,
  outputPath: string
): Promise<{ node: SnapshotNode; written: string[]; outputPath: string }> {
  const db = await openProjectDb(packageId);
  const node = snap.getNodeByDisplay(db, displayVersion);
  if (!node) throw new Error('版本不存在: ' + displayVersion);

  // 懒加载 fs 层（避免循环依赖）
  
  const rows = snap.listSnapshotFiles(db, node.id);
  const written: string[] = [];

  mkdirp(outputPath);

  for (let i = 0; i < rows.length; i++) {
    const f = rows[i];
    const rel = f.path.replace(/^mydata\//, '');
    const abs = outputPath.replace(/\/+$/, '') + '/' + rel;
    const parent = abs.slice(0, abs.lastIndexOf('/'));
    if (parent) mkdirp(parent);

    const content = f.content === null ? '' : f.content;
    if (f.isBinary === 1) writeBinaryB64(abs, content);
    else writeText(abs, content);
    written.push(rel);
  }

  return { node: node, written: written, outputPath: outputPath };
}