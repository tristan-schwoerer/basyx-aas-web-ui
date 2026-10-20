/**
 * SHA-256 of a UTF-8 string, as lowercase hex.
 *
 * The DMP identifies mappings in its status output by SHA-256 tokens of their
 * repository ids. `crypto.subtle` would do, but browsers only provide it in a
 * secure context, and the Web UI is commonly opened over plain HTTP on a LAN
 * address — so the digest is computed here.
 */

const K = new Uint32Array([
  0x42_8A_2F_98, 0x71_37_44_91, 0xB5_C0_FB_CF, 0xE9_B5_DB_A5, 0x39_56_C2_5B, 0x59_F1_11_F1, 0x92_3F_82_A4, 0xAB_1C_5E_D5,
  0xD8_07_AA_98, 0x12_83_5B_01, 0x24_31_85_BE, 0x55_0C_7D_C3, 0x72_BE_5D_74, 0x80_DE_B1_FE, 0x9B_DC_06_A7, 0xC1_9B_F1_74,
  0xE4_9B_69_C1, 0xEF_BE_47_86, 0x0F_C1_9D_C6, 0x24_0C_A1_CC, 0x2D_E9_2C_6F, 0x4A_74_84_AA, 0x5C_B0_A9_DC, 0x76_F9_88_DA,
  0x98_3E_51_52, 0xA8_31_C6_6D, 0xB0_03_27_C8, 0xBF_59_7F_C7, 0xC6_E0_0B_F3, 0xD5_A7_91_47, 0x06_CA_63_51, 0x14_29_29_67,
  0x27_B7_0A_85, 0x2E_1B_21_38, 0x4D_2C_6D_FC, 0x53_38_0D_13, 0x65_0A_73_54, 0x76_6A_0A_BB, 0x81_C2_C9_2E, 0x92_72_2C_85,
  0xA2_BF_E8_A1, 0xA8_1A_66_4B, 0xC2_4B_8B_70, 0xC7_6C_51_A3, 0xD1_92_E8_19, 0xD6_99_06_24, 0xF4_0E_35_85, 0x10_6A_A0_70,
  0x19_A4_C1_16, 0x1E_37_6C_08, 0x27_48_77_4C, 0x34_B0_BC_B5, 0x39_1C_0C_B3, 0x4E_D8_AA_4A, 0x5B_9C_CA_4F, 0x68_2E_6F_F3,
  0x74_8F_82_EE, 0x78_A5_63_6F, 0x84_C8_78_14, 0x8C_C7_02_08, 0x90_BE_FF_FA, 0xA4_50_6C_EB, 0xBE_F9_A3_F7, 0xC6_71_78_F2,
])

const INITIAL = [
  0x6A_09_E6_67, 0xBB_67_AE_85, 0x3C_6E_F3_72, 0xA5_4F_F5_3A, 0x51_0E_52_7F, 0x9B_05_68_8C, 0x1F_83_D9_AB, 0x5B_E0_CD_19,
]

function rotr (value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

export function sha256Hex (text: string): string {
  const bytes = new TextEncoder().encode(text)
  // Message + 0x80 + zero padding + 64-bit big-endian bit length, to a multiple of 64 bytes.
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(length - 8, Math.floor((bytes.length * 8) / 2 ** 32))
  view.setUint32(length - 4, (bytes.length * 8) >>> 0)

  const hash = [...INITIAL]
  const w = new Uint32Array(64)
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) {
      hash[i] = (hash[i]! + value) >>> 0
    }
  }
  return hash.map(word => word.toString(16).padStart(8, '0')).join('')
}
