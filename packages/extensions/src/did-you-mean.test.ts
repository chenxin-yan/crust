import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "@crustjs/core";

import { didYouMean } from "./did-you-mean.ts";

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

describe("didYouMean", () => {
	it("suggests the closest command on a typo (smoke test)", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(defineCommand("test", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["buld"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "buld"');
		expect(stderr).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});

	// ──────────────────────────────────────────────────────────────────────────────
	// alias-aware suggestions
	// ──────────────────────────────────────────────────────────────────────────────

	it("suggests the canonical name when the input matches an alias", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("issue", { aliases: ["issues", "i"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("version", (cmd) => cmd.action(() => {})));

		// "issuess" is closest to the alias "issues" (distance 1) than to
		// "issue" (distance 2). The extension must report the canonical name
		// regardless of which spelling triggered the match.
		await app.execute({ argv: ["issuess"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "issuess"');
		expect(stderr).toContain('Did you mean "issue"?');
		expect(stderr).not.toContain('Did you mean "issues"?');
		expect(process.exitCode).toBe(1);
	});

	it("prefers the closer canonical over a short colliding alias", async () => {
		// Regression: the typo "insall" must suggest "install" (Lev 1), not
		// "issue" via its 1-char alias "i". A short alias must not win simply
		// because it is a prefix of the input.
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("issue", { aliases: ["i"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("install", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["insall"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Did you mean "install"?');
		expect(stderr).not.toContain('Did you mean "issue"?');
	});

	it("lists only canonical names under 'Available commands'", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("issue", { aliases: ["issues", "i"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("version", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["completely-unknown"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain("Available commands: issue, version");
		expect(stderr).not.toContain("issues");
	});

	it("deduplicates suggestions when an alias and its canonical both match", async () => {
		const app = new Crust("app")
			.extend(didYouMean({ mode: "help" }))
			.add(defineCommand("issue", { aliases: ["issues"] }, (cmd) => cmd.action(() => {})));

		// Both the canonical "issue" and the alias "issues" are within
		// Levenshtein distance 3 of "issuee". The first suggestion line
		// must contain only one mention of "issue" (canonical) and never
		// the alias.
		await app.execute({ argv: ["issuee"] });

		const stdout = stdoutChunks.join("\n");
		expect(stdout).toContain('Unknown command "issuee". Did you mean "issue"?');
		expect(stdout).not.toContain('Did you mean "issues"');
	});

	it("never suggests a `meta.hidden: true` command, even on a close match", async () => {
		// `__complete` is the textbook hidden-command scenario: it's a
		// real, invocable command but should not surface in user-facing
		// error output. A close typo of it must not produce a suggestion.
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(defineCommand("__complete", { hidden: true }, (cmd) => cmd.action(() => {})));

		// Typo distance(__complet -> __complete) = 1, well within the
		// threshold. Distance(__complet -> build) is > 3, so without the
		// hidden filter the only suggestion would be `__complete`.
		await app.execute({ argv: ["__complet"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "__complet"');
		expect(stderr).not.toContain("__complete");
	});

	it("never suggests a hidden command via one of its aliases", async () => {
		// Hidden filtering must apply to alias matches too, not just the
		// canonical name. If a hidden command has an alias that's close to
		// the typo, it still must not leak.
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(
				defineCommand("__complete", { hidden: true, aliases: ["__comp"] }, (cmd) =>
					cmd.action(() => {}),
				),
			);

		await app.execute({ argv: ["__cmp"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Unknown command "__cmp"');
		expect(stderr).not.toContain("__complete");
		expect(stderr).not.toContain("__comp");
	});

	it("omits hidden commands from the 'Available commands' fallback list", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(defineCommand("test", (cmd) => cmd.action(() => {})))
			.add(defineCommand("__complete", { hidden: true }, (cmd) => cmd.action(() => {})));

		// No close match — we want the "Available commands" line.
		await app.execute({ argv: ["zzzzz"] });

		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain("Available commands: build, test");
		expect(stderr).not.toContain("__complete");
	});
});
