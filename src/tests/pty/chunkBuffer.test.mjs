/**
 * Deterministic unit tests for the append-only chunk buffers
 * (src/pty/chunkBuffer.ts).
 *
 * The buffer exists to avoid O(n²) concat during PTY streaming, so the tests
 * pin the contract the streaming code depends on: pushes accumulate totals,
 * `drain` returns chunks in order exactly once, and the single-chunk drain
 * stays zero-copy. Pure and synchronous; no DOM, timers or mocks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const {
	createStringChunkBuffer,
	pushStringChunk,
	drainStringChunks,
	createByteChunkBuffer,
	pushByteChunk,
	peekByteChunkBytes,
	drainByteChunks,
} = await import("../../pty/chunkBuffer.ts");

test("string buffer accumulates totals and ignores empty pushes", () => {
	const buf = createStringChunkBuffer();
	assert.equal(buf.totalChars, 0);
	pushStringChunk(buf, "");
	assert.equal(buf.chunks.length, 0);
	assert.equal(buf.totalChars, 0);

	pushStringChunk(buf, "ab");
	pushStringChunk(buf, "cde");
	assert.equal(buf.totalChars, 5);
	assert.equal(buf.chunks.length, 2);
});

test("string drain joins in order once and resets the buffer", () => {
	const buf = createStringChunkBuffer();
	pushStringChunk(buf, "foo");
	pushStringChunk(buf, "bar");
	pushStringChunk(buf, "baz");

	assert.equal(drainStringChunks(buf), "foobarbaz");
	assert.equal(buf.totalChars, 0);
	assert.equal(buf.chunks.length, 0);
	assert.equal(drainStringChunks(buf), "");
});

test("string drain of a single chunk returns the stored value", () => {
	const buf = createStringChunkBuffer();
	pushStringChunk(buf, "solo");
	assert.equal(drainStringChunks(buf), "solo");
	assert.equal(drainStringChunks(buf), "");
});

test("byte buffer reports pending bytes and drains concatenated in order", () => {
	const buf = createByteChunkBuffer();
	assert.equal(peekByteChunkBytes(buf), 0);
	pushByteChunk(buf, new Uint8Array());
	assert.equal(peekByteChunkBytes(buf), 0);

	pushByteChunk(buf, Uint8Array.from([1, 2]));
	pushByteChunk(buf, Uint8Array.from([3]));
	pushByteChunk(buf, Uint8Array.from([4, 5]));
	assert.equal(peekByteChunkBytes(buf), 5);

	assert.deepEqual(Array.from(drainByteChunks(buf)), [1, 2, 3, 4, 5]);
	assert.equal(peekByteChunkBytes(buf), 0);
	assert.deepEqual(Array.from(drainByteChunks(buf)), []);
});

test("single-chunk byte drain is zero-copy", () => {
	const buf = createByteChunkBuffer();
	const single = Uint8Array.from([7, 8, 9]);
	pushByteChunk(buf, single);

	assert.equal(drainByteChunks(buf), single);
	assert.equal(buf.totalBytes, 0);
});
