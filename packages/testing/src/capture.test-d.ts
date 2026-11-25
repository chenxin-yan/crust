import { Crust } from "@crustjs/core";

import { withEnv } from "./capture.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Compile-time regression checks; intentionally never invoked.
async function _typecheckWithEnvKeepsTypedRun() {
	const app = new Crust("acme").command("deploy", (command) =>
		command
			.args({ name: "target", type: "string", required: true })
			.flags({ org: { type: "string", env: { name: "ACME_ORG" } } })
			.action(({ args, flags }) => ({ target: args.target, org: flags.org })),
	);
	const direct = () => app.run(["deploy"], { args: { target: "prod" } });
	const outcome = await withEnv({ ACME_ORG: "test", UNSET: undefined }, direct);
	const same: Equal<typeof outcome, Awaited<ReturnType<typeof direct>>> = true;
	// @ts-expect-error -- a wrong command path is still a compile error inside withEnv
	await withEnv({}, () => app.run(["deploi"], { args: { target: "prod" } }));
	// @ts-expect-error -- a wrong input type is still a compile error inside withEnv
	await withEnv({}, () => app.run(["deploy"], { args: { target: 1 } }));
	// @ts-expect-error -- a variable's value is text
	await withEnv({ PORT: 8080 }, direct);
	return same;
}

void _typecheckWithEnvKeepsTypedRun;
