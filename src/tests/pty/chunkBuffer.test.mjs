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

test("input chunks accumulate in order and each drain clears the pending input", () => {
	const buf = createStringChunkBuffer();
	pushStringChunk(buf, "");
	assert.equal(buf.chunks.length, 0);
	assert.equal(buf.totalChars, 0);

	pushStringChunk(buf, "ab");
	pushStringChunk(buf, "cde");
	assert.equal(buf.totalChars, 5);
	assert.equal(drainStringChunks(buf), "abcde");
	assert.equal(buf.totalChars, 0);
	assert.equal(drainStringChunks(buf), "");

	pushStringChunk(buf, "solo");
	assert.equal(drainStringChunks(buf), "solo");
	assert.equal(drainStringChunks(buf), "");
});

test("output drains in order and can hand off a lone chunk without copying", () => {
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

	const single = Uint8Array.from([7, 8, 9]);
	pushByteChunk(buf, single);

	assert.equal(drainByteChunks(buf), single);
	assert.equal(peekByteChunkBytes(buf), 0);
});
