// SQLite 封装：基于 Android SQLiteDatabase 的 Java bridge。
// 沿用 snapshotver 踩过的坑：
//   1. JS number 绑进 execSQL 的 Object[] 可能静默变 NULL -> 一律按字符串绑定（SQLite 亲和性处理）
//   2. getLong() 返回 BigInt -> 统一 Number() 转换
//   3. 查询时遇到 null/undefined 绑参直接抛错，避免 rawQuery 静默吞掉

export interface SqlRow {
  [key: string]: any;
}

export function openDb(dbPath: string): any {
  const SQLiteDatabase = (Java as any).type('android.database.sqlite.SQLiteDatabase');
  return SQLiteDatabase.openOrCreateDatabase(dbPath, null);
}

/** 把 JS 值安全地转成 SQL 绑定值 */
function bindValue(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

export function dbExec(db: any, sql: string, args?: any[]): void {
  if (args && args.length) {
    db.execSQL(sql, args.map(bindValue));
  } else {
    db.execSQL(sql);
  }
}

export function dbQuery(db: any, sql: string, args?: any[]): SqlRow[] {
  let binds: any[] | null = null;
  if (args && args.length) {
    binds = args.map(function (v: any) {
      if (v === null || v === undefined) {
        throw new Error('Null bind value in query: ' + sql);
      }
      return bindValue(v);
    });
  }
  const cur = binds ? db.rawQuery(sql, binds) : db.rawQuery(sql, null);
  const rows: SqlRow[] = [];
  try {
    if (cur.moveToFirst()) {
      const cols: string[] = [];
      const n = cur.getColumnCount();
      for (let i = 0; i < n; i++) cols.push(String(cur.getColumnName(i)));
      do {
        const row: SqlRow = {};
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i];
          const t = cur.getType(i);
          if (t === 0) row[c] = null;
          else if (t === 1) row[c] = Number(cur.getLong(i));
          else if (t === 2) row[c] = cur.getDouble(i);
          else if (t === 3) row[c] = cur.getString(i);
          else row[c] = cur.getBlob(i);
        }
        rows.push(row);
      } while (cur.moveToNext());
    }
  } finally {
    try { cur.close(); } catch (e) { /* ignore */ }
  }
  return rows;
}

export function dbQueryOne(db: any, sql: string, args?: any[]): SqlRow | null {
  const rows = dbQuery(db, sql, args);
  return rows.length ? rows[0] : null;
}

export function dbInsert(db: any, table: string, fields: { [key: string]: any }): number {
  const ContentValues = (Java as any).type('android.content.ContentValues');
  const cv = ContentValues.newInstance();
  const keys = Object.keys(fields);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = fields[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') cv.put(k, String(v));
    else if (typeof v === 'boolean') cv.put(k, v ? '1' : '0');
    else cv.put(k, String(v));
  }
  return Number(db.insert(table, null, cv));
}

export async function withTx<T>(db: any, fn: () => Promise<T> | T): Promise<T> {
  db.beginTransaction();
  try {
    const result = await fn();
    db.setTransactionSuccessful();
    return result;
  } finally {
    try { db.endTransaction(); } catch (e) { /* ignore */ }
  }
}

export function dbClose(db: any): void {
  try { db.close(); } catch (e) { /* ignore */ }
}