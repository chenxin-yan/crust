import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { which } from "@crustjs/utils/process";
import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vite-plus/test";

// The spinner animates on stderr while the task logs to stdout, both on one PTY.
// Tests run on Node, which has no PTY, so a Bun fixture records the bytes and
// xterm replays them into a screen.
const bun = which("bun")!;
const fixtures = join(import.meta.dirname, "fixtures");

async function screenAfter(columns: number, message: string): Promise<string> {
	const run = spawnSync(
		bun,
		[
			join(fixtures, "run-in-terminal.ts"),
			String(columns),
			bun,
			join(fixtures, "log-while-spinning.ts"),
			message,
		],
		{ encoding: "utf8", timeout: 30_000 },
	);
	if (run.status !== 0) {
		throw new Error(
			`PTY fixture failed (status ${run.status}, signal ${run.signal}):\n${run.stderr}`,
		);
	}
	const { exitCode, output } = JSON.parse(run.stdout) as {
		exitCode: number | null;
		output: string;
	};
	expect(exitCode).toBe(0);

	const terminal = new Terminal({ cols: columns, rows: 20, allowProposedApi: true });
	try {
		await new Promise<void>((resolve) => terminal.write(output, resolve));
		// Join rows the terminal wrapped, so each entry is one logical line.
		let screen = "";
		for (let index = 0; index < terminal.buffer.active.length; index++) {
			const line = terminal.buffer.active.getLine(index);
			screen += (line?.isWrapped ? "" : "\n") + (line?.translateToString(true) ?? "");
		}
		return screen.trim();
	} finally {
		terminal.dispose();
	}
}

describe("spinner in a pseudo-terminal", () => {
	it.each([
		["a one-row message", 40, "Building"],
		["a message wider than the terminal", 20, "Building a message wider than the terminal"],
	])("keeps a line the task logs mid-spin with %s", async (_, columns, message) => {
		const screen = await screenAfter(columns, message);

		expect(screen.split("\n")).toContainEqual(expect.stringMatching(/downloaded$/));
		expect(screen.split("\n").at(-1)).toBe(`✓ ${message}`);
	});
});
