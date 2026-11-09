import { z } from "zod";

import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	defineContext,
	type CommandDefinition,
	type CommandShape,
	type RunOutcome,
} from "../index.ts";

type Completed<O> = Extract<Awaited<O>, { status: "completed" }>;
type Failed<O> = Extract<Awaited<O>, { status: "failed" }>;

// Compile-time regression checks; intentionally never invoked.
function _generatorTypesEventsAndResult() {
	const app = new Crust("cli").action(async function* () {
		yield { step: 1 };
		yield "done" as const;
		return 42;
	});
	const outcome = app.run([]);
	type _result = Expect<Equal<Completed<typeof outcome>["result"], number>>;
	type _events = Expect<
		Equal<Completed<typeof outcome>["events"], readonly ({ step: number } | "done")[]>
	>;
	type _failedEvents = Expect<
		Equal<Failed<typeof outcome>["events"], readonly ({ step: number } | "done")[] | undefined>
	>;
	type _outcome = Expect<
		Equal<Awaited<typeof outcome>, RunOutcome<number, readonly ({ step: number } | "done")[]>>
	>;
}

function _zeroYieldsStillReportEvents() {
	// oxlint-disable-next-line require-yield -- a generator that yields nothing still streams.
	const app = new Crust("cli").action(async function* () {
		return "ok";
	});
	type _events = Expect<
		Equal<Completed<ReturnType<typeof app.run<[]>>>["events"], readonly never[]>
	>;
}

function _normalActionsHaveNoEvents() {
	const app = new Crust("cli").action(() => 1);
	type _outcome = Expect<Equal<Awaited<ReturnType<typeof app.run<[]>>>, RunOutcome<number>>>;
	type _noEvents = Expect<
		Equal<"events" extends keyof Completed<ReturnType<typeof app.run<[]>>> ? true : false, false>
	>;
}

function _asyncActionReturningAGeneratorStreams() {
	async function* count() {
		yield 1;
		return "end";
	}
	const app = new Crust("cli").action(async () => count());
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>["result"], string>>;
	type _events = Expect<
		Equal<Completed<ReturnType<typeof app.run<[]>>>["events"], readonly number[]>
	>;
}

function _subcommandsAndHandlesKeepEvents() {
	const watch = defineCommand("watch", (cmd) =>
		cmd.action(async function* () {
			yield 1;
		}),
	);
	const app = new Crust("cli").add(watch);
	type _run = Expect<
		Equal<Completed<ReturnType<typeof app.run<["watch"]>>>["events"], readonly number[]>
	>;
	const handle = app.at(["watch"]);
	type _handle = Expect<
		Equal<Completed<ReturnType<typeof handle.run>>["events"], readonly number[]>
	>;
	// Context-owned flags reshape added children; events survive.
	const withFlags = new Crust("cli")
		.provide(
			defineContext("auth")
				.flags({ token: { type: "string" } })
				.setup(({ flags }) => flags.token)(),
		)
		.command("tail", (cmd) =>
			cmd.action(async function* () {
				yield "line";
			}),
		);
	type _inherited = Expect<
		Equal<Completed<ReturnType<typeof withFlags.run<["tail"]>>>["events"], readonly string[]>
	>;
}

function _annotatedDefinitionsKeepTheirEvents() {
	// Annotations that leave Events open (as published Extensions write them) still match.
	const open: CommandDefinition<
		"watch",
		readonly [],
		CommandShape<[], {}, {}, void, {}>
	> = defineCommand("watch", (cmd) =>
		cmd.action(async function* () {
			yield 1;
		}),
	);
	const exact: CommandDefinition<
		"watch",
		readonly [],
		CommandShape<[], {}, {}, void, {}, readonly number[]>
	> = defineCommand("watch", (cmd) =>
		cmd.action(async function* () {
			yield 1;
		}),
	);
	const app = new Crust("cli").add(exact);
	type _exact = Expect<
		Equal<Completed<ReturnType<typeof app.run<["watch"]>>>["events"], readonly number[]>
	>;
	void open;
}

function _outputChecksTheGeneratorReturn() {
	const user = z.object({ id: z.number() });
	const app = new Crust("cli").output(user).action(async function* () {
		yield "progress";
		return { id: 1 };
	});
	type _result = Expect<Equal<Completed<ReturnType<typeof app.run<[]>>>["result"], { id: number }>>;
	type _events = Expect<
		Equal<Completed<ReturnType<typeof app.run<[]>>>["events"], readonly string[]>
	>;
	// An async action may return a generator, as the guide documents.
	async function* progress() {
		yield "progress";
		return { id: 1 };
	}
	async function* wrongId() {
		yield "progress";
		return { id: "1" };
	}
	const wrapped = new Crust("cli").output(user).action(async () => progress());
	type _wrapped = Expect<
		Equal<Completed<ReturnType<typeof wrapped.run<[]>>>["result"], { id: number }>
	>;
	type _wrappedEvents = Expect<
		Equal<Completed<ReturnType<typeof wrapped.run<[]>>>["events"], readonly string[]>
	>;
	// @ts-expect-error the wrapped generator returns a string id
	new Crust("cli").output(user).action(async () => wrongId());
	// @ts-expect-error the generator returns a string id
	new Crust("cli").output(user).action(async function* () {
		yield 1;
		return { id: "1" };
	});
	const late = new Crust("cli").action(async function* () {
		yield 1;
		return { id: 1 };
	});
	void late.output(user);
	// @ts-expect-error `.output()` after `.action()` checks the generator's return value
	void late.output(z.string());
}

function _alwaysThrowingGeneratorSubcommands() {
	// A generator that only throws returns `never`, which TypeScript matches against
	// `AnyCommandDefinitionBuilder` structurally.
	new Crust("cli").command("fail", (cmd) =>
		// oxlint-disable-next-line require-yield -- it throws before yielding on purpose.
		cmd.action(async function* () {
			throw new Error("unavailable");
		}),
	);
}
