import crypto from 'node:crypto';

/**
 * HLS AES-128 セグメント復号ユーティリティ。
 * 元: Niconicome の AES/Decryptor.cs
 *
 * - key: 16バイト (M3U8 の #EXT-X-KEY:URI= から取得したバイナリ)
 * - iv:  16バイト (#EXT-X-KEY:IV= に書かれた "0xHHHH..." を16進パース)
 *
 * DMSのHLSはAES-128-CBC + PKCS#7 パディング。
 */
export class Aes128Decryptor {
  static decrypt(ciphertext: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (key.length !== 16) {
      throw new Error(`AES-128 key must be 16 bytes (got ${key.length})`);
    }
    if (iv.length !== 16) {
      throw new Error(`AES-128 IV must be 16 bytes (got ${iv.length})`);
    }
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * "0xABCDEF..." 形式のIV文字列を 16バイトの Buffer に変換。
   */
  static parseIv(ivHex: string): Buffer {
    let s = ivHex.trim();
    if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
    // パディング (32文字 = 16バイト)
    if (s.length < 32) s = s.padStart(32, '0');
    return Buffer.from(s, 'hex');
  }
}
