import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import type { PromptIO } from "./core/renderer.ts";

/** Remove ANSI control sequences from terminal output. */
export function stripAnsi(text: string): string {
	return stripVTControlCharacters(text);
}

const namedKeys: Record<string, string> = {
	return: "\r",
	enter: "\r",
	backspace: "\x7f",
	delete: "\x1B[3~",
	up: "\x1B[A",
	down: "\x1B[B",
	right: "\x1B[C",
	left: "\x1B[D",
	home: "\x1B[H",
	end: "\x1B[F",
	tab: "\t",
	space: " ",
	escape: "\x1B",
};

/**
 * Encode a named terminal key as its raw input sequence.
 *
 * Accepts names from the key table, `ctrl+<letter>` combinations, and single
 * printable characters. Anything else throws — silently typing a misspelled
 * key name (e.g. `"pageup"`) into the prompt would corrupt the test input.
 */
export function encodeKey(key: string): string {
	if (key in namedKeys) return namedKeys[key] ?? "";

	const ctrl = /^ctrl\+([a-z])$/i.exec(key);
	if (ctrl?.[1]) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);

	if (key.length === 1) return key;

	throw new Error(
		`Unsupported key name: ${JSON.stringify(key)}. Use one of ${Object.keys(namedKeys).join(", ")}, ctrl+<letter>, a single character, or type() for literal text.`,
	);
}

class FakeTerminal {
	private readonly lines = [""];
	private row = 0;
	private column = 0;

	write(text: string): void {
		let index = 0;
		while (index < text.length) {
			// oxlint-disable-next-line no-control-regex -- parsing ANSI CSI sequences
			const escape = /^\x1B\[([0-?]*)([ -/]*)([@-~])/.exec(text.slice(index));
			if (escape) {
				this.handleEscape(escape[1] ?? "", escape[3] ?? "");
				index += escape[0].length;
				continue;
			}

			const char = text[index] ?? "";
			index++;
			if (char === "\r") {
				this.column = 0;
			} else if (char === "\n") {
				this.row++;
				this.column = 0;
				this.ensureLine();
			} else {
				this.writeChar(char);
			}
		}
	}

	screen(): string {
		let last = this.lines.length - 1;
		while (last > 0 && this.lines[last] === "") last--;
		return this.lines.slice(0, last + 1).join("\n");
	}

	private handleEscape(parameters: string, command: string): void {
		const count = Number(parameters.replace(/[^0-9]/g, "")) || 1;
		if (command === "A") {
			this.row = Math.max(0, this.row - count);
		} else if (command === "B") {
			this.row += count;
			this.ensureLine();
		} else if (command === "G") {
			this.column = count - 1;
		} else if (command === "J") {
			this.lines[this.row] = (this.lines[this.row] ?? "").slice(0, this.column);
			this.lines.length = this.row + 1;
		} else if (command === "K") {
			this.lines[this.row] = "";
		}
	}

	private writeChar(char: string): void {
		this.ensureLine();
		const line = this.lines[this.row] ?? "";
		const padding = " ".repeat(Math.max(0, this.column - line.length));
		this.lines[this.row] =
			`${line.slice(0, this.column)}${padding}${char}${line.slice(this.column + 1)}`;
		this.column++;
	}

	private ensureLine(): void {
		while (this.lines.length <= this.row) this.lines.push("");
	}
}

export interface PromptTestIO {
	readonly io: Required<PromptIO>;
	type(text: string): void;
	keys(...namedKeys: string[]): void;
	screen(): string;
	output(): string;
}

/** Create fake TTY streams for testing prompts or applications that render prompts. */
export function createPromptIO({ isTTY = true }: { isTTY?: boolean } = {}): PromptTestIO {
	const input = new PassThrough() as PassThrough & {
		isTTY: boolean;
		isRaw: boolean;
		setRawMode: (mode: boolean) => PassThrough;
	};
	input.isTTY = isTTY;
	input.isRaw = false;
	input.setRawMode = (mode) => {
		input.isRaw = mode;
		return input;
	};

	const terminal = new FakeTerminal();
	let transcript = "";
	const output = new Writable({
		write(chunk, _encoding, callback) {
			const text = chunk.toString();
			transcript += text;
			terminal.write(text);
			callback();
		},
	}) as Writable & { columns: number };
	output.columns = 80;

	return {
		io: { input, output },
		type: (text) => input.write(text),
		keys: (...keys) => {
			for (const key of keys) input.write(encodeKey(key));
		},
		screen: () => stripAnsi(terminal.screen()),
		output: () => transcript,
	};
}

export interface RenderedPrompt<Answer> {
	type(text: string): void;
	keys(...namedKeys: string[]): void;
	screen(): string;
	readonly answer: Promise<Answer>;
}

/** Run a prompt function against fake TTY streams and expose terminal-style controls. */
export function renderPrompt<Options, Answer>(
	prompt: (options: Options, io?: PromptIO) => Promise<Answer>,
	options: Options,
): RenderedPrompt<Answer> {
	const harness = createPromptIO();
	return {
		type: (text) => harness.type(text),
		keys: (...keys) => harness.keys(...keys),
		screen: () => harness.screen(),
		answer: prompt(options, harness.io),
	};
}
