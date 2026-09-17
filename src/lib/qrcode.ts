/* ============================================================
 * 自研 QR Code 编码器（QR 2005 / ISO/IEC 18004）
 * 支持 Byte 模式、版本 1-16、纠错级别 L/M/Q/H。
 * 零第三方依赖：含 Reed-Solomon 纠错、掩码与惩罚评分、
 * 格式信息 / 版本信息、模块矩阵生成。
 * ============================================================ */
export type ECLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrResult {
  size: number;            // 模块边长（不含静区）
  modules: boolean[][];    // modules[r][c]：true 为深色模块
}

// -------- Galois 域 GF(256)（本原多项式 0x11D）--------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

// -------- Reed-Solomon --------
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = GF_EXP[(GF_LOG[root] + 1) % 255];
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// -------- 错误纠错块表（版本 1-16；[ecPerBlock, g1b, g1d, g2b, g2d]）--------
// 数据取自 ISO/IEC 18004 错误校正表（L/M/Q/H 四档）。
const EC_TABLE: number[][] = [
  // 版本 1
  [7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0],
  // 版本 2
  [10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0],
  // 版本 3
  [15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0],
  // 版本 4
  [20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0],
  // 版本 5
  [26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12],
  // 版本 6
  [18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0],
  // 版本 7
  [20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14],
  // 版本 8
  [24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15],
  // 版本 9
  [30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13],
  // 版本 10
  [18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16],
  // 版本 11
  [20, 4, 81, 0, 0], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13],
  // 版本 12
  [24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15],
  // 版本 13
  [26, 4, 107, 0, 0], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12],
  // 版本 14
  [30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13],
  // 版本 15
  [22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13],
  // 版本 16
  [24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]
];

const ECL_INDEX: Record<ECLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
// 格式信息中使用的纠错级别指示位（2 bit）
const ECL_BITS: Record<ECLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

interface BlockSpec {
  ecPerBlock: number;
  g1blocks: number;
  g1data: number;
  g2blocks: number;
  g2data: number;
}

function getBlockSpec(version: number, ecl: ECLevel): BlockSpec {
  const t = EC_TABLE[(version - 1) * 4 + ECL_INDEX[ecl]];
  return { ecPerBlock: t[0], g1blocks: t[1], g1data: t[2], g2blocks: t[3], g2data: t[4] };
}

// -------- 位流工具 --------
function buildDataCodewords(text: string, spec: BlockSpec, version: number): number[] {
  const data = new TextEncoder().encode(text);
  const capBits = (spec.g1data * spec.g1blocks + spec.g2data * spec.g2blocks) * 8;
  const countBits = version <= 9 ? 8 : 16;

  const bits: number[] = [];
  const pushBits = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  pushBits(0b0100, 4); // 字节模式
  pushBits(data.length, countBits);
  for (const b of data) pushBits(b, 8);

  if (bits.length > capBits) {
    throw new Error('QR data too long for version ' + version);
  }
  while (bits.length % 8 !== 0) bits.push(0);
  const capBytes = capBits / 8;
  let pad = 0xec;
  while (bits.length / 8 < capBytes) {
    pushBits(pad, 8);
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    bytes.push(v);
  }
  return bytes;
}

// -------- 掩码规则与惩罚评分 --------
function applyMask(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return (r * c) % 2 + (r * c) % 3 === 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
    default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
  }
}

function maskPenalty(m: boolean[][]): number {
  const n = m.length;
  let penalty = 0;

  const finderA = [false, true, false, true, true, true, false, false, false, false, false]; // 000001011101 前
  // 用模板评分（行方向扫描）
  const scoreRow = (get: (i: number) => boolean): number => {
    let score = 0;
    const line: boolean[] = [];
    for (let i = 0; i < n; i++) line.push(get(i));
    // N1 连续同色 ≥5
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    // N3 侦测 1011101 两侧 0000
    for (let i = 0; i + 10 < n; i++) {
      let ok = true;
      for (let k = 0; k < 11; k++) if (finderA[k] !== line[i + (10 - k)]) { ok = false; break; }
      if (ok) score += 40;
      ok = true;
      for (let k = 0; k < 11; k++) if (finderA[k] !== line[i + k]) { ok = false; break; }
      if (ok) score += 40;
    }
    return score;
  };
  for (let r = 0; r < n; r++) {
    penalty += scoreRow((i) => m[r][i]);
    penalty += scoreRow((i) => m[i][r]);
  }
  // N2 2x2 同色
  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) penalty += 3;
    }
  }
  // N4 明暗比例
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
  const pct = Math.round((dark * 100) / (n * n) / 5) * 5;
  penalty += Math.abs(pct - 50) / 5 * 10;
  return penalty;
}

// -------- 主编码 --------
function getFormatBits(ecl: ECLevel, mask: number): number {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function alignPositions(version: number): number[] {
  if (version === 1) return [];
  const size = 17 + version * 4;
  if (version === 32) return [6, 34, 62, 90];
  const num = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 4 + num * 2 + 1) / (num * 2 - 2)) * 2;
  const res: number[] = [6];
  for (let i = 1; i < num - 1; i++) res.push(res[i - 1] + step);
  res.push(size - 7);
  return res;
}

export function encodeQr(text: string, ecl: ECLevel = 'M'): QrResult {
  let content: string;
  try {
    content = text.replace(/[\r\n]+\s*$/, ''); // 去掉尾随换行（部分 App 会附加）
  } catch { content = text; }

  // 选定版本：从 1 开始，取第一个能容纳数据的版本
  let version = 1;
  let spec: BlockSpec;
  while (version <= 16) {
    spec = getBlockSpec(version, ecl);
    const capBytes = spec.g1data * spec.g1blocks + spec.g2data * spec.g2blocks;
    const countBits = version <= 9 ? 8 : 16;
    // 最坏估算：4 + countBits + bytes*8 <= capBytes*8
    if (4 + countBits + new TextEncoder().encode(content).length * 8 <= capBytes * 8) break;
    version++;
  }
  if (version > 16) throw new Error('QR data too long');
  spec = getBlockSpec(version, ecl);
  const codewords = buildDataCodewords(content, spec, version);

  // 分块 + RS 纠错
  const blocksData: number[][] = [];
  {
    let idx = 0;
    const pushBlock = (count: number, len: number): void => {
      for (let i = 0; i < count; i++) {
        const b = codewords.slice(idx, idx + len);
        idx += len;
        blocksData.push(b);
      }
    };
    pushBlock(spec.g1blocks, spec.g1data);
    pushBlock(spec.g2blocks, spec.g2data);
  }
  const divisor = rsDivisor(spec.ecPerBlock);
  const blocksEcc = blocksData.map((b) => rsRemainder(b, divisor));

  // 交错
  const finalBytes: number[] = [];
  const maxLen = blocksData.reduce((a, b) => Math.max(a, b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (let bi = 0; bi < blocksData.length; bi++) if (i < blocksData[bi].length) finalBytes.push(blocksData[bi][i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let bi = 0; bi < blocksEcc.length; bi++) finalBytes.push(blocksEcc[bi][i]);
  }

  // 组装模块矩阵
  const size = 17 + version * 4;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFn = (r: number, c: number, d: boolean): void => {
    modules[r][c] = d;
    isFunction[r][c] = true;
  };

  // 定位图形 + 分隔区（三个角，含 1 模块分隔带预留）
  const corners: [number, number][] = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [br, bc] of corners) {
    for (let r = -1; r <= 7; r++) {
      const rr = br + r;
      if (rr < 0 || rr >= size) continue;
      for (let c = -1; c <= 7; c++) {
        const cc = bc + c;
        if (cc < 0 || cc >= size) continue;
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setFn(rr, cc, dark);
      }
    }
  }
  // 时序图形
  for (let i = 8; i < size - 8; i++) {
    setFn(i, 6, i % 2 === 0);
    setFn(6, i, i % 2 === 0);
  }
  // 校正图形
  const pos = alignPositions(version);
  for (const cy of pos) {
    for (const cx of pos) {
      if ((cy === 6 && cx === 6) || (cy === 6 && cx === size - 7) || (cy === size - 7 && cx === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFn(cy + dr, cx + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
  // 固定暗模块
  setFn(size - 8, 8, true);
  // 版本信息（v7+，v<=16 也需要）
  if (version >= 7) {
    const data = version;
    let rem = data;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = ((data << 12) | rem) & 0x3ffff;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >> i) & 1) === 1;
      const row = size - 11 + (i % 3);
      const col = Math.floor(i / 3);
      setFn(col, row, bit);
      setFn(row, col, bit);
    }
  }

  // 预占格式信息位（写入占位值以便数据避让），选择掩码后再写入真实值
  const placeFormat = (bits: number): void => {
    const fb = (i: number): boolean => ((bits >> i) & 1) === 1;
    for (let i = 0; i < 15; i++) {
      const mod = fb(i);
      if (i < 6) setFn(i, 8, mod);
      else if (i < 8) setFn(i + 1, 8, mod);
      else setFn(size - 15 + i, 8, mod);
      if (i < 8) setFn(8, size - i - 1, mod);
      else if (i < 9) setFn(8, 15 - i - 1 + 1, mod);
      else setFn(8, 15 - i - 1, mod);
    }
    setFn(size - 8, 8, true); // 固定暗模块
  };
  placeFormat(0); // 占位（0 掩码），仅用于预留数据避让

  // 放置数据位（蛇形）
  const bitIter = (): Iterator<number> => {
    let i = 0;
    const iter = (): IteratorResult<number> =>
      i < finalBytes.length * 8 ? { value: (finalBytes[Math.floor(i / 8)] >> (7 - (i % 8))) & 1, done: false } : { value: 0, done: true } as IteratorResult<number>;
    const next = (): IteratorResult<number> => { const v = iter(); i++; return v; };
    return { next };
  };
  const bitsIt = bitIter();
  {
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let k = 0; k < size; k++) {
        const row = upward ? size - 1 - k : k;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (cc < 0) continue;
          if (!isFunction[row][cc]) {
            modules[row][cc] = bitsIt.next().value === 1;
          }
        }
      }
      upward = !upward;
    }
  }

  // 选择最佳掩码
  let bestMask = 0;
  let bestMatrix: boolean[][] | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const cand = modules.map((rowArr) => rowArr.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunction[r][c] && applyMask(mask, r, c)) cand[r][c] = !cand[r][c];
      }
    }
    const p = maskPenalty(cand);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
      bestMatrix = cand;
    }
  }
  modules.splice(0);
  for (let r = 0; r < size; r++) modules[r] = bestMatrix![r];

  // 格式信息（选择掩码后写入真实值）
  placeFormat(getFormatBits(ecl, bestMask));

  return { size, modules };
}