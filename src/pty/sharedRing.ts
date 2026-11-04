/**
 * Reader side of the per-session PTY output rings in WebView2 shared memory
 * (see `src-tauri/src/shared_ring.rs` for the layout).
 *
 * Rust posts each ring once per `pty_ensure` via `sharedbufferreceived`, then
 * sends coalesced `{ parttyRings: [[ringId, writePos], ...] }` web messages.
 * Bytes are copied out on notification, so xterm never holds a view into
 * memory Rust may overwrite.
 *
 * Flow control: acknowledging a read is what frees ring space for Rust. Once
 * a session has `FLOW_HIGH_BYTES` handed to xterm but not yet parsed,
 * acknowledgements pause until parsing (reported via `consumed`) brings it
 * under `FLOW_LOW_BYTES`. The full ring then stalls Rust's reader, the pipe
 * and finally the shell, instead of xterm's write queue growing unbounded.
 */

/** Notices for rings whose buffer has not arrived yet; bounded against leaks. */
const MAX_EARLY_NOTICES = 64;
const FLOW_HIGH_BYTES = 1024 * 1024;
const FLOW_LOW_BYTES = 256 * 1024;
/** A hold with no parse progress for this long is assumed lost and lifted. */
const FLOW_STALL_MS = 1000;

type Ring = {
	readonly id: number;
	readonly sessionId: string;
	readonly buffer: ArrayBuffer;
	/** Word 0 is the read position Rust waits on. */
	readonly header: Uint32Array;
	readonly data: Uint8Array;
	readPos: number;
	/** Set on the first notice, once older rings of the session are released. */
	live: boolean;
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

type Flow = {
	/** Bytes handed to `onBytes` that xterm has not reported parsed. */
	unparsed: number;
	held: boolean;
	stall: ReturnType<typeof setTimeout> | undefined;
};

export type SharedRingRegistry = {
	receiveBuffer: (buffer: ArrayBuffer, additionalData: unknown) => void;
	receiveMessage: (data: unknown) => void;
	/** `bytes` delivered for `sessionId` were parsed (or dropped). */
	consumed: (sessionId: string, bytes: number) => void;
	/** Lift every hold, e.g. when the page is hidden and parsing throttles. */
	releaseAll: () => void;
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
		live: false,
	};
}

/**
 * Copy `[readPos, writePos)` out of the ring. A position further ahead than
 * the ring can hold means the reader lost sync; skip to it so Rust is never
 * left waiting on a full ring.
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
	return out;
}

/** Free everything read so far for Rust to overwrite. */
function acknowledge(ring: Ring): void {
	Atomics.store(ring.header, 0, ring.readPos);
}

export function createSharedRingRegistry(opts: {
	onBytes: (sessionId: string, bytes: Uint8Array) => void;
	release: (buffer: ArrayBuffer) => void;
	/** False while parsing may be throttled (hidden page): never hold. */
	flowControl: () => boolean;
}): SharedRingRegistry {
	const rings = new Map<number, Ring>();
	const earlyNotices = new Map<number, number>();
	const flows = new Map<string, Flow>();

	/** Rust writes to a session's rings strictly in creation order. */
	const releaseThrough = (sessionId: string, maxId: number): void => {
		for (const ring of [...rings.values()]) {
			if (ring.sessionId === sessionId && ring.id <= maxId) {
				rings.delete(ring.id);
				opts.release(ring.buffer);
			}
		}
	};

	const lift = (sessionId: string, flow: Flow): void => {
		flow.held = false;
		clearTimeout(flow.stall);
		for (const ring of rings.values()) {
			if (ring.sessionId === sessionId) acknowledge(ring);
		}
	};

	const armStall = (sessionId: string, flow: Flow): void => {
		clearTimeout(flow.stall);
		flow.stall = setTimeout(() => {
			flow.unparsed = 0;
			lift(sessionId, flow);
		}, FLOW_STALL_MS);
	};

	const applyNotice = (ring: Ring, writePos: number): void => {
		if (!ring.live) {
			ring.live = true;
			releaseThrough(ring.sessionId, ring.id - 1);
		}
		const bytes = takeRingBytes(ring, writePos);
		let flow = flows.get(ring.sessionId);
		if (!flow) {
			flow = { unparsed: 0, held: false, stall: undefined };
			flows.set(ring.sessionId, flow);
		}
		if (bytes) flow.unparsed += bytes.length;
		if (!flow.held && flow.unparsed >= FLOW_HIGH_BYTES && opts.flowControl()) {
			flow.held = true;
			armStall(ring.sessionId, flow);
		}
		if (!flow.held) acknowledge(ring);
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
				if (!ring) continue;
				releaseThrough(ring.sessionId, ring.id);
				clearTimeout(flows.get(ring.sessionId)?.stall);
				flows.delete(ring.sessionId);
			}
		},
		consumed(sessionId, bytes) {
			const flow = flows.get(sessionId);
			if (!flow) return;
			flow.unparsed = Math.max(0, flow.unparsed - bytes);
			if (!flow.held) return;
			if (flow.unparsed <= FLOW_LOW_BYTES) lift(sessionId, flow);
			else armStall(sessionId, flow);
		},
		releaseAll() {
			for (const [sessionId, flow] of flows) {
				if (flow.held) lift(sessionId, flow);
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

/**
 * Route ring output to `onBytes`; returns null outside WebView2. The caller
 * must report every delivered byte through `consumed` once xterm parsed it.
 */
export function installSharedRings(
	onBytes: (sessionId: string, bytes: Uint8Array) => void,
): SharedRingRegistry | null {
	const webview = (globalThis as { chrome?: { webview?: ChromeWebView } })
		.chrome?.webview;
	if (!webview) return null;
	// Hidden pages throttle timers, and with them xterm's parsing: holding
	// output then would stall background shells, so never hold while hidden.
	const registry = createSharedRingRegistry({
		onBytes,
		release: (buffer) => webview.releaseBuffer(buffer),
		flowControl: () => !document.hidden,
	});
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) registry.releaseAll();
	});
	webview.addEventListener("sharedbufferreceived", (event) =>
		registry.receiveBuffer(event.getBuffer(), event.additionalData),
	);
	webview.addEventListener("message", (event) =>
		registry.receiveMessage(event.data),
	);
	return registry;
}
