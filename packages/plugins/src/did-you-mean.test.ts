import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import {
	type AutoCompletePluginOptions,
	autoCompletePlugin,
	type DidYouMeanPluginOptions,
	didYouMeanPlugin,
} from "./index.ts";

let stderrChunks: string[];
let stdoutChunks: string[];
let originalError: typeof console.error;
let originalLog: typeof console.log;
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
	stderrChunks = [];
	stdoutChunks = [];
	originalError = console.error;
	originalLog = console.log;
	originalExitCode = process.exitCode;
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((a) => String(a)).join(" "));
	};
	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((a) => String(a)).join(" "));
	};
});

afterEach(() => {
	console.error = originalError;
	console.log = originalLog;
	process.exitCode = originalExitCode;
});

describe("didYouMeanPlugin", () => {
	it("suggests the closest command on a typo (smoke test)", async () => {
		const app = new Crust("app")
			.use(didYouMeanPlugin())
			.command("build", (cmd) => cmd.run(() => {}))
			.command("test", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["buld"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "buld"');
		expect(stderr).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});

	it("deprecated autoCompletePlugin export is the same reference as didYouMeanPlugin", () => {
		expect(autoCompletePlugin).toBe(didYouMeanPlugin);
	});

	it("deprecated AutoCompletePluginOptions type is structurally compatible with DidYouMeanPluginOptions", () => {
		// Compile-time alias check: assign in both directions.
		const a: AutoCompletePluginOptions = { mode: "help" };
		const b: DidYouMeanPluginOptions = a;
		const c: AutoCompletePluginOptions = b;
		expect(c.mode).toBe("help");
	});
});
