import { Crust, defineCommand } from "@crustjs/core";

import { nextSteps } from "./next-steps.ts";

const status = defineCommand("status", (cmd) =>
	cmd
		.args({ name: "env", type: "string", required: true })
		.flags({ watch: { type: "boolean" } })
		.action(() => {}),
);

function _nextStepsTypesInputFromTheDefinition() {
	const deploy = defineCommand("deploy", (cmd) =>
		cmd.use(nextSteps).action(async ({ ctx }) => {
			const next = await ctx.nextSteps;
			next.add(status);
			next.add(status, { args: { env: "prod" }, flags: { watch: true } }, "Watch it");
			// @ts-expect-error `env` is required once `args` is given.
			next.add(status, { args: {} });
			// @ts-expect-error `env` is a string.
			next.add(status, { args: { env: 1 } });
			// @ts-expect-error `status` has no `--verbose` flag.
			next.add(status, { args: { env: "prod" }, flags: { verbose: true } });
		}),
	);
	new Crust("app").extend(nextSteps()).add(deploy, status);
	// @ts-expect-error `.use(nextSteps)` needs `.extend(nextSteps())` on the app.
	new Crust("app").add(deploy, status);
}

function _nextStepsOnErrorTakesDefinitions() {
	nextSteps({ onError: () => [{ command: status, input: { args: { env: "prod" } } }] });
	// @ts-expect-error steps name a command by its definition, not a path.
	nextSteps({ onError: () => [{ command: ["status"] }] });
}
