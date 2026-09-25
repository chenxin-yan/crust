import { spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import type { TuiObservation, TuiScenario } from "../tests/fixtures/run-tui.ts";
import { NonInteractiveError, runTui } from "./index.ts";

function asReadStream(stream: PassThrough): NodeJS.ReadStream {
	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- OpenTUI requires a concrete tty.ReadStream type; this fake implements the runtime surface it uses.
	return stream as unknown as NodeJS.ReadStream;
}

const fixture = fileURLToPath(new URL("../tests/fixtures/run-tui.ts", import.meta.url));

/** OpenTUI's native renderer is unavailable on the pinned Node 24, so the scenario runs on Bun. */
function observe(scenario: TuiScenario): TuiObservation {
	const result = spawnSync("bun", [fixture, scenario], { encoding: "utf8", timeout: 10_000 });
	expect(result.status, result.stderr).toBe(0);
	const observation = result.stdout.match(/^OBSERVATION (.+)$/m)?.[1];
	expect(observation, result.stdout).toBeDefined();
	// SAFETY: the fixture prints exactly one serialized TuiObservation.
	return JSON.parse(observation!) as TuiObservation;
}

describe("runTui", () => {
	it("rejects before mounting when stdin is not a TTY", async () => {
		let mounted = false;
		const stdin = Object.assign(new PassThrough(), { isTTY: false });
		const stdout = Object.assign(new Writable({ write() {} }), { isTTY: true });

		await expect(
			runTui(
				() => {
					mounted = true;
				},
				{
					stdin: asReadStream(stdin),
					stdout: stdout as NodeJS.WriteStream,
				},
			),
		).rejects.toBeInstanceOf(NonInteractiveError);
		expect(mounted).toBe(false);
	});

	it("destroys the renderer and rethrows when mounting fails", () => {
		const { outcome, rendererDestroyed } = observe("mount-failure");

		expect(outcome).toMatchObject({ status: "rejected", isMountFailure: true });
		expect(rendererDestroyed).toBe(true);
	});

	it("resolves when the renderer is destroyed", () => {
		expect(observe("destroy-resolves").outcome).toEqual({
			status: "resolved",
			valueType: "undefined",
		});
	});

	it("rejects with AbortError when Ctrl+C destroys the renderer", () => {
		expect(observe("ctrl-c-aborts").outcome).toMatchObject({
			status: "rejected",
			name: "AbortError",
		});
	});

	it("settles on destroy while an async mount is still pending", () => {
		const { outcome, keypressListenersBefore, stdinDataListeners } = observe(
			"destroy-during-pending-mount",
		);

		expect(outcome).toEqual({ status: "resolved", valueType: "undefined" });
		expect(keypressListenersBefore).toBeGreaterThan(0);
		expect(stdinDataListeners).toBe(0);
	});

	it("removes its keypress listener after teardown", () => {
		const { outcome, keypressListenersBefore, keypressListenersAfter } = observe(
			"keypress-listener-teardown",
		);

		expect(outcome).toEqual({ status: "resolved", valueType: "undefined" });
		// OpenTUI's own exitOnCtrlC handler stays; only the adapter's listener is removed.
		expect(keypressListenersAfter).toBe(keypressListenersBefore! - 1);
	});

	it("treats Ctrl+C with extra modifiers as a normal key, not cancellation", () => {
		expect(observe("ctrl-shift-c").outcome).toEqual({
			status: "resolved",
			valueType: "undefined",
		});
	});

	it("detects Ctrl+C through baseCode on non-Latin layouts", () => {
		expect(observe("ctrl-c-base-code").outcome).toMatchObject({
			status: "rejected",
			name: "AbortError",
		});
	});

	it("does not destroy on Ctrl+C when exitOnCtrlC is false", () => {
		const { outcome, rendererDestroyed } = observe("ctrl-c-without-exit");

		expect(outcome).toEqual({ status: "resolved", valueType: "undefined" });
		expect(rendererDestroyed).toBe(true);
	});
});
