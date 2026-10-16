import { CrustError } from "@crustjs/core";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
	CrustCommandNotFoundError,
	CrustDefinitionError,
	CrustEnvError,
	CrustParseError,
	type CrustTaggedError,
	CrustValidationError,
	fromCrustError,
	tryCrust,
	unwrapExit,
} from "./errors.ts";

/** Run an Effect and unwrap its Exit the way handler() does. */
const runAndUnwrap = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	unwrapExit(await Effect.runPromiseExit(effect));

describe("tagged errors", () => {
	const parentCommand = { meta: { name: "cli" }, args: [], flags: {}, subCommands: {} };
	const cases: {
		error: CrustTaggedError["cause"];
		class: Function;
		tag: CrustTaggedError["_tag"];
	}[] = [
		{
			error: new CrustError("DEFINITION", "d", { subject: "context", name: "db" }),
			class: CrustDefinitionError,
			tag: "CrustDefinitionError",
		},
		{
			error: new CrustError("VALIDATION", "v", {
				issues: [{ message: "required", path: "flags.count" }],
			}),
			class: CrustValidationError,
			tag: "CrustValidationError",
		},
		{
			error: new CrustError("PARSE", "p", { flag: "bogus", reason: "unknown-flag" }),
			class: CrustParseError,
			tag: "CrustParseError",
		},
		{
			error: new CrustError("COMMAND_NOT_FOUND", "c", {
				input: "x",
				available: [],
				commandPath: ["cli"],
				// SAFETY: structural snapshot fixture; the wrapper only carries it through.
				parentCommand: parentCommand as never,
			}),
			class: CrustCommandNotFoundError,
			tag: "CrustCommandNotFoundError",
		},
		{
			error: new CrustError("ENV", "e", {
				issues: [{ name: "PORT", expected: "number", received: "invalid" }],
			}),
			class: CrustEnvError,
			tag: "CrustEnvError",
		},
	];

	it.each(cases)(
		"round-trips a $tag through its tagged class",
		async ({ error, class: cls, tag }) => {
			const tagged = fromCrustError(error);
			expect(tagged).toBeInstanceOf(cls);
			expect(tagged._tag).toBe(tag);
			expect(tagged.message).toBe(error.message);
			expect(tagged.details).toBe(error.details);
			expect(tagged.cause).toBe(error);

			const caught = await Effect.runPromise(
				Effect.fail(tagged).pipe(Effect.catchTag(tag, (e) => Effect.succeed(e))),
			);
			expect(caught).toBe(tagged);
			await expect(runAndUnwrap(Effect.fail(tagged))).rejects.toBe(error);
		},
	);

	it("turns an AbortError into interruption, not a failure", async () => {
		const exit = await Effect.runPromiseExit(
			tryCrust(() => {
				throw new DOMException("Prompt was cancelled.", "AbortError");
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (!Exit.isFailure(exit)) return;
		expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
		expect(Cause.hasFails(exit.cause)).toBe(false);
	});

	it("treats a non-Crust throw as a defect", async () => {
		const boom = new Error("boom");
		const exit = await Effect.runPromiseExit(
			tryCrust(() => {
				throw boom;
			}),
		);
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(boom);
	});
});
