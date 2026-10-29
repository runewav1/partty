/**
 * Reader side of the per-session PTY output rings in WebView2 shared memory
 * (see `src-tauri/src/shared_ring.rs` for the layout).
 *
 * Rust posts each ring once per `pty_ensure` via `sharedbufferreceived`, then
 * sends coalesced `{ parttyRings: [[ringId, writePos], ...] }` web messages.
 * Bytes are copied out on notification and acknowledged immediately, so xterm
 * never holds a view into memory Rust may overwrite.
 */

/** Notices for rings whose buffer has not arrived yet; bounded against leaks. */
const MAX_EARLY_NOTICES = 64;

type Ring = {
	readonly id: number;
	readonly sessionId: string;
	readonly buffer: ArrayBuffer;
	/** Word 0 is the read position Rust waits on. */
	readonly header: Uint32Array;
	readonly data: Uint8Array;
	readPos: number;
};

type RingAnnouncement = {
	parttyRing: number;
	sessionId: string;
	dataOffset: number;
	dataLength: number;
};

type RingMessage = {
	parttyRings?: [ringId: number, writePos: number][];
	parttyRingsClosed?: number[];
};

export type SharedRingRegistry = {
	receiveBuffer: (buffer: ArrayBuffer, additionalData: unknown) => void;
	receiveMessage: (data: unknown) => void;
	ringCount: () => number;
};

function openRing(buffer: ArrayBuffer, info: unknown): Ring | null {
	const a = info as Partial<RingAnnouncement> | null;
	if (typeof a?.parttyRing !== "number" || typeof a.sessionId !== "string") {
		return null;
	}
	const { dataOffset = 0, dataLength = 0 } = a;
	const powerOfTwo = dataLength > 0 && (dataLength & (dataLength - 1)) === 0;
	if (
		!powerOfTwo ||
		dataOffset < 4 ||
		buffer.byteLength < dataOffset + dataLength
	) {
		return null;
	}
	return {
		id: a.parttyRing,
		sessionId: a.sessionId,
		buffer,
		header: new Uint32Array(buffer, 0, 1),
		data: new Uint8Array(buffer, dataOffset, dataLength),
		readPos: 0,
	};
}

/**
 * Copy `[readPos, writePos)` out of the ring and acknowledge it. A position
 * further ahead than the ring can hold means the reader lost sync; skip to it
 * so Rust is never left waiting on a full ring.
 */
function takeRingBytes(ring: Ring, writePos: number): Uint8Array | null {
	const target = writePos >>> 0;
	const avail = (target - ring.readPos) >>> 0;
	if (avail === 0) return null;
	let out: Uint8Array | null = null;
	if (avail <= ring.data.length) {
		const start = ring.readPos & (ring.data.length - 1);
		const first = Math.min(avail, ring.data.length - start);
		out = new Uint8Array(avail);
		out.set(ring.data.subarray(start, start + first));
		out.set(ring.data.subarray(0, avail - first), first);
	}
	ring.readPos = target;
	Atomics.store(ring.header, 0, target);
	return out;
}

export function createSharedRingRegistry(opts: {
	onBytes: (sessionId: string, bytes: Uint8Array) => void;
	release: (buffer: ArrayBuffer) => void;
}): SharedRingRegistry {
	const rings = new Map<number, Ring>();
	const earlyNotices = new Map<number, number>();

	/** Rust writes to a session's rings strictly in creation order. */
	const releaseThrough = (sessionId: string, maxId: number): void => {
		for (const ring of [...rings.values()]) {
			if (ring.sessionId === sessionId && ring.id <= maxId) {
				rings.delete(ring.id);
				opts.release(ring.buffer);
			}
		}
	};

	const applyNotice = (ring: Ring, writePos: number): void => {
		releaseThrough(ring.sessionId, ring.id - 1);
		const bytes = takeRingBytes(ring, writePos);
		if (bytes) opts.onBytes(ring.sessionId, bytes);
	};

	return {
		receiveBuffer(buffer, additionalData) {
			const ring = openRing(buffer, additionalData);
			if (!ring) {
				opts.release(buffer);
				return;
			}
			rings.set(ring.id, ring);
			const early = earlyNotices.get(ring.id);
			if (early !== undefined) {
				earlyNotices.delete(ring.id);
				applyNotice(ring, early);
			}
		},
		receiveMessage(data) {
			const msg = (data ?? {}) as RingMessage;
			for (const [ringId, writePos] of msg.parttyRings ?? []) {
				const ring = rings.get(ringId);
				if (ring) applyNotice(ring, writePos);
				else if (earlyNotices.size < MAX_EARLY_NOTICES)
					earlyNotices.set(ringId, writePos);
			}
			for (const ringId of msg.parttyRingsClosed ?? []) {
				earlyNotices.delete(ringId);
				const ring = rings.get(ringId);
				if (ring) releaseThrough(ring.sessionId, ring.id);
			}
		},
		ringCount: () => rings.size,
	};
}

type ChromeWebView = {
	addEventListener(
		type: "sharedbufferreceived",
		listener: (event: {
			additionalData: unknown;
			getBuffer(): ArrayBuffer;
		}) => void,
	): void;
	addEventListener(
		type: "message",
		listener: (event: { data: unknown }) => void,
	): void;
	releaseBuffer(buffer: ArrayBuffer): void;
};

/** Route ring output to `onBytes`; a no-op outside WebView2. */
export function installSharedRings(
	onBytes: (sessionId: string, bytes: Uint8Array) => void,
): void {
	const webview = (globalThis as { chrome?: { webview?: ChromeWebView } })
		.chrome?.webview;
	if (!webview) return;
	const registry = createSharedRingRegistry({
		onBytes,
		release: (buffer) => webview.releaseBuffer(buffer),
	});
	webview.addEventListener("sharedbufferreceived", (event) =>
		registry.receiveBuffer(event.getBuffer(), event.additionalData),
	);
	webview.addEventListener("message", (event) =>
		registry.receiveMessage(event.data),
	);
}
