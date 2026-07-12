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
