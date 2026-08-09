import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { Crust } from "./crust.ts";

// ────────────────────────────────────────────────────────────────────────────
// Deep fluent chains — regression guards for the type-instantiation-depth
// ceiling (TS2589). Before the mapped-type MergeFlags/MergeContext and the
// Spell accumulator, ~31 chained .flags() calls failed to compile at all.
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const c01 = defineContext("c01", () => 1);
const c02 = defineContext("c02", () => 2);
const c03 = defineContext("c03", () => 3);
const c04 = defineContext("c04", () => 4);
const c05 = defineContext("c05", () => 5);
const c06 = defineContext("c06", () => 6);
const c07 = defineContext("c07", () => 7);
const c08 = defineContext("c08", () => 8);
const c09 = defineContext("c09", () => 9);
const c10 = defineContext("c10", () => 10);
const c11 = defineContext("c11", () => 11);
const c12 = defineContext("c12", () => 12);
const c13 = defineContext("c13", () => 13);
const c14 = defineContext("c14", () => 14);
const c15 = defineContext("c15", () => 15);
const c16 = defineContext("c16", () => 16);
const c17 = defineContext("c17", () => 17);
const c18 = defineContext("c18", () => 18);
const c19 = defineContext("c19", () => 19);
const c20 = defineContext("c20", () => 20);

describe("deep builder chains", () => {
	it("supports 40 chained .flags() calls with intact inference", async () => {
		const seen: unknown[] = [];
		const app = new Crust("deep-flags")
			.flags({ name: "f01", type: "boolean" })
			.flags({ name: "f02", type: "boolean" })
			.flags({ name: "f03", type: "boolean" })
			.flags({ name: "f04", type: "boolean" })
			.flags({ name: "f05", type: "boolean" })
			.flags({ name: "f06", type: "boolean" })
			.flags({ name: "f07", type: "boolean" })
			.flags({ name: "f08", type: "boolean" })
			.flags({ name: "f09", type: "boolean" })
			.flags({ name: "f10", type: "boolean" })
			.flags({ name: "f11", type: "boolean" })
			.flags({ name: "f12", type: "boolean" })
			.flags({ name: "f13", type: "boolean" })
			.flags({ name: "f14", type: "boolean" })
			.flags({ name: "f15", type: "boolean" })
			.flags({ name: "f16", type: "boolean" })
			.flags({ name: "f17", type: "boolean" })
			.flags({ name: "f18", type: "boolean" })
			.flags({ name: "f19", type: "boolean" })
			.flags({ name: "f20", type: "boolean" })
			.flags({ name: "f21", type: "boolean" })
			.flags({ name: "f22", type: "boolean" })
			.flags({ name: "f23", type: "boolean" })
			.flags({ name: "f24", type: "boolean" })
			.flags({ name: "f25", type: "boolean" })
			.flags({ name: "f26", type: "boolean" })
			.flags({ name: "f27", type: "boolean" })
			.flags({ name: "f28", type: "boolean" })
			.flags({ name: "f29", type: "boolean" })
			.flags({ name: "f30", type: "boolean" })
			.flags({ name: "f31", type: "boolean" })
			.flags({ name: "f32", type: "boolean" })
			.flags({ name: "f33", type: "boolean" })
			.flags({ name: "f34", type: "boolean" })
			.flags({ name: "f35", type: "boolean" })
			.flags({ name: "f36", type: "boolean" })
			.flags({ name: "f37", type: "boolean" })
			.flags({ name: "f38", type: "boolean" })
			.flags({ name: "f39", type: "boolean" })
			.flags({ name: "f40", type: "boolean" })
			.action(({ flags }) => {
				type _First = Expect<Equal<typeof flags.f01, boolean | undefined>>;
				type _Last = Expect<Equal<typeof flags.f40, boolean | undefined>>;
				seen.push(flags.f01, flags.f40);
			});
		await app.run(["--f01", "--f40"]);
		expect(seen).toEqual([true, true]);
	});

	it("supports 20 chained .provide() calls with intact ctx inference", async () => {
		const seen: unknown[] = [];
		const app = new Crust("deep-ctx")
			.provide(c01())
			.provide(c02())
			.provide(c03())
			.provide(c04())
			.provide(c05())
			.provide(c06())
			.provide(c07())
			.provide(c08())
			.provide(c09())
			.provide(c10())
			.provide(c11())
			.provide(c12())
			.provide(c13())
			.provide(c14())
			.provide(c15())
			.provide(c16())
			.provide(c17())
			.provide(c18())
			.provide(c19())
			.provide(c20())
			.action(({ ctx }) => {
				type _First = Expect<Equal<typeof ctx.c01, number>>;
				type _Last = Expect<Equal<typeof ctx.c20, number>>;
				seen.push(ctx.c01, ctx.c20);
			});
		await app.run([]);
		expect(seen).toEqual([1, 20]);
	});
});
