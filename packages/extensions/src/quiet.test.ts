import { Crust, CrustError, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { quiet } from "./quiet.ts";

const deploy = defineCommand("deploy", (cmd) =>
	cmd.use(quiet).action(async ({ ctx, stdout }) => {
		stdout(String(await ctx.quiet));
	}),
);

describe("quiet", () => {
	const app = new Crust("app").extend(quiet()).add(deploy);

	it.each([
		[[], "false"],
		[["--quiet"], "true"],
		[["-q"], "true"],
		[["--no-quiet"], "false"],
	])("reads %j as %s", async (argv, value) => {
		expect(await captureExecute(app, ["deploy", ...argv])).toEqual({
			stdout: value,
			stderr: "",
			exitCode: 0,
		});
	});

	it("binds no environment variable unless one is named", async () => {
		expect((await captureExecute(app, ["deploy"], { env: { QUIET: "1" } })).stdout).toBe("false");
	});

	it.each([
		[[], "1", "true"],
		[[], "0", "false"],
		[["--no-quiet"], "1", "false"],
		[["--quiet"], "0", "true"],
	])("reads %j with APP_QUIET=%s as %s", async (argv, env, value) => {
		const withEnv = new Crust("app").extend(quiet({ env: "APP_QUIET" })).add(deploy);
		expect(await captureExecute(withEnv, ["deploy", ...argv], { env: { APP_QUIET: env } })).toEqual(
			{ stdout: value, stderr: "", exitCode: 0 },
		);
	});

	it("rejects a command that declares its own -q", async () => {
		const own = defineCommand("own", (cmd) =>
			cmd
				.flags({ query: { type: "string", short: "q" } })
				.use(quiet)
				.action(() => {}),
		);
		const outcome = await new Crust("app").extend(quiet()).add(own).run(["own"]);
		expect(outcome.status).toBe("failed");
		expect(
			outcome.status === "failed" &&
				outcome.error instanceof CrustError &&
				outcome.error.is("DEFINITION") &&
				outcome.error.details?.reason,
		).toBe("flag-collision");
	});
});
