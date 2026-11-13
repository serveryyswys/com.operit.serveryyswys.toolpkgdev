// base64 / checksum / 文本与二进制判定

import { BINARY_EXT, TEXT_EXT } from '../model/constants';
import { extName } from './paths';

export function utf8ToB64(text: string): string {
  const B64 = (Java as any).type('android.util.Base64');
  const JString = (Java as any).type('java.lang.String');
  return B64.encodeToString(JString.newInstance(String(text)).getBytes('UTF-8'), 0);
}

export function b64ToUtf8(b64: string): string {
  const B64 = (Java as any).type('android.util.Base64');
  const JString = (Java as any).type('java.lang.String');
  const bytes = B64.decode(String(b64), 0);
  return JString.newInstance(bytes, 'UTF-8').toString();
}

/** 判断给定文件名是否已知二进制扩展名 */
export function looksBinaryByExt(name: string): boolean {
  return BINARY_EXT.has(extName(name));
}

/** 判断给定文件名是否已知文本扩展名 */
export function looksTextByExt(name: string): boolean {
  return TEXT_EXT.has(extName(name));
}

/** 检测 base64 内容解码后是否含 NUL 字节 */
export function b64ContainsNul(b64: string): boolean {
  try {
    const B64 = (Java as any).type('android.util.Base64');
    const bytes = B64.decode(String(b64), 0);
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
      if (bytes[i] === 0) return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

/** 计算字符串的 sha256（十六进制小写） */
export function sha256Hex(text: string): string {
  try {
    const MessageDigest = (Java as any).type('java.security.MessageDigest');
    const md = MessageDigest.getInstance('SHA-256');
    const JString = (Java as any).type('java.lang.String');
    const digest = md.digest(JString.newInstance(String(text)).getBytes('UTF-8'));
    const Hex = (Java as any).type('android.util.Base64');
    // 用 Base64 再转 hex 太绕，这里自己拼 hex
    let out = '';
    const len = digest.length;
    for (let i = 0; i < len; i++) {
      const v = (digest[i] + 256) % 256;
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  } catch (e) {
    // 兜底：简单长度 + 字符累加，保证 dedupe 仍然可用（不用于安全目的）
    let h = 0;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return 'fallback-' + (h >>> 0).toString(16) + '-' + s.length;
  }
}

/** 按 UTF-8 估算文本字节长度 */
export function utf8ByteLength(text: string): number {
  const s = String(text);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** base64 对应的原始字节数 */
export function b64ByteLength(b64: string): number {
  const s = String(b64);
  if (!s) return 0;
  let padding = 0;
  if (s.charAt(s.length - 1) === '=') padding++;
  if (s.length > 1 && s.charAt(s.length - 2) === '=') padding++;
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

/** 根据内容与文件名推断 isBinary(0/1) */
export function inferIsBinary(name: string, content: string): number {
  if (looksTextByExt(name)) return 0;
  if (looksBinaryByExt(name)) return 1;
  // 无扩展名：做 NUL 检测，先把文本当作可能内容判断
  if (b64ContainsNul(utf8ToB64(content))) return 1;
  return 0;
}