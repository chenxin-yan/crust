//#region write
import { Crust } from "@crustjs/core";

// `ls -1 -0`: names separated by NUL, with no newline at the end.
export const list = new Crust("ls")
	.flags({ null: { type: "boolean", short: "0" } })
	.action(({ flags, stdout }) => {
		const names = ["a.txt", "b.txt"];
		// [!code highlight]
		if (flags.null) stdout.write(names.map((name) => `${name}\0`).join(""));
		else stdout(names.join("\n"));
	});
//#endregion

//#region terminal
const rows = [
	["api", "running"],
	["worker", "stopped"],
];

export const status = new Crust("status").action(({ stdout }) => {
	// [!code highlight:4]
	if (!stdout.isTTY) {
		stdout(rows.map((row) => row.join("\t")).join("\n"));
		return;
	}
	const width = Math.min(stdout.columns ?? 80, 60);
	stdout("NAME".padEnd(width / 2) + "STATE");
	for (const [name, state] of rows) stdout(name.padEnd(width / 2) + state);
});
//#endregion

//#region stdin
import { readFile } from "node:fs/promises";

import { CrustError } from "@crustjs/core";

// `wc -l [file]`: a file, or stdin for `-` or no file.
export const lines = new Crust("wc")
	.args({ name: "file", type: "string" })
	.action(async ({ args, stdin, stdout }) => {
		let text: string;
		if (args.file !== undefined && args.file !== "-") {
			text = await readFile(args.file, "utf8");
		} else {
			// [!code highlight:2]
			if (stdin.isTTY) throw new CrustError("VALIDATION", "Pass a file, or pipe text to stdin.");
			text = await stdin.text();
		}
		stdout(String(text.split("\n").length - 1));
	});
//#endregion

//#region stream
export const upper = new Crust("upper").action(async ({ stdin, stdout }) => {
	const decoder = new TextDecoder();
	// [!code highlight]
	for await (const chunk of stdin.stream()) {
		stdout.write(decoder.decode(chunk, { stream: true }).toUpperCase());
	}
	stdout.write(decoder.decode());
});
//#endregion

//#region pager
import { spawn } from "node:child_process";
import { once } from "node:events";

import type { OutputStream } from "@crustjs/core";

/** Show `text` in `$PAGER` on a terminal; print it as it is anywhere else. */
async function page(text: string, stdout: OutputStream, signal: AbortSignal): Promise<void> {
	const pager = process.env.PAGER ?? "less";
	if (!stdout.isTTY || pager === "" || pager === "cat") return stdout.write(text);
	const child = spawn(pager, {
		shell: true,
		stdio: ["pipe", "inherit", "inherit"],
		env: { LESS: "FRX", ...process.env },
		signal,
	});
	// Quitting the pager early closes the pipe.
	child.stdin.on("error", () => {});
	child.stdin.end(text);
	await once(child, "exit");
}

export const log = new Crust("log").action(async ({ stdout, signal }) => {
	const text = Array.from({ length: 500 }, (_, i) => `line ${i + 1}\n`).join("");
	// [!code highlight]
	await page(text, stdout, signal);
});
//#endregion
