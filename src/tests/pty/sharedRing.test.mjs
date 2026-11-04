/**
 * Unit tests for the shared-memory PTY output ring reader
 * (src/pty/sharedRing.ts).
 *
 * Buffers are built here with the layout Rust writes (read position at word
 * 0, data at `OFFSET`), so the tests pin the reader contract through the
 * registry: wrap-around copies, read acknowledgement, flow control, early
 * notices, ring replacement and close. Synchronous; the stall watchdog runs
 * on mocked timers.
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

const { createSharedRingRegistry } = await import("../../pty/sharedRing.ts");

const OFFSET = 64;

function makeRing(id, sessionId, dataLength = 8) {
	const buffer = new ArrayBuffer(OFFSET + dataLength);
	const readWord = new Uint32Array(buffer, 0, 1);
	const data = new Uint8Array(buffer, OFFSET, dataLength);
	let write = 0;
	return {
		buffer,
		info: { parttyRing: id, sessionId, dataOffset: OFFSET, dataLength },
		readPos: () => readWord[0],
		/** Mimic the Rust writer (no flow control; tests stay within bounds). */
		write(bytes) {
			for (const b of bytes) {
				data[write & (dataLength - 1)] = b;
				write = (write + 1) >>> 0;
			}
			return write;
		},
		seek(pos) {
			write = pos >>> 0;
		},
		/** Write `n` bytes without caring about their contents. */
		advance(n) {
			write = (write + n) >>> 0;
			return write;
		},
	};
}

const MiB = 1024 * 1024;

function makeRegistry({ flowControl = () => true } = {}) {
	const delivered = [];
	const released = [];
	const registry = createSharedRingRegistry({
		onBytes: (sessionId, bytes) =>
			delivered.push([
				sessionId,
				bytes.length <= 64 ? [...bytes] : bytes.length,
			]),
		release: (buffer) => released.push(buffer),
		flowControl,
	});
	const notify = (ringId, pos) =>
		registry.receiveMessage({ parttyRings: [[ringId, pos]] });
	return { registry, delivered, released, notify };
}

test("routes bytes to the ring's session and acknowledges them", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	registry.receiveBuffer(a.buffer, a.info);
	notify(1, a.write([65, 66]));
	assert.deepEqual(delivered, [["a", [65, 66]]]);
	assert.equal(a.readPos(), 2);
	notify(1, 2);
	assert.equal(delivered.length, 1);
});

function heldSession(opts) {
	const reg = makeRegistry(opts);
	const a = makeRing(1, "a", 4 * MiB);
	reg.registry.receiveBuffer(a.buffer, a.info);
	reg.notify(1, a.advance(MiB));
	return { ...reg, a };
}

test("holds acknowledgements past the high mark until parsing catches up", () => {
	const { registry, delivered, a } = heldSession();
	assert.deepEqual(delivered, [["a", MiB]], "bytes are still delivered");
	assert.equal(a.readPos(), 0, "ring space is not freed while xterm lags");
	registry.consumed("a", 512 * 1024);
	assert.equal(a.readPos(), 0, "still above the low mark");
	registry.consumed("a", 300 * 1024);
	assert.equal(a.readPos(), MiB, "below the low mark frees everything read");
});

test("never holds while flow control is off", () => {
	const { a } = heldSession({ flowControl: () => false });
	assert.equal(a.readPos(), MiB);
});

test("releaseAll lifts every hold", () => {
	const { registry, a } = heldSession();
	registry.releaseAll();
	assert.equal(a.readPos(), MiB);
});

test("a hold without parse progress lifts itself", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const { a } = heldSession();
		mock.timers.tick(999);
		assert.equal(a.readPos(), 0);
		mock.timers.tick(1);
		assert.equal(a.readPos(), MiB);
	} finally {
		mock.timers.reset();
	}
});

test("parse progress keeps a legitimate hold armed", () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const { registry, a } = heldSession();
		mock.timers.tick(900);
		registry.consumed("a", 64 * 1024);
		mock.timers.tick(900);
		assert.equal(a.readPos(), 0, "progress re-armed the stall timer");
	} finally {
		mock.timers.reset();
	}
});

test("copies across the wrap point", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	registry.receiveBuffer(a.buffer, a.info);
	notify(1, a.write([0, 0, 0, 0, 0, 0]));
	notify(1, a.write([1, 2, 3, 4, 5]));
	assert.deepEqual(delivered[1], ["a", [1, 2, 3, 4, 5]]);
	assert.equal(a.readPos(), 11);
});

test("delivers copies rather than views into ring memory", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	registry.receiveBuffer(a.buffer, a.info);
	notify(1, a.write([7, 7]));
	a.write([9, 9, 9, 9, 9, 9, 9, 9]);
	assert.deepEqual(delivered, [["a", [7, 7]]]);
});

test("skips ahead without delivering when the reader lost sync", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	registry.receiveBuffer(a.buffer, a.info);
	notify(1, 100);
	assert.deepEqual(delivered, []);
	assert.equal(a.readPos(), 100);
});

test("positions survive u32 wraparound", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	registry.receiveBuffer(a.buffer, a.info);
	a.seek(0xffff_fffe);
	notify(1, 0xffff_fffe);
	notify(1, a.write([1, 2, 3, 4]));
	assert.deepEqual(delivered, [["a", [1, 2, 3, 4]]]);
	assert.equal(a.readPos(), 2);
});

test("applies a notice that arrived before its buffer", () => {
	const { registry, delivered, notify } = makeRegistry();
	const a = makeRing(1, "a");
	notify(1, a.write([1, 2, 3]));
	assert.deepEqual(delivered, []);
	registry.receiveBuffer(a.buffer, a.info);
	assert.deepEqual(delivered, [["a", [1, 2, 3]]]);
});

test("ignores foreign messages and releases invalid ring buffers", () => {
	const { registry, delivered, released } = makeRegistry();
	registry.receiveMessage("hello");
	registry.receiveMessage(null);
	const bad = makeRing(1, "a", 6);
	registry.receiveBuffer(bad.buffer, bad.info);
	assert.deepEqual(delivered, []);
	assert.deepEqual(released, [bad.buffer]);
	assert.equal(registry.ringCount(), 0);
});

test("replacement ring keeps the old one until the new one is used", () => {
	const { registry, delivered, released, notify } = makeRegistry();
	const old = makeRing(1, "a");
	const next = makeRing(2, "a");
	registry.receiveBuffer(old.buffer, old.info);
	registry.receiveBuffer(next.buffer, next.info);
	notify(1, old.write([1]));
	assert.deepEqual(released, []);
	notify(2, next.write([2]));
	assert.deepEqual(released, [old.buffer]);
	assert.deepEqual(delivered, [
		["a", [1]],
		["a", [2]],
	]);
	assert.equal(registry.ringCount(), 1);
});

test("close releases the session's rings but not other sessions'", () => {
	const { registry, released } = makeRegistry();
	const a1 = makeRing(1, "a");
	const a2 = makeRing(2, "a");
	const b = makeRing(3, "b");
	for (const r of [a1, a2, b]) registry.receiveBuffer(r.buffer, r.info);
	registry.receiveMessage({ parttyRingsClosed: [2] });
	assert.deepEqual(released, [a1.buffer, a2.buffer]);
	assert.equal(registry.ringCount(), 1);
});
