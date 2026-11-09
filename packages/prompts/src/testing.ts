import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import { stringWidth } from "@crustjs/style";

import type { TerminalIO } from "./core/renderer.ts";

const namedKeys = {
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
} as const;

export type NamedKey = keyof typeof namedKeys;

/**
 * Key argument for `keys()` / {@link encodeKey}: named keys get editor
 * autocomplete; `ctrl+<letter>` and single printable characters stay legal.
 */
export type Key = NamedKey | `ctrl+${string}` | (string & {});

function isNamedKey(key: Key): key is NamedKey {
	return Object.hasOwn(namedKeys, key);
}

/**
 * Encode a named terminal key as its raw input sequence.
 *
 * Accepts names from the key table, `ctrl+<letter>` combinations, and single
 * printable characters. Anything else throws — silently typing a misspelled
 * key name (e.g. `"pageup"`) into the prompt would corrupt the test input.
 */
export function encodeKey(key: Key): string {
	if (isNamedKey(key)) return namedKeys[key];

	const ctrl = /^ctrl\+([a-z])$/i.exec(key);
	if (ctrl?.[1]) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);

	if (key.length === 1) return key;

	throw new Error(
		`Unsupported key name: ${JSON.stringify(key)}. Use one of ${Object.keys(namedKeys).join(", ")}, ctrl+<letter>, a single character, or type() for literal text.`,
	);
}

class FakeTerminal {
	// One cell per column; a wide character's second column holds "".
	private readonly lines: string[][] = [[]];
	private row = 0;
	// Equal to `columns` after the last column is written: the wrap waits for the next character.
	private column = 0;
	private readonly graphemes = new Intl.Segmenter();
	// An escape sequence cut off at the end of a write, completed by the next one.
	private pending = "";

	constructor(private readonly columns: number) {}

	write(chunk: string): void {
		const text = this.pending + chunk;
		this.pending = "";
		let index = 0;
		while (index < text.length) {
			const rest = text.slice(index);
			// oxlint-disable-next-line no-control-regex -- parsing ANSI CSI sequences
			const escape = /^\x1B\[([0-?]*)([ -/]*)([@-~])/.exec(rest);
			if (escape) {
				this.handleEscape(escape[1] ?? "", escape[3] ?? "");
				index += escape[0].length;
				continue;
			}
			// oxlint-disable-next-line no-control-regex -- OSC sequences (hyperlinks) occupy no columns
			const osc = /^\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/.exec(rest);
			if (osc) {
				index += osc[0].length;
				continue;
			}

			// oxlint-disable-next-line no-control-regex -- an unterminated CSI or OSC prefix
			if (/^\x1B(?:\[[0-?]*[ -/]*|\][^\x07\x1B]*\x1B?)?$/.test(rest)) {
				this.pending = rest;
				return;
			}

			const char = text[index] ?? "";
			if (char === "\r") {
				this.column = 0;
				index++;
			} else if (char === "\n") {
				this.row++;
				this.column = 0;
				this.ensureLine();
				index++;
			} else {
				// Segment the printable run so wide and combined characters land in whole cells.
				// oxlint-disable-next-line no-control-regex -- stop at the next escape or line break
				const run = /^[^\x1B\r\n]+/.exec(rest)?.[0] ?? char;
				for (const { segment } of this.graphemes.segment(run)) this.writeChar(segment);
				index += run.length;
			}
		}
	}

	screen(): string {
		let last = this.lines.length - 1;
		while (last > 0 && this.lines[last]?.length === 0) last--;
		return this.lines
			.slice(0, last + 1)
			.map((cells) => cells.join(""))
			.join("\n");
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
			this.lines[this.row] = (this.lines[this.row] ?? []).slice(0, this.column);
			this.lines.length = this.row + 1;
		} else if (command === "K") {
			this.lines[this.row] = [];
		}
	}

	private writeChar(char: string): void {
		const width = stringWidth(char);
		this.ensureLine();
		if (width === 0) {
			const cells = this.lines[this.row] ?? [];
			// After a wide character the previous cell is its "" marker; the mark belongs to its first cell.
			const target = cells[this.column - 1] === "" ? this.column - 2 : this.column - 1;
			if (target >= 0) cells[target] = `${cells[target] ?? ""}${char}`;
			return;
		}
		if (this.column + width > this.columns) {
			this.row++;
			this.column = 0;
			this.ensureLine();
		}
		const cells = this.lines[this.row] ?? [];
		while (cells.length < this.column) cells.push(" ");
		// Overwriting either half of a wide character ("" marks its second cell) blanks the other half.
		if (cells[this.column] === "") cells[this.column - 1] = " ";
		if (cells[this.column + width] === "") cells[this.column + width] = " ";
		cells[this.column] = char;
		if (width === 2) cells[this.column + 1] = "";
		this.column += width;
	}

	private ensureLine(): void {
		while (this.lines.length <= this.row) this.lines.push([]);
	}
}

export interface PromptTestIO {
	readonly io: Required<Pick<TerminalIO, "input" | "output">>;
	type(text: string): void;
	keys(...namedKeys: Key[]): void;
	screen(): string;
}

class TestInput extends PassThrough {
	readonly isTTY: boolean;
	isRaw = false;

	constructor(isTTY: boolean) {
		super();
		this.isTTY = isTTY;
	}

	setRawMode(mode: boolean): this {
		this.isRaw = mode;
		return this;
	}
}

/** Create fake TTY streams for testing prompts or applications that render prompts. */
export function createPromptIO({ isTTY = true }: { isTTY?: boolean } = {}): PromptTestIO {
	const input = new TestInput(isTTY);

	const columns = 80;
	const terminal = new FakeTerminal(columns);
	const output = Object.assign(
		new Writable({
			write(chunk, _encoding, callback) {
				terminal.write(chunk.toString());
				callback();
			},
		}),
		{ columns, isTTY },
	);

	return {
		io: { input, output },
		type: (text) => input.write(text),
		keys: (...keys) => {
			for (const key of keys) input.write(encodeKey(key));
		},
		screen: () => stripVTControlCharacters(terminal.screen()),
	};
}

export interface RenderedPrompt<Answer> {
	type(text: string): void;
	keys(...namedKeys: Key[]): void;
	screen(): string;
	readonly answer: Promise<Answer>;
}

/** Run a prompt function against fake TTY streams and expose terminal-style controls. */
export function renderPrompt<Options, Answer>(
	prompt: (options: Options, io?: TerminalIO) => Promise<Answer>,
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
