import { describe, expect, it } from "vite-plus/test";

import { contextSources, defineContext, type ContextBag } from "../api/context.ts";
import { defineFlag } from "../api/flags.ts";
import type { CaughtError } from "../errors.ts";
import { createContextResolver } from "./context-resolver.ts";

describe("createContextResolver", () => {
	it("pre-handles early bag rejections so enumeration cannot crash the process", async () => {
		const token = defineFlag("token", { type: "string" });
		const gate = defineContext("gate")
			.flags(token)
			.setup(() => "gate");
		let unhandled: CaughtError;
		const onUnhandled = (error: CaughtError) => {
			unhandled = error;
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			await using disposal = new AsyncDisposableStack();
			const resolver = createContextResolver(
				[gate()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
				new AbortController().signal,
			);
			const bag = resolver.bag<{ gate: string }>([gate]);
			// Spread invokes every getter without awaiting; before flag validation the
			// getter returns a rejected promise that must arrive pre-handled.
			const spread = { ...bag };
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(unhandled).toBeUndefined();
			await expect(spread.gate).rejects.toMatchObject({
				details: { reason: "flags-before-validation" },
			});
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("keeps missing and disposed guards on lazy bag getters", async () => {
		const service = defineContext("service").setup(() => "service");
		await using missingDisposal = new AsyncDisposableStack();
		const missing = createContextResolver(
			[],
			{ stdout: () => {}, stderr: () => {} },
			missingDisposal,
			new AbortController().signal,
		).bag<{ service: string }>([service]);
		await expect(missing.service).rejects.toMatchObject({ details: { reason: "missing-context" } });

		let disposed: ContextBag<{ service: string }>;
		{
			await using disposal = new AsyncDisposableStack();
			disposed = createContextResolver(
				[service()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
				new AbortController().signal,
			).bag<{ service: string }>([service]);
		}
		await expect(disposed.service).rejects.toMatchObject({
			details: { reason: "context-after-disposal" },
		});
	});

	it("exposes its sources under the contextSources symbol without pulling anything", async () => {
		let built = 0;
		const db = defineContext("db").setup(() => {
			built += 1;
			return "db";
		});
		const instance = db();
		await using disposal = new AsyncDisposableStack();
		const bag = createContextResolver(
			[instance],
			{ stdout: () => {}, stderr: () => {} },
			disposal,
			new AbortController().signal,
		).bag<{ db: string }>([instance]);

		expect(instance.factory).toBe(db);
		expect(bag[contextSources]).toEqual([instance]);
		expect(Object.isFrozen(bag[contextSources])).toBe(true);
		expect(Object.keys(bag)).toEqual(["db"]);
		expect(Object.getOwnPropertyDescriptor(bag, contextSources)?.enumerable).toBe(false);
		expect(built).toBe(0);
	});

	it("settle() drains dependencies started while it waits, then closes construction", async () => {
		const log: string[] = [];
		let freshSetups = 0;
		const gate = Promise.withResolvers<void>();
		const lateGate = Promise.withResolvers<void>();
		const late = defineContext("late").setup(async ({ defer }) => {
			await lateGate.promise;
			defer(() => {
				log.push("defer:late");
			});
			return {
				[Symbol.asyncDispose]: async () => {
					log.push("dispose:late");
				},
			};
		});
		const slow = defineContext("slow")
			.use(late)
			.setup(async ({ ctx }) => {
				await gate.promise;
				return await ctx.late;
			});
		const fresh = defineContext("fresh").setup(() => {
			freshSetups++;
			return "fresh";
		});
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

		{
			await using disposal = new AsyncDisposableStack();
			const resolver = createContextResolver(
				[late(), slow(), fresh()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
				new AbortController().signal,
			);
			const bag = resolver.bag<{ slow: unknown; late: unknown; fresh: string }>([slow, fresh]);
			const pulled = bag.slow;
			let settled = false;
			const draining = resolver.settle().then(() => {
				settled = true;
			});

			// `late` is pulled only after settle() started waiting on `slow`.
			gate.resolve();
			await flush();
			expect(settled).toBe(false);
			lateGate.resolve();
			await draining;
			expect(await pulled).toBe(await bag.late);

			await expect(bag.fresh).rejects.toMatchObject({
				code: "DEFINITION",
				details: { subject: "context", name: "fresh", reason: "context-during-disposal" },
			});
			expect(freshSetups).toBe(0);
		}
		expect(log).toEqual(["dispose:late", "defer:late"]);
	});
});
