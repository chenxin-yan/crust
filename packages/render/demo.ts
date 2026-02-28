// ────────────────────────────────────────────────────────────────────────────
// @crustjs/render demo
// Run: bun packages/render/demo.ts
//      bun --cwd packages/render run demo
// ────────────────────────────────────────────────────────────────────────────

import { stripAnsi } from "@crustjs/style";
import {
	applyTypingFrame,
	createTypingMarkdownRenderer,
	renderMarkdown,
	renderMarkdownTypingStream,
} from "./src/index.ts";

type DemoMode = "static" | "stream" | "both";
type StreamProfile = "fixed" | "char" | "llm";

interface DemoOptions {
	mode: DemoMode;
	streamProfile: StreamProfile;
	width: number;
	chunkSize: number;
	delayMs: number;
	seed: number;
	filePath?: string;
	noColor: boolean;
	traceWrites: boolean;
}

const DEFAULT_MARKDOWN = `# Render Demo

This is a **static vs streaming** rendering demo.

Typing probe (intentionally tricky while streaming):
**sdfsdf sdfdfd
still typing plain text...
and now closed** done.

- bullet one
- bullet two

1. ordered one
2. ordered two

- [x] finished task
- [ ] pending task

| Name  | Role      | Score |
| :---- | :-------- | ----: |
| Alice | Maintainer|    98 |
| Bob   | Reviewer  |    87 |

> Streaming should flush stable blocks as chunks arrive.

\`\`\`ts
const ok = true;
console.log(ok);
\`\`\`
`;

function parseArgs(argv: string[]): DemoOptions {
	const options: DemoOptions = {
		mode: "both",
		streamProfile: "llm",
		width: 72,
		chunkSize: 1,
		delayMs: 90,
		seed: 42,
		noColor: false,
		traceWrites: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === "--mode") {
			const value = argv[i + 1];
			if (value === "static" || value === "stream" || value === "both") {
				options.mode = value;
				i++;
			}
			continue;
		}

		if (arg === "--width") {
			const value = Number.parseInt(argv[i + 1] ?? "", 10);
			if (Number.isFinite(value) && value > 0) {
				options.width = value;
				i++;
			}
			continue;
		}

		if (arg === "--chunk-size") {
			const value = Number.parseInt(argv[i + 1] ?? "", 10);
			if (Number.isFinite(value) && value > 0) {
				options.chunkSize = value;
				i++;
			}
			continue;
		}

		if (arg === "--delay") {
			const value = Number.parseInt(argv[i + 1] ?? "", 10);
			if (Number.isFinite(value) && value >= 0) {
				options.delayMs = value;
				i++;
			}
			continue;
		}

		if (arg === "--profile") {
			const value = argv[i + 1];
			if (value === "fixed" || value === "char" || value === "llm") {
				options.streamProfile = value;
				i++;
			}
			continue;
		}

		if (arg === "--seed") {
			const value = Number.parseInt(argv[i + 1] ?? "", 10);
			if (Number.isFinite(value)) {
				options.seed = value;
				i++;
			}
			continue;
		}

		if (arg === "--file") {
			const value = argv[i + 1];
			if (value) {
				options.filePath = value;
				i++;
			}
			continue;
		}

		if (arg === "--no-color") {
			options.noColor = true;
			continue;
		}

		if (arg === "--trace-writes") {
			options.traceWrites = true;
		}
	}

	return options;
}

async function loadMarkdown(filePath?: string): Promise<string> {
	if (!filePath) return DEFAULT_MARKDOWN;
	return Bun.file(filePath).text();
}

function chunkBySize(input: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < input.length; i += chunkSize) {
		chunks.push(input.slice(i, i + chunkSize));
	}
	return chunks;
}

function createRng(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function tokenizeMarkdown(input: string): string[] {
	return input.match(/```|\*\*|__|~~|\r?\n|[ \t]+|[A-Za-z0-9]+|./g) ?? [];
}

function expandTokensForLlm(tokens: string[], rng: () => number): string[] {
	const expanded: string[] = [];

	for (const token of tokens) {
		if (token === "**" || token === "__" || token === "~~" || token === "```") {
			expanded.push(...token.split(""));
			continue;
		}

		if (/^[A-Za-z0-9]+$/.test(token) && token.length > 5 && rng() < 0.55) {
			let i = 0;
			while (i < token.length) {
				const size = 1 + Math.floor(rng() * 4);
				expanded.push(token.slice(i, i + size));
				i += size;
			}
			continue;
		}

		expanded.push(token);
	}

	return expanded;
}

function chunkLlmLike(input: string, rng: () => number): string[] {
	const tokens = expandTokensForLlm(tokenizeMarkdown(input), rng);
	const chunks: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		let targetTokens = rng() < 0.2 ? 1 : 1 + Math.floor(rng() * 3);
		let chunk = "";

		while (targetTokens > 0 && i < tokens.length) {
			const token = tokens[i] ?? "";
			if (token === "\n" && chunk !== "") {
				break;
			}
			chunk += token;
			i++;
			targetTokens--;
			if (chunk.length >= 12 || token === "\n") {
				break;
			}
		}

		if (chunk) {
			chunks.push(chunk);
		}
	}

	return chunks;
}

function createChunkPlan(markdown: string, options: DemoOptions): string[] {
	if (options.streamProfile === "char") {
		return [...markdown];
	}

	if (options.streamProfile === "fixed") {
		return chunkBySize(markdown, options.chunkSize);
	}

	return chunkLlmLike(markdown, createRng(options.seed));
}

function buildDelayPlan(chunks: string[], options: DemoOptions): number[] {
	if (options.delayMs <= 0) {
		return chunks.map(() => 0);
	}

	const rng = createRng(options.seed ^ 0x9e3779b9);
	const base = options.delayMs;

	return chunks.map((chunk) => {
		let delay = Math.round(base * (0.6 + rng() * 1.6));

		if (options.streamProfile === "llm") {
			if (chunk.includes("\n")) {
				delay += Math.round(base * 0.8);
			}
			if (/[.!?]/.test(chunk)) {
				delay += Math.round(base * 1.1);
			}
			if (rng() < 0.08) {
				delay += Math.round(base * (3 + rng() * 7));
			}
			if (rng() < 0.18) {
				delay = Math.max(0, Math.round(delay * 0.2));
			}
		}

		return Math.max(0, delay);
	});
}

function stripTerminalCsi(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		const next = text.charCodeAt(i + 1);
		if (ch === 27 && next === 91) {
			i += 2;
			while (i < text.length) {
				const code = text.charCodeAt(i);
				if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
					break;
				}
				i++;
			}
			continue;
		}
		out += text[i] ?? "";
	}
	return out;
}

async function collect(source: AsyncIterable<string>): Promise<string> {
	let output = "";
	for await (const delta of source) {
		output += delta;
	}
	return output;
}

function collectCommittedTypingOutput(
	markdown: string,
	options: DemoOptions,
): string {
	const renderer = createTypingMarkdownRenderer({
		width: options.width,
		style: { mode: options.noColor ? "never" : "auto" },
	});

	let output = "";
	for (const chunk of createChunkPlan(markdown, options)) {
		output += renderer.write(chunk).append;
	}
	output += renderer.end().append;
	return output;
}

async function* asyncChunks(
	chunks: string[],
	delays: number[],
): AsyncIterable<string> {
	for (const [index, chunk] of chunks.entries()) {
		yield chunk;
		const delay = delays[index] ?? 0;
		if (delay > 0) {
			await Bun.sleep(delay);
		}
	}
}

async function runStatic(
	markdown: string,
	options: DemoOptions,
): Promise<string> {
	console.log("\n--- Static Render ---\n");
	const output = renderMarkdown(markdown, {
		width: options.width,
		style: { mode: options.noColor ? "never" : "auto" },
	});
	process.stdout.write(output);
	process.stdout.write("\n");
	return output;
}

async function runStream(
	markdown: string,
	options: DemoOptions,
): Promise<string> {
	console.log("\n--- Streaming Render (createTypingMarkdownRenderer) ---\n");
	if (options.traceWrites) {
		console.log("trace: enabled (shows each write() chunk and frame sizes)\n");
	}
	const chunks = createChunkPlan(markdown, options);
	const delays = buildDelayPlan(chunks, options);
	if (options.traceWrites) {
		console.log(`trace: totalChunks=${chunks.length}`);
	}
	const renderer = createTypingMarkdownRenderer({
		width: options.width,
		style: { mode: options.noColor ? "never" : "auto" },
	});

	let output = "";
	let patchState = {
		previewRows: 0,
		previewStartsWithNewline: false,
	};

	for (const [index, chunk] of chunks.entries()) {
		const frame = renderer.write(chunk);
		const patched = applyTypingFrame(frame, patchState, options.width);
		patchState = patched.state;
		if (options.traceWrites) {
			console.log(
				`[write ${index}] chunk=${JSON.stringify(chunk)} appendLen=${frame.append.length} previewLen=${frame.preview.length} patchLen=${patched.delta.length}`,
			);
		}
		if (patched.delta) {
			process.stdout.write(patched.delta);
			output += patched.delta;
		}
		const delay = delays[index] ?? 0;
		if (delay > 0) {
			await Bun.sleep(delay);
		}
	}

	const finalFrame = renderer.end();
	const finalPatched = applyTypingFrame(finalFrame, patchState, options.width);
	if (finalPatched.delta) {
		process.stdout.write(finalPatched.delta);
		output += finalPatched.delta;
	}

	process.stdout.write("\n");
	return output;
}

async function runStreamWrapper(
	markdown: string,
	options: DemoOptions,
): Promise<string> {
	console.log("\n--- Streaming Render (renderMarkdownTypingStream) ---\n");
	const chunks = createChunkPlan(markdown, options);
	const delays = buildDelayPlan(chunks, options);
	let output = "";

	for await (const delta of renderMarkdownTypingStream(
		asyncChunks(chunks, delays),
		{
			width: options.width,
			style: { mode: options.noColor ? "never" : "auto" },
			terminalPatches: true,
		},
	)) {
		process.stdout.write(delta);
		output += delta;
	}

	process.stdout.write("\n");
	return output;
}

async function main() {
	const options = parseArgs(Bun.argv.slice(2));
	const markdown = await loadMarkdown(options.filePath);

	console.log("=== @crustjs/render Demo ===");
	console.log(
		`mode=${options.mode} profile=${options.streamProfile} width=${options.width} chunkSize=${options.chunkSize} delayMs=${options.delayMs} seed=${options.seed}`,
	);
	if (options.filePath) {
		console.log(`file=${options.filePath}`);
	}

	let staticOut = "";
	let streamOut = "";
	let streamWrapperOut = "";

	if (options.mode === "static" || options.mode === "both") {
		staticOut = await runStatic(markdown, options);
	}

	if (options.mode === "stream") {
		streamOut = await runStream(markdown, options);
	}

	if (options.mode === "both") {
		streamOut = await runStream(markdown, options);
		streamWrapperOut = await runStreamWrapper(markdown, options);
	}

	if (options.mode === "both") {
		const staticPlain = stripAnsi(staticOut);
		const streamPlain = stripAnsi(
			collectCommittedTypingOutput(markdown, options),
		);
		const wrapperPlain = stripAnsi(
			await collect(
				renderMarkdownTypingStream(
					asyncChunks(createChunkPlan(markdown, options), []),
					{
						width: options.width,
						style: { mode: options.noColor ? "never" : "auto" },
						terminalPatches: false,
					},
				),
			),
		);
		const patchedVisibleLen =
			stripTerminalCsi(stripAnsi(streamOut)).length +
			stripTerminalCsi(stripAnsi(streamWrapperOut)).length;
		console.log("\n--- Determinism Check ---");
		console.log(
			`static === createTypingMarkdownRenderer: ${staticPlain === streamPlain ? "PASS" : "FAIL"}`,
		);
		console.log(
			`static === renderMarkdownTypingStream: ${staticPlain === wrapperPlain ? "PASS" : "FAIL"}`,
		);
		console.log(`patched visible chars emitted: ${patchedVisibleLen}`);
	}

	console.log("\nDone.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
