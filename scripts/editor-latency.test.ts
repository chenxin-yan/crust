import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	appendEditorProbe,
	measureEditorLatency,
	median,
	offsetToPosition,
	probePositions,
} from "./editor-latency.ts";
import { generateConsumerFixture } from "./type-perf-report.ts";

const repoRoot = resolve(import.meta.dir, "..");

describe("editor latency helpers", () => {
	it("converts offsets to LSP positions", () => {
		expect(offsetToPosition("ab\ncd", 0)).toEqual({ line: 0, character: 0 });
		expect(offsetToPosition("ab\ncd", 4)).toEqual({ line: 1, character: 1 });
	});

	it("computes medians for odd and even sample counts", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(() => median([])).toThrow("at least one sample");
	});

	it("appends the probe idempotently and locates cursor positions", () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "crust-editor-probe-"));
		try {
			generateConsumerFixture(fixtureDir, join(repoRoot, "packages/core"), 10);
			const file = appendEditorProbe(fixtureDir);
			const once = readFileSync(file, "utf8");
			appendEditorProbe(fixtureDir);
			expect(readFileSync(file, "utf8")).toBe(once);

			const positions = probePositions(once);
			const lines = once.split("\n");
			expect(lines[positions.completion.line]!.slice(0, positions.completion.character)).toEndWith(
				"void flags.",
			);
			expect(lines[positions.hover.line]!.slice(positions.hover.character)).toStartWith(
				"editorProbeBuilder",
			);
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});
});

describe("LspClient", () => {
	it("lets the process exit once requests settle, without waiting for their timeouts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-lsp-client-test-"));
		try {
			// Fake stdio LSP server: answer every request id with an empty result.
			// Payloads are ASCII, so string length equals byte length.
			const server = join(dir, "server.ts");
			writeFileSync(
				server,
				`const decoder = new TextDecoder();
				let buffer = "";
				for await (const chunk of Bun.stdin.stream()) {
					buffer += decoder.decode(chunk);
					for (;;) {
						const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
						if (headerEnd === -1) break;
						const length = Number(/Content-Length: (\\d+)/i.exec(buffer.slice(0, headerEnd))[1]);
						const bodyStart = headerEnd + 4;
						if (buffer.length < bodyStart + length) break;
						const message = JSON.parse(buffer.slice(bodyStart, bodyStart + length));
						buffer = buffer.slice(bodyStart + length);
						if (message.id === undefined) continue;
						const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} });
						process.stdout.write(\`Content-Length: \${body.length}\\r\\n\\r\\n\${body}\`);
					}
				}`,
			);
			const driver = join(dir, "driver.ts");
			writeFileSync(
				driver,
				`import { LspClient } from ${JSON.stringify(join(repoRoot, "scripts/editor-latency.ts"))};
				const client = new LspClient(["bun", ${JSON.stringify(server)}], ${JSON.stringify(dir)});
				const response = await client.request("initialize", { capabilities: {} }, 600_000);
				if (!response.result) throw new Error("fake server returned no result");
				await client.close();`,
			);

			// A leaked referenced timer would hold the driver until its 600s deadline;
			// the spawn timeout kills it instead, surfacing a non-zero exit.
			const proc = Bun.spawn(["bun", driver], {
				cwd: dir,
				stdout: "ignore",
				stderr: "pipe",
				timeout: 10_000,
			});
			const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 20_000);
});

describe("editor latency measurement (LSP integration)", () => {
	it("measures completion/hover round-trips against the native LSP", async () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "crust-editor-latency-test-"));
		try {
			generateConsumerFixture(fixtureDir, join(repoRoot, "packages/core"), 10);
			const metrics = await measureEditorLatency(
				fixtureDir,
				join(repoRoot, "node_modules/.bin/tsc"),
				2,
			);
			for (const value of Object.values(metrics)) {
				expect(value).toBeGreaterThan(0);
				expect(Number.isFinite(value)).toBe(true);
			}
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 60_000);
});
