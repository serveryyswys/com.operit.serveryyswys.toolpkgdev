// unified diff 生成（LCS 动态规划 + 上下文行），用于 sed preview 与 snapshot diff

interface Op {
  type: 'equal' | 'insert' | 'delete';
  oldIndex: number;
  newIndex: number;
  line: string;
}

/** 把文本切成行（保留内容，不带换行符） */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trailing = s.charAt(s.length - 1) === '\n';
  const lines = s.split('\n');
  if (trailing) lines.pop();
  return lines;
}

/** 基于 LCS 生成编辑脚本；超大文件降级为整块替换以免爆内存 */
function buildOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  // 阈值保护：单元格超过 400 万时退化为整块替换
  if (n * m > 4000000) {
    const ops: Op[] = [];
    for (let i = 0; i < n; i++) ops.push({ type: 'delete', oldIndex: i, newIndex: -1, line: a[i] });
    for (let j = 0; j < m; j++) ops.push({ type: 'insert', oldIndex: -1, newIndex: j, line: b[j] });
    return ops;
  }

  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array(m + 1).fill(0));
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', oldIndex: i, newIndex: j, line: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', oldIndex: i, newIndex: -1, line: a[i] });
      i++;
    } else {
      ops.push({ type: 'insert', oldIndex: -1, newIndex: j, line: b[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'delete', oldIndex: i, newIndex: -1, line: a[i] }); i++; }
  while (j < m) { ops.push({ type: 'insert', oldIndex: -1, newIndex: j, line: b[j] }); j++; }
  return ops;
}

/** 生成 unified diff 文本；相同则返回空字符串 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  fileLabel: string,
  contextLines?: number
): string {
  if (oldText === newText) return '';
  const ctx = contextLines === undefined ? 3 : contextLines;
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = buildOps(a, b);

  // 找出所有变更块的位置
  const changed: boolean[] = ops.map(function (o) { return o.type !== 'equal'; });
  const hasAny = changed.some(function (x) { return x; });
  if (!hasAny) return '';

  const hunks: string[] = [];
  let idx = 0;
  while (idx < ops.length) {
    if (!changed[idx]) { idx++; continue; }
    // 向前扩展上下文
    let start = idx;
    let back = 0;
    while (start > 0 && back < ctx && ops[start - 1].type === 'equal') { start--; back++; }
    // 向后找变更块的结束
    let end = idx;
    let forwardEqual = 0;
    while (end < ops.length) {
      if (changed[end]) { end++; forwardEqual = 0; continue; }
      forwardEqual++;
      if (forwardEqual > ctx * 2) break;
      end++;
    }
    // 收缩尾部多余上下文到 ctx
    let tail = 0;
    while (end - 1 - tail >= start && ops[end - 1 - tail].type === 'equal') tail++;
    const realEnd = tail > ctx ? end - (tail - ctx) : end;

    const slice = ops.slice(start, realEnd);
    const oldStart = slice.find(function (o) { return o.oldIndex >= 0; });
    const newStart = slice.find(function (o) { return o.newIndex >= 0; });
    const oldLineNo = oldStart ? oldStart.oldIndex + 1 : 0;
    const newLineNo = newStart ? newStart.newIndex + 1 : 0;
    const oldCount = slice.filter(function (o) { return o.type !== 'insert'; }).length;
    const newCount = slice.filter(function (o) { return o.type !== 'delete'; }).length;

    const lines: string[] = [];
    lines.push('@@ -' + oldLineNo + ',' + oldCount + ' +' + newLineNo + ',' + newCount + ' @@');
    for (let k = 0; k < slice.length; k++) {
      const o = slice[k];
      if (o.type === 'equal') lines.push(' ' + o.line);
      else if (o.type === 'delete') lines.push('-' + o.line);
      else lines.push('+' + o.line);
    }
    hunks.push(lines.join('\n'));
    idx = realEnd;
  }

  const header = '--- a/' + fileLabel + '\n+++ b/' + fileLabel;
  return header + '\n' + hunks.join('\n');
}

/** 统计增删行数 */
export function diffStat(oldText: string, newText: string): { added: number; removed: number } {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = buildOps(a, b);
  let added = 0;
  let removed = 0;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === 'insert') added++;
    else if (ops[i].type === 'delete') removed++;
  }
  return { added: added, removed: removed };
}