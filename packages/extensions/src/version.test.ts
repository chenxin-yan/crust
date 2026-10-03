import { stripVTControlCharacters } from "node:util";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { version } from "./version.ts";

const stripAnsi = stripVTControlCharacters;

describe("version", () => {
	it("version extension handles --version from root metadata", async () => {
		const app = new Crust("app", { version: "1.2.3" }).extend(version()).action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toContain("app v1.2.3");
	});

	it("version extension reports missing root metadata when types are bypassed", async () => {
		// @ts-expect-error Omitted values require root version metadata.
		const app = new Crust("app").extend(version()).action(() => {});

		const { stdout, stderr, exitCode } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("");
		expect(stderr).toContain("version extension requires a version");
		expect(exitCode).toBe(1);
	});

	it("evaluates a version provider only when the root version flag is handled", async () => {
		let calls = 0;
		const extension = version(() => {
			calls++;
			return "2.0.0";
		});
		const app = new Crust("app").extend(extension).action(() => {});
		expect(extension.id).toBe(version.id);
		await app.snapshot();
		await captureExecute(app, []);
		expect(calls).toBe(0);
		const { stdout } = await captureExecute(app, ["--version"]);
		expect(calls).toBe(1);
		expect(stdout).toBe("app v2.0.0");
	});

	it("version extension handles -v alias", async () => {
		const app = new Crust("app").extend(version("2.0.0")).action(() => {});

		const { stdout } = await captureExecute(app, ["-v"]);

		expect(stdout).toContain("app v2.0.0");
	});

	it("version extension ignores --version after -- separator", async () => {
		let ran = false;

		const app = new Crust("app").extend(version("1.0.0")).action(() => {
			ran = true;
		});

		const { stdout } = await captureExecute(app, ["--", "--version"]);

		expect(stdout).toBe("");
		expect(ran).toBe(true);
	});

	it("version extension only triggers on root command", async () => {
		let ran = false;

		const app = new Crust("app").extend(version("1.0.0")).add(
			defineCommand("build", (cmd) =>
				cmd.action(() => {
					ran = true;
				}),
			),
		);

		const { stdout, stderr, exitCode } = await captureExecute(app, ["build", "--version"]);

		expect(stdout).toBe("");
		expect(ran).toBe(false);
		expect(stderr).toContain('Unknown flag "--version"');
		expect(exitCode).toBe(1);
	});

	it("version extension flag appears in help output", async () => {
		const app = new Crust("app", { description: "Test app" })
			.extend(version("1.0.0"))
			.extend(help())
			.action(() => {});

		const { stdout } = await captureExecute(app, ["--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version extension supports plain format", async () => {
		const app = new Crust("app").extend(version("1.2.3", { format: "plain" })).action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("1.2.3");
	});

	it("version extension supports a custom format function", async () => {
		const app = new Crust("app")
			.extend(
				version("1.2.3", {
					format: (version, context) => `${context.rootCommand.meta.name}/${version}`,
				}),
			)
			.action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("app/1.2.3");
	});
});
