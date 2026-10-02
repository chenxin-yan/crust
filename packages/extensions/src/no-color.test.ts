import { stripVTControlCharacters } from "node:util";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { help } from "./help.ts";
import { noColor } from "./no-color.ts";

const stripAnsi = stripVTControlCharacters;
const originalStdoutIsTTY = process.stdout.isTTY;

beforeEach(() => {
	// Ambient NO_COLOR/FORCE_COLOR (e.g. CI runners) must not leak into the
	// color-flag tests.
	vi.stubEnv("NO_COLOR", undefined);
	vi.stubEnv("FORCE_COLOR", undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
});

describe("noColor", () => {
	it("noColor injects --color and --no-color into help output", async () => {
		const app = new Crust("app")
			.extend(noColor())
			.extend(help())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		const { stdout } = await captureExecute(app, ["--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("--color, --no-color");
	});

	it("noColor disables color but preserves modifiers on a TTY", async () => {
		// `--no-color` → NO_COLOR=1: colors off, modifiers keep following
		// TTY detection (no-color.org). Mock a TTY so the modifier half of
		// the contract is observable regardless of the test runner's stdout.
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const app = new Crust("app").extend(noColor()).extend(help());

		const { stdout: output } = await captureExecute(app, ["--help", "--no-color"]);
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
		expect(output).toContain("\x1b[1mUsage:\x1b[22m");
	});

	it("noColor overrides NO_COLOR with --color", async () => {
		vi.stubEnv("NO_COLOR", "1");

		const app = new Crust("app").extend(noColor()).extend(help());

		const { stdout: output } = await captureExecute(app, ["--help", "--color"]);
		expect(output).toContain("\x1b[36m");
		expect(output).toContain("\x1b[1m");
	});

	it("noColor --color clears NO_COLOR during the run and restores it after", async () => {
		vi.stubEnv("NO_COLOR", "1");
		let seenNoColor: string | undefined = "unset";

		const app = new Crust("app").extend(noColor()).action(() => {
			seenNoColor = process.env.NO_COLOR;
		});

		await captureExecute(app, ["--color"]);

		expect(seenNoColor).toBeUndefined();
		expect(process.env.NO_COLOR).toBe("1");
	});

	it("noColor fails fast when an overlapping run uses the opposing flag", async () => {
		const { promise: blockA, resolve: releaseA } = Promise.withResolvers<void>();
		let ranB = false;

		const appA = new Crust("a").extend(noColor()).action(() => blockA);
		const appB = new Crust("b").extend(noColor()).action(() => {
			ranB = true;
		});

		// A (--color) starts and stays pending; B (--no-color) must be rejected
		// in preRun rather than flipping the shared env under A.
		const runA = captureExecute(appA, ["--color"]);
		const runB = await captureExecute(appB, ["--no-color"]);

		expect(runB.exitCode).toBe(1);
		expect(ranB).toBe(false);
		expect(runB.stderr).toContain("cannot start a --color run while a --no-color run is in flight");
		expect(process.env.FORCE_COLOR).toBe("3");
		expect(process.env.NO_COLOR).toBeUndefined();

		releaseA();
		expect((await runA).exitCode).toBe(0);
		expect(process.env.FORCE_COLOR).toBeUndefined();
		expect(process.env.NO_COLOR).toBeUndefined();

		// The rejected run must not have pinned the direction: the opposite
		// flag works again once the in-flight run has finished.
		expect((await captureExecute(appB, ["--no-color"])).exitCode).toBe(0);
		expect(ranB).toBe(true);
	});

	it("noColor allows overlapping same-direction runs and restores env after both", async () => {
		vi.stubEnv("NO_COLOR", "1");

		const { promise: blockA, resolve: releaseA } = Promise.withResolvers<void>();
		let seenNoColorB: string | undefined = "unset";

		const appA = new Crust("a").extend(noColor()).action(() => blockA);
		const appB = new Crust("b").extend(noColor()).action(() => {
			seenNoColorB = process.env.NO_COLOR;
		});

		const runA = captureExecute(appA, ["--color"]);
		expect((await captureExecute(appB, ["--color"])).exitCode).toBe(0);
		expect(seenNoColorB).toBeUndefined();
		// A is still in flight, so the override must survive B finishing.
		expect(process.env.FORCE_COLOR).toBe("3");
		expect(process.env.NO_COLOR).toBeUndefined();

		releaseA();
		expect((await runA).exitCode).toBe(0);
		expect(process.env.FORCE_COLOR).toBeUndefined();
		expect(process.env.NO_COLOR).toBe("1");
	});

	it("noColor respects NO_COLOR without explicit --color flag", async () => {
		vi.stubEnv("NO_COLOR", "1");

		const app = new Crust("app").extend(noColor()).extend(help());

		const { stdout: output } = await captureExecute(app, ["--help"]);
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
	});

	it("noColor overrides ambient FORCE_COLOR during help and restores it after", async () => {
		vi.stubEnv("FORCE_COLOR", "3");

		const app = new Crust("app").extend(noColor()).extend(help());

		const { stdout } = await captureExecute(app, ["--help", "--no-color"]);

		expect(process.env.FORCE_COLOR).toBe("3");
		expect(process.env.NO_COLOR).toBeUndefined();
		expect(stdout).not.toContain("\x1b[36m");
		expect(stdout).not.toContain("\x1b[33m");
	});

	it("noColor flag is recursive on subcommands", async () => {
		const app = new Crust("app")
			.extend(noColor())
			.extend(help())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		const { stdout } = await captureExecute(app, ["build", "--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("--color, --no-color");
	});
});
