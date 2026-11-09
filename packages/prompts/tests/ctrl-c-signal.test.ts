import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { beforeAll, describe, expect, it } from "vite-plus/test";

// Raw mode needs a real terminal on process.stdin, so a Bun driver runs the probe in a PTY.
const promptsPkg = resolve(import.meta.dirname, "..");
const bun = which("bun");

beforeAll(() => {
	if (!existsSync(join(promptsPkg, "dist/index.js"))) {
		throw new Error("Build @crustjs/prompts first (pnpm run build:pkgs).");
	}
});

const PROBE = `import { input } from ${JSON.stringify(join(promptsPkg, "dist/index.js"))};
// Like Crust's execute(): the SIGINT owner aborts the signal the prompt was given.
const controller = new AbortController();
if (process.env.OWNER) {
	process.on("SIGINT", () => {
		console.log("owner got SIGINT");
		controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
	});
}
try {
	await input({ message: "Name?" }, { signal: controller.signal });
} catch (error) {
	console.log(\`rejected \${error.name}: \${error.message}\`);
}
await new Promise((resolve) => setTimeout(resolve, 100));
`;

const DRIVER = `let out = "";
let sent = false;
const proc = Bun.spawn([process.env.RUNTIME, "--input-type=module", "--eval", process.env.PROBE], {
	terminal: {
		cols: 80,
		rows: 24,
		data(terminal, data) {
			out += new TextDecoder().decode(data);
			if (!sent && out.includes("Name?")) {
				sent = true;
				terminal.write("\\x03");
			}
		},
	},
});
const code = await proc.exited;
console.log(JSON.stringify({ code, signal: proc.signalCode, out }));
`;

function ctrlC(
	runtime: string,
	owner: boolean,
): { code: number; signal: string | null; out: string } {
	const result = spawnSync(bun!, ["-e", DRIVER], {
		encoding: "utf8",
		env: { ...process.env, PROBE, RUNTIME: runtime, ...(owner && { OWNER: "1" }) },
		timeout: 15_000,
	});
	return JSON.parse(result.stdout);
}

const runtimes = bun ? [bun, ...(which("node") ? ["node"] : [])] : [];

describe.skipIf(!bun || process.platform === "win32").each(runtimes)(
	"Ctrl+C in a prompt (%s)",
	(runtime) => {
		// Node delivers a self-sent signal on a later turn, so the prompt must wait for the owner.
		it("delivers SIGINT to the owner and rejects with the owner's abort reason", () => {
			const { code, out } = ctrlC(runtime, true);
			expect(out).toContain("owner got SIGINT");
			expect(out).toContain("rejected AbortError: Interrupted by SIGINT.");
			expect(code).toBe(0);
		});

		it("only rejects when nothing owns SIGINT", () => {
			const { code, signal, out } = ctrlC(runtime, false);
			expect(out).toContain("rejected AbortError: Prompt was cancelled.");
			expect(out).not.toContain("owner got SIGINT");
			expect({ code, signal }).toEqual({ code: 0, signal: null });
		});
	},
);
