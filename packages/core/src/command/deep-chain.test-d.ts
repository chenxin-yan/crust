import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// keeps transitive Context dependency closures at constant depth
function _typecheckKeepsTransitiveContextDependencyClosuresAtConstantDepth() {
	const d1 = defineContext("d1").setup(() => 1);
	const d2 = defineContext("d2")
		.use(d1)
		.setup(() => 2);
	const d3 = defineContext("d3")
		.use(d2)
		.setup(() => 3);
	const d4 = defineContext("d4")
		.use(d3)
		.setup(() => 4);
	const d5 = defineContext("d5")
		.use(d4)
		.setup(() => 5);
	const d6 = defineContext("d6")
		.use(d5)
		.setup(() => 6);
	const d7 = defineContext("d7")
		.use(d6)
		.setup(() => 7);
	const d8 = defineContext("d8")
		.use(d7)
		.setup(() => 8);
	new Crust("deep")
		.provide(d1())
		.provide(d2())
		.provide(d3())
		.provide(d4())
		.provide(d5())
		.provide(d6())
		.provide(d7())
		.provide(d8());
}

// 44+ definitions in one `.add()` call must not hit TS2589 (excessively deep instantiation)
const sixtyDefinitions = [
	defineCommand("c0", (command) => command),
	defineCommand("c1", (command) => command),
	defineCommand("c2", (command) => command),
	defineCommand("c3", (command) => command),
	defineCommand("c4", (command) => command),
	defineCommand("c5", (command) => command),
	defineCommand("c6", (command) => command),
	defineCommand("c7", (command) => command),
	defineCommand("c8", (command) => command),
	defineCommand("c9", (command) => command),
	defineCommand("c10", (command) => command),
	defineCommand("c11", (command) => command),
	defineCommand("c12", (command) => command),
	defineCommand("c13", (command) => command),
	defineCommand("c14", (command) => command),
	defineCommand("c15", (command) => command),
	defineCommand("c16", (command) => command),
	defineCommand("c17", (command) => command),
	defineCommand("c18", (command) => command),
	defineCommand("c19", (command) => command),
	defineCommand("c20", (command) => command),
	defineCommand("c21", (command) => command),
	defineCommand("c22", (command) => command),
	defineCommand("c23", (command) => command),
	defineCommand("c24", (command) => command),
	defineCommand("c25", (command) => command),
	defineCommand("c26", (command) => command),
	defineCommand("c27", (command) => command),
	defineCommand("c28", (command) => command),
	defineCommand("c29", (command) => command),
	defineCommand("c30", (command) => command),
	defineCommand("c31", (command) => command),
	defineCommand("c32", (command) => command),
	defineCommand("c33", (command) => command),
	defineCommand("c34", (command) => command),
	defineCommand("c35", (command) => command),
	defineCommand("c36", (command) => command),
	defineCommand("c37", (command) => command),
	defineCommand("c38", (command) => command),
	defineCommand("c39", (command) => command),
	defineCommand("c40", (command) => command),
	defineCommand("c41", (command) => command),
	defineCommand("c42", (command) => command),
	defineCommand("c43", (command) => command),
	defineCommand("c44", (command) => command),
	defineCommand("c45", (command) => command),
	defineCommand("c46", (command) => command),
	defineCommand("c47", (command) => command),
	defineCommand("c48", (command) => command),
	defineCommand("c49", (command) => command),
	defineCommand("c50", (command) => command),
	defineCommand("c51", (command) => command),
	defineCommand("c52", (command) => command),
	defineCommand("c53", (command) => command),
	defineCommand("c54", (command) => command),
	defineCommand("c55", (command) => command),
	defineCommand("c56", (command) => command),
	defineCommand("c57", (command) => command),
	defineCommand("c58", (command) => command),
	defineCommand("c59", (command) => command),
] as const;
function _typecheckAddsSixtyDefinitionsInOneCall() {
	const app = new Crust("wide").add(...sixtyDefinitions);
	type _last = Expect<
		Equal<"c59" extends keyof (typeof app)["_types"]["tree"] ? true : false, true>
	>;
	defineExtension(defineExtensionId("wide")).add(...sixtyDefinitions);
}

// 46+ Contexts in one `.provide()` call must not hit TS2589 (excessively deep instantiation)
const p0 = defineContext("p0").setup(() => 0);
const p1 = defineContext("p1").setup(() => 1);
const p2 = defineContext("p2").setup(() => 2);
const p3 = defineContext("p3").setup(() => 3);
const p4 = defineContext("p4").setup(() => 4);
const p5 = defineContext("p5").setup(() => 5);
const p6 = defineContext("p6").setup(() => 6);
const p7 = defineContext("p7").setup(() => 7);
const p8 = defineContext("p8").setup(() => 8);
const p9 = defineContext("p9").setup(() => 9);
const p10 = defineContext("p10").setup(() => 10);
const p11 = defineContext("p11").setup(() => 11);
const p12 = defineContext("p12").setup(() => 12);
const p13 = defineContext("p13").setup(() => 13);
const p14 = defineContext("p14").setup(() => 14);
const p15 = defineContext("p15").setup(() => 15);
const p16 = defineContext("p16").setup(() => 16);
const p17 = defineContext("p17").setup(() => 17);
const p18 = defineContext("p18").setup(() => 18);
const p19 = defineContext("p19").setup(() => 19);
const p20 = defineContext("p20").setup(() => 20);
const p21 = defineContext("p21").setup(() => 21);
const p22 = defineContext("p22").setup(() => 22);
const p23 = defineContext("p23").setup(() => 23);
const p24 = defineContext("p24").setup(() => 24);
const p25 = defineContext("p25").setup(() => 25);
const p26 = defineContext("p26").setup(() => 26);
const p27 = defineContext("p27").setup(() => 27);
const p28 = defineContext("p28").setup(() => 28);
const p29 = defineContext("p29").setup(() => 29);
const p30 = defineContext("p30").setup(() => 30);
const p31 = defineContext("p31").setup(() => 31);
const p32 = defineContext("p32").setup(() => 32);
const p33 = defineContext("p33").setup(() => 33);
const p34 = defineContext("p34").setup(() => 34);
const p35 = defineContext("p35").setup(() => 35);
const p36 = defineContext("p36").setup(() => 36);
const p37 = defineContext("p37").setup(() => 37);
const p38 = defineContext("p38").setup(() => 38);
const p39 = defineContext("p39").setup(() => 39);
const p40 = defineContext("p40").setup(() => 40);
const p41 = defineContext("p41").setup(() => 41);
const p42 = defineContext("p42").setup(() => 42);
const p43 = defineContext("p43").setup(() => 43);
const p44 = defineContext("p44").setup(() => 44);
const p45 = defineContext("p45").setup(() => 45);
const p46 = defineContext("p46").setup(() => 46);
const p47 = defineContext("p47").setup(() => 47);
const p48 = defineContext("p48").setup(() => 48);
const p49 = defineContext("p49").setup(() => 49);
const p50 = defineContext("p50").setup(() => 50);
const p51 = defineContext("p51").setup(() => 51);
const p52 = defineContext("p52").setup(() => 52);
const p53 = defineContext("p53").setup(() => 53);
const p54 = defineContext("p54").setup(() => 54);
const p55 = defineContext("p55").setup(() => 55);
const p56 = defineContext("p56").setup(() => 56);
const p57 = defineContext("p57").setup(() => 57);
const p58 = defineContext("p58").setup(() => 58);
const p59 = defineContext("p59").setup(() => 59);
function _typecheckProvidesSixtyContextsInOneCall() {
	// Extension first: an earlier app-call TS2589 would mask this call's own failure.
	defineExtension(defineExtensionId("wide-provide")).provide(
		p0(),
		p1(),
		p2(),
		p3(),
		p4(),
		p5(),
		p6(),
		p7(),
		p8(),
		p9(),
		p10(),
		p11(),
		p12(),
		p13(),
		p14(),
		p15(),
		p16(),
		p17(),
		p18(),
		p19(),
		p20(),
		p21(),
		p22(),
		p23(),
		p24(),
		p25(),
		p26(),
		p27(),
		p28(),
		p29(),
		p30(),
		p31(),
		p32(),
		p33(),
		p34(),
		p35(),
		p36(),
		p37(),
		p38(),
		p39(),
		p40(),
		p41(),
		p42(),
		p43(),
		p44(),
		p45(),
		p46(),
		p47(),
		p48(),
		p49(),
		p50(),
		p51(),
		p52(),
		p53(),
		p54(),
		p55(),
		p56(),
		p57(),
		p58(),
		p59(),
	);
	new Crust("wide")
		.provide(
			p0(),
			p1(),
			p2(),
			p3(),
			p4(),
			p5(),
			p6(),
			p7(),
			p8(),
			p9(),
			p10(),
			p11(),
			p12(),
			p13(),
			p14(),
			p15(),
			p16(),
			p17(),
			p18(),
			p19(),
			p20(),
			p21(),
			p22(),
			p23(),
			p24(),
			p25(),
			p26(),
			p27(),
			p28(),
			p29(),
			p30(),
			p31(),
			p32(),
			p33(),
			p34(),
			p35(),
			p36(),
			p37(),
			p38(),
			p39(),
			p40(),
			p41(),
			p42(),
			p43(),
			p44(),
			p45(),
			p46(),
			p47(),
			p48(),
			p49(),
			p50(),
			p51(),
			p52(),
			p53(),
			p54(),
			p55(),
			p56(),
			p57(),
			p58(),
			p59(),
		)
		.action(async ({ ctx }) => {
			type _last = Expect<Equal<Awaited<typeof ctx.p59>, number>>;
			// @ts-expect-error -- only the sixty provided Contexts are on `ctx`
			void ctx.p60;
		});
}

// 46+ Contexts reaching `.extend()` or a command `.use()` in one call must not hit TS2589
function _typecheckExtendsSixtyContextExtension() {
	const wideExtension = defineExtension(defineExtensionId("wide-extend")).provide(
		p0(),
		p1(),
		p2(),
		p3(),
		p4(),
		p5(),
		p6(),
		p7(),
		p8(),
		p9(),
		p10(),
		p11(),
		p12(),
		p13(),
		p14(),
		p15(),
		p16(),
		p17(),
		p18(),
		p19(),
		p20(),
		p21(),
		p22(),
		p23(),
		p24(),
		p25(),
		p26(),
		p27(),
		p28(),
		p29(),
		p30(),
		p31(),
		p32(),
		p33(),
		p34(),
		p35(),
		p36(),
		p37(),
		p38(),
		p39(),
		p40(),
		p41(),
		p42(),
		p43(),
		p44(),
		p45(),
		p46(),
		p47(),
		p48(),
		p49(),
		p50(),
		p51(),
		p52(),
		p53(),
		p54(),
		p55(),
		p56(),
		p57(),
		p58(),
		p59(),
	);
	new Crust("wide").extend(wideExtension).action(async ({ ctx }) => {
		type _last = Expect<Equal<Awaited<typeof ctx.p59>, number>>;
		// @ts-expect-error -- only the sixty Extension-provided Contexts are on `ctx`
		void ctx.p60;
	});
}

function _typecheckUsesSixtyContextsInOneCall() {
	new Crust("wide")
		.provide(
			p0(),
			p1(),
			p2(),
			p3(),
			p4(),
			p5(),
			p6(),
			p7(),
			p8(),
			p9(),
			p10(),
			p11(),
			p12(),
			p13(),
			p14(),
			p15(),
			p16(),
			p17(),
			p18(),
			p19(),
			p20(),
			p21(),
			p22(),
			p23(),
			p24(),
			p25(),
			p26(),
			p27(),
			p28(),
			p29(),
			p30(),
			p31(),
			p32(),
			p33(),
			p34(),
			p35(),
			p36(),
			p37(),
			p38(),
			p39(),
			p40(),
			p41(),
			p42(),
			p43(),
			p44(),
			p45(),
			p46(),
			p47(),
			p48(),
			p49(),
			p50(),
			p51(),
			p52(),
			p53(),
			p54(),
			p55(),
			p56(),
			p57(),
			p58(),
			p59(),
		)
		.add(
			defineCommand("wide-use", (command) =>
				command
					.use(
						p0,
						p1,
						p2,
						p3,
						p4,
						p5,
						p6,
						p7,
						p8,
						p9,
						p10,
						p11,
						p12,
						p13,
						p14,
						p15,
						p16,
						p17,
						p18,
						p19,
						p20,
						p21,
						p22,
						p23,
						p24,
						p25,
						p26,
						p27,
						p28,
						p29,
						p30,
						p31,
						p32,
						p33,
						p34,
						p35,
						p36,
						p37,
						p38,
						p39,
						p40,
						p41,
						p42,
						p43,
						p44,
						p45,
						p46,
						p47,
						p48,
						p49,
						p50,
						p51,
						p52,
						p53,
						p54,
						p55,
						p56,
						p57,
						p58,
						p59,
					)
					.action(async ({ ctx }) => {
						type _last = Expect<Equal<Awaited<typeof ctx.p59>, number>>;
						// @ts-expect-error -- only the sixty used Contexts are on `ctx`
						void ctx.p60;
					}),
			),
		);
}
