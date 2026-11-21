import crypto from 'node:crypto';
import zlib from 'node:zlib';

/**
 * Encodes a payload into a git packet line (pkt-line).
 */
export function encodePktLine(payload?: string | Uint8Array | null): Uint8Array {
  const encoder = new TextEncoder();
  if (payload === null || payload === undefined || payload === '' || payload === '0000') {
    return encoder.encode('0000');
  }
  if (payload === '0001') {
    return encoder.encode('0001');
  }
  if (payload === '0002') {
    return encoder.encode('0002');
  }

  const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const length = payloadBytes.length + 4;
  if (length > 65535) {
    throw new Error('Packet line payload too large');
  }
  const hexLen = length.toString(16).padStart(4, '0');
  const header = encoder.encode(hexLen);
  const result = new Uint8Array(header.length + payloadBytes.length);
  result.set(header, 0);
  result.set(payloadBytes, header.length);
  return result;
}

/**
 * Reads packet lines from a buffer.
 */
export function readPktLines(buffer: Uint8Array): { payloads: Uint8Array[]; rest: Uint8Array } {
  const payloads: Uint8Array[] = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset + 4 <= buffer.length) {
    const lenHex = decoder.decode(buffer.subarray(offset, offset + 4));

    if (lenHex === '0000') {
      payloads.push(new Uint8Array(0));
      offset += 4;
      continue;
    }
    if (lenHex === '0001') {
      payloads.push(encoderEncode('0001'));
      offset += 4;
      continue;
    }
    if (lenHex === '0002') {
      payloads.push(encoderEncode('0002'));
      offset += 4;
      continue;
    }

    const len = parseInt(lenHex, 16);
    if (isNaN(len)) {
      throw new Error(`Invalid packet line length hex: ${lenHex}`);
    }
    if (len === 0) {
      payloads.push(new Uint8Array(0));
      offset += 4;
      continue;
    }
    if (len < 4) {
      throw new Error(`Invalid packet line length: ${len}`);
    }

    if (offset + len > buffer.length) {
      break;
    }

    const payload = buffer.subarray(offset + 4, offset + len);
    payloads.push(payload);
    offset += len;
  }

  const rest = buffer.subarray(offset);
  return { payloads, rest };
}

function encoderEncode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Computes git object identifier (SHA-1) from type and content.
 */
export function computeObjectIdentifier(type: string, content: Uint8Array | string): string {
  const contentBytes = typeof content === 'string' ? encoderEncode(content) : content;
  const header = `${type} ${contentBytes.length}\0`;
  const headerBytes = encoderEncode(header);
  const combined = new Uint8Array(headerBytes.length + contentBytes.length);
  combined.set(headerBytes, 0);
  combined.set(contentBytes, headerBytes.length);
  return crypto.createHash('sha1').update(combined).digest('hex');
}

const TYPE_MAP_TO_NUM: Record<string, number> = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
};

const TYPE_MAP_TO_STR: Record<number, string> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
};

/**
 * Builds a pack buffer from a list of type-and-content pairs.
 */
export function buildPack(objects: Array<{ type: string; content: Uint8Array | string }>): Uint8Array {
  const chunks: Uint8Array[] = [];

  const packHeader = new Uint8Array(12);
  packHeader.set(encoderEncode('PACK'), 0);
  packHeader[4] = 0;
  packHeader[5] = 0;
  packHeader[6] = 0;
  packHeader[7] = 2;
  const count = objects.length;
  packHeader[8] = (count >>> 24) & 0xff;
  packHeader[9] = (count >>> 16) & 0xff;
  packHeader[10] = (count >>> 8) & 0xff;
  packHeader[11] = count & 0xff;
  chunks.push(packHeader);

  for (const obj of objects) {
    const typeNum = TYPE_MAP_TO_NUM[obj.type];
    if (typeNum === undefined) {
      throw new Error(`Unknown object type: ${obj.type}`);
    }
    const contentBytes = typeof obj.content === 'string' ? encoderEncode(obj.content) : obj.content;
    const deflated = zlib.deflateSync(contentBytes);

    let sz = contentBytes.length;
    const headerBytes: number[] = [];
    let b = ((typeNum & 0x07) << 4) | (sz & 0x0f);
    sz >>>= 4;
    if (sz > 0) {
      b |= 0x80;
    }
    headerBytes.push(b);

    while (sz > 0) {
      let hb = sz & 0x7f;
      sz >>>= 7;
      if (sz > 0) {
        hb |= 0x80;
      }
      headerBytes.push(hb);
    }

    chunks.push(new Uint8Array(headerBytes));
    chunks.push(deflated);
  }

  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.length;
  }

  const packWithoutTrailer = new Uint8Array(totalLen);
  let cur = 0;
  for (const c of chunks) {
    packWithoutTrailer.set(c, cur);
    cur += c.length;
  }

  const trailer = crypto.createHash('sha1').update(packWithoutTrailer).digest();
  const finalPack = new Uint8Array(totalLen + 20);
  finalPack.set(packWithoutTrailer, 0);
  finalPack.set(trailer, totalLen);

  return finalPack;
}

/**
 * Parses a pack buffer back into a list of type-and-content pairs.
 */
export function parsePack(packBuffer: Uint8Array): Array<{ type: string; content: Uint8Array }> {
  if (packBuffer.length < 32) {
    throw new Error('Pack buffer too short');
  }

  const magic = encoderEncode('PACK');
  for (let i = 0; i < 4; i++) {
    if (packBuffer[i] !== magic[i]) {
      throw new Error('Invalid pack file: missing PACK magic');
    }
  }

  const version = (packBuffer[4] << 24) | (packBuffer[5] << 16) | (packBuffer[6] << 8) | packBuffer[7];
  if (version !== 2) {
    throw new Error(`Unsupported pack version: ${version}`);
  }

  const objectCount = (packBuffer[8] << 24) | (packBuffer[9] << 16) | (packBuffer[10] << 8) | packBuffer[11];

  const contentBefore = packBuffer.subarray(0, packBuffer.length - 20);
  const expectedTrailer = crypto.createHash('sha1').update(contentBefore).digest();
  const actualTrailer = packBuffer.subarray(packBuffer.length - 20);
  for (let i = 0; i < 20; i++) {
    if (expectedTrailer[i] !== actualTrailer[i]) {
      throw new Error('Pack file checksum mismatch (invalid trailer)');
    }
  }

  const objects: Array<{ type: string; content: Uint8Array }> = [];
  let offset = 12;

  for (let idx = 0; idx < objectCount; idx++) {
    if (offset >= packBuffer.length - 20) {
      throw new Error('Unexpected end of pack while parsing object header');
    }

    let b = packBuffer[offset++];
    const typeNum = (b >> 4) & 0x07;
    const typeStr = TYPE_MAP_TO_STR[typeNum];
    if (!typeStr) {
      throw new Error(`Unknown pack object type number: ${typeNum}`);
    }

    let size = b & 0x0f;
    let shift = 4;
    while (b & 0x80) {
      if (offset >= packBuffer.length - 20) {
        throw new Error('Unexpected end of pack while parsing variable-length size');
      }
      b = packBuffer[offset++];
      size += (b & 0x7f) << shift;
      shift += 7;
    }

    const remaining = packBuffer.subarray(offset, packBuffer.length - 20);
    const inflateResult = zlib.inflateSync(remaining, { info: true });
    const content = inflateResult.buffer;
    if (content.length !== size) {
      throw new Error(`Inflated size mismatch: expected ${size}, got ${content.length}`);
    }

    objects.push({ type: typeStr, content });
    offset += inflateResult.engine.bytesWritten;
  }

  return objects;
}

/**
 * Wraps a data buffer into side-band channel-1 packet lines.
 */
export function wrapSideBand64k(dataBuffer: Uint8Array): Uint8Array {
  const CHUNK_SIZE = 65515; // a side-band packet is at most 65520 bytes: 4-byte length + 1-byte band + 65515 data bytes
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < dataBuffer.length; offset += CHUNK_SIZE) {
    const chunk = dataBuffer.subarray(offset, offset + CHUNK_SIZE);
    const payload = new Uint8Array(1 + chunk.length);
    payload[0] = 0x01;
    payload.set(chunk, 1);
    chunks.push(encodePktLine(payload));
  }

  chunks.push(encodePktLine('0000'));

  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.length;
  }

  const result = new Uint8Array(totalLen);
  let cur = 0;
  for (const c of chunks) {
    result.set(c, cur);
    cur += c.length;
  }

  return result;
}
