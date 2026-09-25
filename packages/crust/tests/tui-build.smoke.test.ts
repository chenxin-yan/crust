import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { which } from "@crustjs/utils/process";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import { BUN_TARGETS } from "../src/utils/build-helpers.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";
import { hostTarget } from "./helpers.ts";

// Opt-in (CRUST_TUI_SMOKE=1): installs pinned OpenTUI packages from npm into a
// temp project and drives the compiled binaries in a pseudo-terminal. The Solid
// build needs `crust.bunPlugins: ["@opentui/solid/bun-plugin"]`; core needs no
// plugin. The project's bunfig preload stays in place during the build and at
// runtime.
const enabled = process.env.CRUST_TUI_SMOKE === "1" && process.platform !== "win32";
// Allocated in beforeAll so skipped runs leave no crust-tui-smoke-* directory behind.
let fixtureDir = "";
const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

const OPENTUI_VERSION = "0.5.11";
const SOLID_VERSION = "1.9.12";

const FIXTURE_PACKAGE_JSON = {
	name: "tui-smoke",
	version: "0.1.0",
	private: true,
	type: "module",
	dependencies: {
		"@opentui/core": OPENTUI_VERSION,
		"@opentui/solid": OPENTUI_VERSION,
		"solid-js": SOLID_VERSION,
	},
};

/** Stages the fixture with `bin: { [command]: entry }` and `crust.bunPlugins`; returns the host binary path. */
async function buildFixture(command: string, entry: string, bunPlugins: string[]): Promise<string> {
	const target = hostTarget();
	if (!target) throw new Error(`Unsupported smoke-test host: ${process.platform}-${process.arch}`);
	writeFileSync(
		join(fixtureDir, "package.json"),
		JSON.stringify(
			{ ...FIXTURE_PACKAGE_JSON, bin: { [command]: entry }, crust: { bunPlugins } },
			null,
			2,
		),
	);
	const originalCwd = process.cwd;
	process.cwd = () => fixtureDir;
	try {
		const result = await captureExecute(new Crust("test").add(buildCommand), [
			"build",
			"--target",
			"host",
		]);
		if (result.exitCode !== 0) throw new Error(result.stderr);
	} finally {
		process.cwd = originalCwd;
	}
	return join(fixtureDir, ".crust", BUN_TARGETS.info[target].alias, "bin", `${command}-${target}`);
}

const terminalFixture = join(import.meta.dirname, "fixtures", "run-in-terminal.ts");

/** Runs `binary` in a Bun pseudo-terminal (via the fixture), presses `q` once `readyMarker` renders. */
function runInTerminal(
	binary: string,
	readyMarker: string,
): { exitCode: number | null; output: string } {
	// The fixture waits up to 10s for the marker and 6s for exit, then kills the binary.
	const run = spawnSync(which("bun")!, [terminalFixture, binary, readyMarker, fixtureDir], {
		encoding: "utf8",
		timeout: 30_000,
	});
	if (run.status !== 0) {
		throw new Error(
			`PTY fixture failed (status ${run.status}, signal ${run.signal}):\n${run.stderr}`,
		);
	}
	return JSON.parse(run.stdout) as { exitCode: number | null; output: string };
}

describe.skipIf(!enabled)("crust build OpenTUI smoke (CRUST_TUI_SMOKE=1)", () => {
	beforeAll(async () => {
		fixtureDir = mkdtempSync(join(tmpdir(), "crust-tui-smoke-"));
		writeFileSync(join(fixtureDir, "package.json"), JSON.stringify(FIXTURE_PACKAGE_JSON, null, 2));
		writeFileSync(join(fixtureDir, "bunfig.toml"), 'preload = ["@opentui/solid/preload"]\n');
		writeFileSync(
			join(fixtureDir, "tsconfig.json"),
			JSON.stringify(
				{ compilerOptions: { jsx: "preserve", jsxImportSource: "@opentui/solid", strict: true } },
				null,
				2,
			),
		);
		// SOLID_REACTIVE_OK only appears when a signal-driven <Show> switches, which
		// requires the Solid transform; Bun's native JSX leaves the tree static.
		writeFileSync(
			join(fixtureDir, "solid.tsx"),
			`import { Crust } from ${JSON.stringify(corePath)};
import { createCliRenderer } from "@opentui/core";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, Show } from "solid-js";

function App() {
  const [tick, setTick] = createSignal(0);
  const renderer = useRenderer();
  const timer = setInterval(() => setTick((t) => t + 1), 250);
  onCleanup(() => clearInterval(timer));
  useKeyboard((key) => {
    if (key.name === "q") renderer.destroy();
  });
  return (
    <box flexDirection="column">
      <text>SOLID_MOUNTED tick={tick()}</text>
      <text>{tick() >= 2 ? "second line switched" : ""}</text>
      <Show when={tick() >= 2}>
        <text>SOLID_REACTIVE_OK</text>
      </Show>
    </box>
  );
}

await new Crust("solid-smoke")
  .action(async () => {
    let settle!: () => void;
    const destroyed = new Promise<void>((resolve) => (settle = resolve));
    const renderer = await createCliRenderer({ exitOnCtrlC: true, onDestroy: () => settle() });
    render(() => <App />, renderer);
    await destroyed;
  })
  .execute();
`,
		);
		writeFileSync(
			join(fixtureDir, "core.ts"),
			`import { Crust } from ${JSON.stringify(corePath)};
import { createCliRenderer, TextRenderable } from "@opentui/core";

await new Crust("core-smoke")
  .action(async () => {
    let settle!: () => void;
    const destroyed = new Promise<void>((resolve) => (settle = resolve));
    const renderer = await createCliRenderer({ exitOnCtrlC: true, onDestroy: () => settle() });
    let tick = 0;
    const text = new TextRenderable(renderer, { id: "t", content: "CORE_MOUNTED tick=0" });
    const marker = new TextRenderable(renderer, { id: "m", content: "" });
    renderer.root.add(text);
    renderer.root.add(marker);
    const timer = setInterval(() => {
      tick += 1;
      text.content = \`CORE_MOUNTED tick=\${tick}\`;
      if (tick >= 2) marker.content = "CORE_REACTIVE_OK";
    }, 250);
    renderer.on("destroy", () => clearInterval(timer));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q") renderer.destroy();
    });
    await destroyed;
  })
  .execute();
`,
		);

		const install = await runBoundedProcess(which("bun")!, ["install", "--minimum-release-age=0"], {
			cwd: fixtureDir,
			env: { ...process.env, BUN_BE_BUN: "1" },
			timeout: 170_000,
		});
		if (install.exitCode !== 0) throw new Error(`bun install failed:\n${install.stderr}`);
	}, 180_000);

	// beforeAll's bun install is reaped before the fixture goes.
	afterAll(async () => {
		await reapBoundedProcesses();
		rmSync(fixtureDir, { recursive: true, force: true });
	});

	it("compiles a Solid app with crust.bunPlugins @opentui/solid/bun-plugin and runs it reactively", async () => {
		const outfile = await buildFixture("solid-smoke", "solid.tsx", ["@opentui/solid/bun-plugin"]);

		const { exitCode, output } = runInTerminal(outfile, "SOLID_REACTIVE_OK");
		expect(output).toContain("SOLID_MOUNTED");
		expect(output).toContain("SOLID_REACTIVE_OK");
		expect(output).not.toContain("Orphan text");
		expect(exitCode).toBe(0);
	}, 120_000);

	it("compiles a core app without plugins and runs it reactively", async () => {
		const outfile = await buildFixture("core-smoke", "core.ts", []);

		const { exitCode, output } = runInTerminal(outfile, "CORE_REACTIVE_OK");
		expect(output).toContain("CORE_REACTIVE_OK");
		expect(exitCode).toBe(0);
	}, 120_000);
});
