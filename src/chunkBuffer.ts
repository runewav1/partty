/** Append-only string chunks; join once on drain to avoid O(n²) concat. */
export type StringChunkBuffer = { chunks: string[]; totalChars: number };

export function createStringChunkBuffer(): StringChunkBuffer {
  return { chunks: [], totalChars: 0 };
}

export function pushStringChunk(buf: StringChunkBuffer, data: string): void {
  if (!data) return;
  buf.chunks.push(data);
  buf.totalChars += data.length;
}

export function peekStringChunkChars(buf: StringChunkBuffer): number {
  return buf.totalChars;
}

export function drainStringChunks(buf: StringChunkBuffer): string {
  if (buf.totalChars === 0) return "";
  const out =
    buf.chunks.length === 1 ? buf.chunks[0]! : buf.chunks.join("");
  buf.chunks.length = 0;
  buf.totalChars = 0;
  return out;
}

/** Append-only binary chunks; concat once on drain to avoid O(n²) copying. */
export type ByteChunkBuffer = { chunks: Uint8Array[]; totalBytes: number };

export function createByteChunkBuffer(): ByteChunkBuffer {
  return { chunks: [], totalBytes: 0 };
}

export function pushByteChunk(buf: ByteChunkBuffer, data: Uint8Array): void {
  if (!data || data.byteLength === 0) return;
  buf.chunks.push(data);
  buf.totalBytes += data.byteLength;
}

export function peekByteChunkBytes(buf: ByteChunkBuffer): number {
  return buf.totalBytes;
}

export function drainByteChunks(buf: ByteChunkBuffer): Uint8Array {
  if (buf.totalBytes === 0) return new Uint8Array(0);
  if (buf.chunks.length === 1) {
    const single = buf.chunks[0]!;
    buf.chunks.length = 0;
    buf.totalBytes = 0;
    return single;
  }
  const out = new Uint8Array(buf.totalBytes);
  let offset = 0;
  for (const chunk of buf.chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  buf.chunks.length = 0;
  buf.totalBytes = 0;
  return out;
}
