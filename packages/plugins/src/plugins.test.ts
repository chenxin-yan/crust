import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { autoCompletePlugin } from "./autocomplete.ts";
import { helpPlugin } from "./help.ts";
import { versionPlugin } from "./version.ts";

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	process.exitCode = 0;
});

function getStdout() {
	return stdoutChunks.join("\n");
}

function getStderr() {
	return stderrChunks.join("\n");
}

describe("built-in plugins", () => {
	it("help plugin renders generated help for no-run command", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["--help"] });

		const output = getStdout();
		expect(output).toContain("app");
		expect(output).toContain("USAGE:");
		expect(output).toContain("COMMANDS:");
		expect(output).toContain("build");
	});

	it("help plugin shows help instead of error when --help is used with missing required arg", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("create", (cmd) =>
				cmd
					.args([{ name: "name", type: "string", required: true }] as const)
					.run(() => {}),
			);

		await app.execute({ argv: ["create", "--help"] });

		const output = getStdout();
		expect(output).toContain("create");
		expect(output).toContain("USAGE:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin shows help instead of error when --help is used with missing required flag", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("deploy", (cmd) =>
				cmd.flags({ target: { type: "string", required: true } }).run(() => {}),
			);

		await app.execute({ argv: ["deploy", "--help"] });

		const output = getStdout();
		expect(output).toContain("deploy");
		expect(output).toContain("USAGE:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin ignores help-like args after --", async () => {
		let capturedRawArgs: string[] = [];

		const app = new Crust("app")
			.meta({ description: "Test app" })
			.use(helpPlugin())
			.command("build", (cmd) =>
				cmd.run((ctx) => {
					capturedRawArgs = [...ctx.rawArgs];
				}),
			);

		await app.execute({ argv: ["build", "--", "--help"] });

		expect(getStdout()).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("help plugin hides hidden subcommands from commands and usage", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("internal", (cmd) =>
				cmd.meta({ description: "Internal", hidden: true }).run(() => {}),
			);

		await app.execute({ argv: ["--help"] });

		const output = getStdout();
		expect(output).not.toContain("COMMANDS:");
		expect(output).not.toContain("internal");
		expect(output).not.toContain("<command>");
	});

	it("version plugin handles --version", async () => {
		const app = new Crust("app").use(versionPlugin("1.2.3")).run(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v1.2.3");
	});

	it("version plugin handles -v alias", async () => {
		const app = new Crust("app").use(versionPlugin("2.0.0")).run(() => {});

		await app.execute({ argv: ["-v"] });

		expect(getStdout()).toContain("app v2.0.0");
	});

	it("version plugin ignores --version after -- separator", async () => {
		let ran = false;

		const app = new Crust("app").use(versionPlugin("1.0.0")).run(() => {
			ran = true;
		});

		await app.execute({ argv: ["--", "--version"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin only triggers on root command", async () => {
		let ran = false;

		const app = new Crust("app")
			.use(versionPlugin("1.0.0"))
			.command("build", (cmd) =>
				cmd.run(() => {
					ran = true;
				}),
			);

		await app.execute({ argv: ["build"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin flag appears in help output", async () => {
		const app = new Crust("app")
			.meta({ description: "Test app" })
			.use(versionPlugin("1.0.0"))
			.use(helpPlugin())
			.run(() => {});

		await app.execute({ argv: ["--help"] });

		const output = getStdout();
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version plugin with function value", async () => {
		const app = new Crust("app")
			.use(versionPlugin(() => "3.5.0"))
			.run(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v3.5.0");
	});

	it("autocomplete plugin handles command not found in error mode", async () => {
		const app = new Crust("app")
			.use(autoCompletePlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["buld"] });

		expect(getStderr()).toContain('Unknown command "buld"');
		expect(getStderr()).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});
});
