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

	it("deprecated autoCompletePlugin preserves the legacy plugin name", () => {
		expect(didYouMeanPlugin().name).toBe("did-you-mean");
		expect(autoCompletePlugin().name).toBe("autocomplete");
	});

	it("deprecated autoCompletePlugin behaves identically to didYouMeanPlugin at runtime", async () => {
		const app = new Crust("app")
			.use(autoCompletePlugin())
			.command("build", (cmd) => cmd.run(() => {}))
			.command("test", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["buld"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "buld"');
		expect(stderr).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});

	it("deprecated AutoCompletePluginOptions type is structurally compatible with DidYouMeanPluginOptions", () => {
		// Compile-time alias check: assign in both directions.
		const a: AutoCompletePluginOptions = { mode: "help" };
		const b: DidYouMeanPluginOptions = a;
		const c: AutoCompletePluginOptions = b;
		expect(c.mode).toBe("help");
	});

	// ──────────────────────────────────────────────────────────────────────────────
	// alias-aware suggestions (TP-016)
	// ──────────────────────────────────────────────────────────────────────────────

	it("suggests the canonical name when the input matches an alias", async () => {
		const app = new Crust("app")
			.use(didYouMeanPlugin())
			.command("issue", (cmd) =>
				cmd.meta({ aliases: ["issues", "i"] }).run(() => {}),
			)
			.command("version", (cmd) => cmd.run(() => {}));

		// "issuess" is closest to the alias "issues" (distance 1) than to
		// "issue" (distance 2). The plugin must report the canonical name
		// regardless of which spelling triggered the match.
		await app.execute({ argv: ["issuess"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "issuess"');
		expect(stderr).toContain('Did you mean "issue"?');
		expect(stderr).not.toContain('Did you mean "issues"?');
		expect(process.exitCode).toBe(1);
	});

	it("suggests the canonical name unchanged when the typo is closest to the canonical", async () => {
		const app = new Crust("app")
			.use(didYouMeanPlugin())
			.command("issue", (cmd) =>
				cmd.meta({ aliases: ["issues", "i"] }).run(() => {}),
			);

		await app.execute({ argv: ["isue"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Did you mean "issue"?');
	});

	it("prefers the closer canonical over a short colliding alias", async () => {
		// Regression: the typo "insall" must suggest "install" (Lev 1), not
		// "issue" via its 1-char alias "i". A short alias must not win simply
		// because it is a prefix of the input.
		const app = new Crust("app")
			.use(didYouMeanPlugin())
			.command("issue", (cmd) => cmd.meta({ aliases: ["i"] }).run(() => {}))
			.command("install", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["insall"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Did you mean "install"?');
		expect(stderr).not.toContain('Did you mean "issue"?');
	});

	it("lists only canonical names under 'Available commands'", async () => {
		const app = new Crust("app")
			.use(didYouMeanPlugin())
			.command("issue", (cmd) =>
				cmd.meta({ aliases: ["issues", "i"] }).run(() => {}),
			)
			.command("version", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["completely-unknown"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain("Available commands: issue, version");
		expect(stderr).not.toContain("issues");
	});

	it("deduplicates suggestions when an alias and its canonical both match", async () => {
		const app = new Crust("app")
			.use(didYouMeanPlugin({ mode: "help" }))
			.command("issue", (cmd) =>
				cmd.meta({ aliases: ["issues"] }).run(() => {}),
			);

		// Both the canonical "issue" and the alias "issues" are within
		// Levenshtein distance 3 of "issuee". The first suggestion line
		// must contain only one mention of "issue" (canonical) and never
		// the alias.
		await app.execute({ argv: ["issuee"] });

		const stdout = stdoutChunks.join("\n");
		expect(stdout).toContain('Unknown command "issuee". Did you mean "issue"?');
		expect(stdout).not.toContain('Did you mean "issues"');
	});
});
