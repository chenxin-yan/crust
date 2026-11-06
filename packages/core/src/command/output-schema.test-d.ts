import type { StandardSchema } from "@crustjs/utils/schema";
import { z } from "zod";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust, defineCommand, type RunOutcome } from "../index.ts";

type Completed<O> = Awaited<O> extends RunOutcome<infer Result> ? Result : never;

const user = z.object({ id: z.number(), status: z.enum(["active", "disabled"]) });
type User = z.output<typeof user>;

// Compile-time regression checks; intentionally never invoked.
function _outputTypesTheResult() {
	const app = new Crust("cli").output(user).action(() => ({ id: 1, status: "active" }));
	const outcome = app.run([]);
	type _result = Expect<Equal<Completed<typeof outcome>, User>>;

	// Async actions return a promise of the schema input.
	const asyncApp = new Crust("cli").output(user).action(async () => ({ id: 1, status: "active" }));
	type _async = Expect<Equal<Completed<ReturnType<typeof asyncApp.run<[]>>>, User>>;
}

function _actionReturnIsCheckedAgainstTheSchemaInput() {
	// @ts-expect-error the action returns a string id
	new Crust("cli").output(user).action(() => ({ id: "1", status: "active" }));
	// @ts-expect-error the action returns an unknown status
	new Crust("cli").output(user).action(async () => ({ id: 1, status: "gone" }));
	// @ts-expect-error the action returns nothing
	new Crust("cli").output(user).action(() => {});
}

function _transformsTypeTheResultAsTheSchemaOutput() {
	const length = z.string().transform((value) => value.length);
	const app = new Crust("cli").output(length).action(() => "four");
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>, number>>;
	// @ts-expect-error the action must return the schema input, not its output
	new Crust("cli").output(length).action(() => 4);
}

function _outputSurvivesLaterBuilderSteps() {
	const app = new Crust("cli")
		.output(user)
		.flags({ verbose: { type: "boolean" } })
		.args({ name: "id", type: "number", required: true })
		.action(({ args }) => ({ id: args.id, status: "active" }));
	const outcome = app.run([], { args: { id: 1 } });
	type _result = Expect<Equal<Completed<typeof outcome>, User>>;
}

function _subcommandResultsUseTheSchemaOutput() {
	const show = defineCommand("show", (cmd) =>
		cmd.output(user).action(() => ({ id: 1, status: "disabled" as const })),
	);
	const app = new Crust("cli")
		.add(show)
		.command("list", (cmd) => cmd.output(z.array(user)).action(() => []));
	const shown: Promise<RunOutcome<User>> = app.run(["show"]);
	const listed: Promise<RunOutcome<User[]>> = app.run(["list"]);
	void shown;
	void listed;
}

function _outputAfterActionChecksTheActionResult() {
	const app = new Crust("cli").action(() => ({ id: 1, status: "active" as const })).output(user);
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>, User>>;
	// @ts-expect-error the earlier action's result does not match the schema input
	new Crust("cli").action(() => ({ id: "1" })).output(user);
}

function _schemasWithoutTypesAcceptAnyReturn(schema: StandardSchema) {
	const app = new Crust("cli").output(schema).action(() => 42);
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>, unknown>>;
}

function _withoutOutputNothingChanges() {
	const app = new Crust("cli").action(() => ({ id: "1" }));
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>, { id: string }>>;
}
