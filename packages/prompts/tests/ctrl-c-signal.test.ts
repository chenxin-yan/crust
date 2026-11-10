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

const utilsTerminal = join(promptsPkg, "../utils/dist/terminal.js");

// OWNER=crust: like Crust's execute(), a SIGINT listener aborts the process-wide terminal signal.
// OWNER=foreign: a SIGINT listener outside execute(), such as signal-exit.
const PROBE = `import { input } from ${JSON.stringify(join(promptsPkg, "dist/index.js"))};
import { withProcessTerminalSignal } from ${JSON.stringify(utilsTerminal)};
const controller = new AbortController();
process.on("SIGINT", () => {
	console.log("owner got SIGINT");
	controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
});
const prompt = () => input({ message: "Name?" });
try {
	if (process.env.OWNER === "crust") await withProcessTerminalSignal(controller.signal, prompt);
	else await prompt();
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
	owner: "crust" | "foreign",
): { code: number; signal: string | null; out: string } {
	const result = spawnSync(bun!, ["-e", DRIVER], {
		encoding: "utf8",
		env: { ...process.env, PROBE, RUNTIME: runtime, OWNER: owner },
		timeout: 15_000,
	});
	return JSON.parse(result.stdout);
}

const runtimes = bun ? [bun, ...(which("node") ? ["node"] : [])] : [];

describe.skipIf(!bun || process.platform === "win32").each(runtimes)(
	"Ctrl+C in a prompt (%s)",
	(runtime) => {
		it("inside execute(), hands Ctrl+C to the SIGINT owner and rejects with its abort reason", () => {
			const { code, out } = ctrlC(runtime, "crust");
			expect(out).toContain("owner got SIGINT");
			expect(out).toContain("rejected AbortError: Interrupted by SIGINT.");
			expect(code).toBe(0);
		});

		it("outside execute(), leaves a foreign SIGINT listener alone and only rejects", () => {
			const { code, signal, out } = ctrlC(runtime, "foreign");
			expect(out).toContain("rejected AbortError: Prompt was cancelled.");
			expect(out).not.toContain("owner got SIGINT");
			expect({ code, signal }).toEqual({ code: 0, signal: null });
		});
	},
);
