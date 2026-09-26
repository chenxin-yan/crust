import { describe, expect, it } from "vite-plus/test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { Crust } from "./crust.ts";

// ────────────────────────────────────────────────────────────────────────────
// Deep fluent chains — regression guards for the type-instantiation-depth
// ceiling (TS2589). Flag/context records accumulate as flat intersections;
// nesting a merge layer per call capped chains at ~31 (Simplify<Omit & …>)
// or ~47 (mapped merge) .flags() calls and silently degraded ctx inference
// on long .provide() chains.
// ────────────────────────────────────────────────────────────────────────────

const c01 = defineContext("c01").setup(() => 1);
const c02 = defineContext("c02").setup(() => 2);
const c03 = defineContext("c03").setup(() => 3);
const c04 = defineContext("c04").setup(() => 4);
const c05 = defineContext("c05").setup(() => 5);
const c06 = defineContext("c06").setup(() => 6);
const c07 = defineContext("c07").setup(() => 7);
const c08 = defineContext("c08").setup(() => 8);
const c09 = defineContext("c09").setup(() => 9);
const c10 = defineContext("c10").setup(() => 10);
const c11 = defineContext("c11").setup(() => 11);
const c12 = defineContext("c12").setup(() => 12);
const c13 = defineContext("c13").setup(() => 13);
const c14 = defineContext("c14").setup(() => 14);
const c15 = defineContext("c15").setup(() => 15);
const c16 = defineContext("c16").setup(() => 16);
const c17 = defineContext("c17").setup(() => 17);
const c18 = defineContext("c18").setup(() => 18);
const c19 = defineContext("c19").setup(() => 19);
const c20 = defineContext("c20").setup(() => 20);
const c21 = defineContext("c21").setup(() => 21);
const c22 = defineContext("c22").setup(() => 22);
const c23 = defineContext("c23").setup(() => 23);
const c24 = defineContext("c24").setup(() => 24);
const c25 = defineContext("c25").setup(() => 25);
const c26 = defineContext("c26").setup(() => 26);
const c27 = defineContext("c27").setup(() => 27);
const c28 = defineContext("c28").setup(() => 28);
const c29 = defineContext("c29").setup(() => 29);
const c30 = defineContext("c30").setup(() => 30);
const c31 = defineContext("c31").setup(() => 31);
const c32 = defineContext("c32").setup(() => 32);
const c33 = defineContext("c33").setup(() => 33);
const c34 = defineContext("c34").setup(() => 34);
const c35 = defineContext("c35").setup(() => 35);
const c36 = defineContext("c36").setup(() => 36);
const c37 = defineContext("c37").setup(() => 37);
const c38 = defineContext("c38").setup(() => 38);
const c39 = defineContext("c39").setup(() => 39);
const c40 = defineContext("c40").setup(() => 40);

describe("deep builder chains", () => {
	it("supports 60 chained .flags() calls with intact inference", async () => {
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
			.flags({ name: "f41", type: "boolean" })
			.flags({ name: "f42", type: "boolean" })
			.flags({ name: "f43", type: "boolean" })
			.flags({ name: "f44", type: "boolean" })
			.flags({ name: "f45", type: "boolean" })
			.flags({ name: "f46", type: "boolean" })
			.flags({ name: "f47", type: "boolean" })
			.flags({ name: "f48", type: "boolean" })
			.flags({ name: "f49", type: "boolean" })
			.flags({ name: "f50", type: "boolean" })
			.flags({ name: "f51", type: "boolean" })
			.flags({ name: "f52", type: "boolean" })
			.flags({ name: "f53", type: "boolean" })
			.flags({ name: "f54", type: "boolean" })
			.flags({ name: "f55", type: "boolean" })
			.flags({ name: "f56", type: "boolean" })
			.flags({ name: "f57", type: "boolean" })
			.flags({ name: "f58", type: "boolean" })
			.flags({ name: "f59", type: "boolean" })
			.flags({ name: "f60", type: "boolean" })
			.action(({ flags }) => {
				type _First = Expect<Equal<typeof flags.f01, boolean | undefined>>;
				type _Last = Expect<Equal<typeof flags.f60, boolean | undefined>>;
				seen.push(flags.f01, flags.f60);
			});
		await unwrap(app.run([], { flags: { f01: true, f60: true } }));
		expect(seen).toEqual([true, true]);
	});

	it("supports 30 chained .args() calls with intact inference", async () => {
		const seen: unknown[] = [];
		const app = new Crust("deep-args")
			.args({ name: "a01", type: "string", required: true })
			.args({ name: "a02", type: "string", required: true })
			.args({ name: "a03", type: "string", required: true })
			.args({ name: "a04", type: "string", required: true })
			.args({ name: "a05", type: "string", required: true })
			.args({ name: "a06", type: "string", required: true })
			.args({ name: "a07", type: "string", required: true })
			.args({ name: "a08", type: "string", required: true })
			.args({ name: "a09", type: "string", required: true })
			.args({ name: "a10", type: "string", required: true })
			.args({ name: "a11", type: "string", required: true })
			.args({ name: "a12", type: "string", required: true })
			.args({ name: "a13", type: "string", required: true })
			.args({ name: "a14", type: "string", required: true })
			.args({ name: "a15", type: "string", required: true })
			.args({ name: "a16", type: "string", required: true })
			.args({ name: "a17", type: "string", required: true })
			.args({ name: "a18", type: "string", required: true })
			.args({ name: "a19", type: "string", required: true })
			.args({ name: "a20", type: "string", required: true })
			.args({ name: "a21", type: "string", required: true })
			.args({ name: "a22", type: "string", required: true })
			.args({ name: "a23", type: "string", required: true })
			.args({ name: "a24", type: "string", required: true })
			.args({ name: "a25", type: "string", required: true })
			.args({ name: "a26", type: "string", required: true })
			.args({ name: "a27", type: "string", required: true })
			.args({ name: "a28", type: "string", required: true })
			.args({ name: "a29", type: "string", required: true })
			.args({ name: "a30", type: "string", required: true })
			.action(({ args }) => {
				type _First = Expect<Equal<typeof args.a01, string>>;
				type _Last = Expect<Equal<typeof args.a30, string>>;
				seen.push(args.a01, args.a30);
			});
		await unwrap(
			app.run([], {
				args: Object.fromEntries(
					Array.from({ length: 30 }, (_, i) => [`a${String(i + 1).padStart(2, "0")}`, `v${i + 1}`]),
				),
			} as never),
		);
		expect(seen).toEqual(["v1", "v30"]);
	});

	it("supports 40 chained .provide() calls with intact ctx inference", async () => {
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
			.provide(c21())
			.provide(c22())
			.provide(c23())
			.provide(c24())
			.provide(c25())
			.provide(c26())
			.provide(c27())
			.provide(c28())
			.provide(c29())
			.provide(c30())
			.provide(c31())
			.provide(c32())
			.provide(c33())
			.provide(c34())
			.provide(c35())
			.provide(c36())
			.provide(c37())
			.provide(c38())
			.provide(c39())
			.provide(c40())
			.action(async ({ ctx }) => {
				const first = await ctx.c01;
				const last = await ctx.c40;
				type _First = Expect<Equal<typeof first, number>>;
				type _Last = Expect<Equal<typeof last, number>>;
				seen.push(first, last);
			});
		await unwrap(app.run([]));
		expect(seen).toEqual([1, 40]);
	});
});
