import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Editor-latency benchmark: drives the TypeScript native LSP (`tsc --lsp
 * --stdio`) through a scripted editing session against a synthetic consumer
 * fixture, timing the request round-trips an editor user actually feels —
 * completion after `flags.`, hover on a mid-chain builder, and completion
 * right after a keystroke edit.
 */

export interface EditorLatencyMetrics {
	/** didOpen → first completion response (program construction included) */
	coldCompletionMs: number;
	/** Median warm completion round-trip */
	completionMs: number;
	/** Median warm hover round-trip on a mid-chain builder value */
	hoverMs: number;
	/** Median didChange (insert a flag def) → completion round-trip */
	editCompletionMs: number;
}

const PROBE_MARKER = "// editor-latency probe";

/**
 * Append the deterministic probe snippet to a fixture's consumer.ts.
 * Idempotent; returns the updated file path.
 */
export function appendEditorProbe(fixtureDir: string): string {
	const file = join(resolve(fixtureDir), "consumer.ts");
	const text = readFileSync(file, "utf8");
	if (!text.includes(PROBE_MARKER)) {
		writeFileSync(
			file,
			`${text}\n${PROBE_MARKER}\nconst editorProbeBuilder = new Crust("editor-probe")\n\t.flags({ name: "alpha", type: "boolean", short: "a" })\n\t.flags({ name: "beta", type: "string" });\nexport const editorProbeApp = editorProbeBuilder\n\t.action(({ flags }) => {\n\t\tvoid flags.beta;\n\t});\n`,
		);
	}
	return file;
}

interface Position {
	line: number;
	character: number;
}

export function offsetToPosition(text: string, offset: number): Position {
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, character: offset - lineStart };
}

/** Cursor positions inside the probe snippet, computed from file content. */
export function probePositions(text: string): {
	completion: Position;
	hover: Position;
	editInsert: Position;
} {
	const completionAnchor = "void flags.";
	const completionIndex = text.lastIndexOf(completionAnchor);
	const hoverAnchor = "= editorProbeBuilder";
	const hoverIndex = text.indexOf(hoverAnchor);
	const editAnchor = "\t.action(({ flags }) => {";
	const editIndex = text.lastIndexOf(editAnchor);
	if (completionIndex === -1 || hoverIndex === -1 || editIndex === -1) {
		throw new Error("consumer.ts is missing the editor-latency probe snippet");
	}
	return {
		completion: offsetToPosition(text, completionIndex + completionAnchor.length),
		hover: offsetToPosition(text, hoverIndex + 2),
		editInsert: offsetToPosition(text, editIndex),
	};
}

export function median(samples: readonly number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const value = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	return Math.round(value * 10) / 10;
}

interface LspMessage {
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

/** Minimal JSON-RPC/LSP client over stdio with Content-Length framing. */
class LspClient {
	private readonly proc: ReturnType<typeof Bun.spawn>;
	private readonly pending = new Map<number, (message: LspMessage) => void>();
	private nextId = 1;
	private buffer = new Uint8Array(0);

	constructor(command: string[], cwd: string) {
		this.proc = Bun.spawn(command, { cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
		void this.readLoop();
	}

	private async readLoop(): Promise<void> {
		const decoder = new TextDecoder();
		for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
			const merged = new Uint8Array(this.buffer.length + chunk.length);
			merged.set(this.buffer);
			merged.set(chunk, this.buffer.length);
			this.buffer = merged;
			for (;;) {
				const text = decoder.decode(this.buffer);
				const headerEnd = text.indexOf("\r\n\r\n");
				if (headerEnd === -1) break;
				const lengthMatch = text.slice(0, headerEnd).match(/Content-Length: (\d+)/i);
				if (!lengthMatch) throw new Error("LSP frame without Content-Length");
				const bodyStart = new TextEncoder().encode(text.slice(0, headerEnd + 4)).length;
				const bodyLength = Number(lengthMatch[1]);
				if (this.buffer.length < bodyStart + bodyLength) break;
				const body = decoder.decode(this.buffer.slice(bodyStart, bodyStart + bodyLength));
				this.buffer = this.buffer.slice(bodyStart + bodyLength);
				this.dispatch(JSON.parse(body) as LspMessage);
			}
		}
	}

	private dispatch(message: LspMessage): void {
		if (message.id !== undefined && message.method !== undefined) {
			// Server → client request. Answer generically so the session
			// proceeds; workspace/configuration expects one entry per item.
			const items = (message.params as { items?: unknown[] } | undefined)?.items;
			const result =
				message.method === "workspace/configuration" && Array.isArray(items)
					? items.map(() => null)
					: null;
			void this.send({ jsonrpc: "2.0", id: message.id, result });
			return;
		}
		if (message.id !== undefined) {
			const resolver = this.pending.get(message.id as number);
			if (resolver) {
				this.pending.delete(message.id as number);
				resolver(message);
			}
		}
		// Notifications (diagnostics, logs) are irrelevant to timing; drop them.
	}

	private async send(payload: unknown): Promise<void> {
		const body = new TextEncoder().encode(JSON.stringify(payload));
		const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
		const stdin = this.proc.stdin as import("bun").FileSink;
		void stdin.write(header);
		void stdin.write(body);
		await stdin.flush();
	}

	async request(method: string, params: unknown, timeoutMs = 30_000): Promise<LspMessage> {
		const id = this.nextId++;
		const response = new Promise<LspMessage>((resolvePromise, reject) => {
			this.pending.set(id, resolvePromise);
			setTimeout(() => {
				if (this.pending.delete(id))
					reject(new Error(`LSP ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		await this.send({ jsonrpc: "2.0", id, method, params });
		return response;
	}

	async notify(method: string, params: unknown): Promise<void> {
		await this.send({ jsonrpc: "2.0", method, params });
	}

	async close(): Promise<void> {
		try {
			await this.request("shutdown", null, 3_000);
			await this.notify("exit", null);
		} catch {
			// Server already gone or unresponsive during teardown — the process
			// kill below is the actual cleanup.
		}
		this.proc.kill();
	}
}

/**
 * Measure editor round-trip latencies against a generated consumer fixture.
 * The fixture must contain consumer.ts (probe appended automatically) and a
 * tsconfig.json, as produced by `generateConsumerFixture`.
 */
export async function measureEditorLatency(
	fixtureDir: string,
	tscPath: string,
	rounds = 5,
): Promise<EditorLatencyMetrics> {
	const file = appendEditorProbe(fixtureDir);
	let text = readFileSync(file, "utf8");
	let positions = probePositions(text);
	const uri = pathToFileURL(file).href;
	const client = new LspClient([tscPath, "--lsp", "--stdio"], resolve(fixtureDir));

	const timed = async (method: string, params: unknown): Promise<number> => {
		const start = performance.now();
		const response = await client.request(method, params);
		const elapsed = performance.now() - start;
		if (response.error) throw new Error(`LSP ${method} failed: ${response.error.message}`);
		if (response.result === null || response.result === undefined) {
			throw new Error(`LSP ${method} returned no result — probe position is stale`);
		}
		return elapsed;
	};

	try {
		await client.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(resolve(fixtureDir)).href,
			capabilities: {},
		});
		await client.notify("initialized", {});
		let version = 1;
		await client.notify("textDocument/didOpen", {
			textDocument: { uri, languageId: "typescript", version, text },
		});

		const completionParams = () => ({
			textDocument: { uri },
			position: positions.completion,
		});
		const coldCompletionMs = await timed("textDocument/completion", completionParams());

		const completionSamples: number[] = [];
		for (let i = 0; i < rounds; i++) {
			completionSamples.push(await timed("textDocument/completion", completionParams()));
		}

		const hoverSamples: number[] = [];
		for (let i = 0; i < rounds; i++) {
			hoverSamples.push(
				await timed("textDocument/hover", { textDocument: { uri }, position: positions.hover }),
			);
		}

		const editSamples: number[] = [];
		for (let i = 0; i < 3; i++) {
			const insertText = `\t.flags({ name: "gamma-${i}", type: "number" })\n`;
			await client.notify("textDocument/didChange", {
				textDocument: { uri, version: ++version },
				contentChanges: [
					{
						range: { start: positions.editInsert, end: positions.editInsert },
						text: insertText,
					},
				],
			});
			// Keep the local mirror in sync so probe positions track the edits.
			const insertOffset =
				text.split("\n").slice(0, positions.editInsert.line).join("\n").length +
				(positions.editInsert.line > 0 ? 1 : 0);
			text = text.slice(0, insertOffset) + insertText + text.slice(insertOffset);
			positions = probePositions(text);
			editSamples.push(await timed("textDocument/completion", completionParams()));
		}

		return {
			coldCompletionMs: Math.round(coldCompletionMs * 10) / 10,
			completionMs: median(completionSamples),
			hoverMs: median(hoverSamples),
			editCompletionMs: median(editSamples),
		};
	} finally {
		await client.close();
	}
}

if (import.meta.main) {
	const size = Number(process.argv[2] ?? 50);
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { generateConsumerFixture } = await import("./type-perf-report.ts");
	const root = resolve(".");
	const fixtureDir = mkdtempSync(join(tmpdir(), "crust-editor-latency-"));
	try {
		generateConsumerFixture(fixtureDir, join(root, "packages/core"), size);
		const metrics = await measureEditorLatency(fixtureDir, join(root, "node_modules/.bin/tsc"));
		console.log(JSON.stringify(metrics, null, 2));
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
}
