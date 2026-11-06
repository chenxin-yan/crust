import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import type { RunOutcome } from "./typed-run.ts";

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
	new Crust("wide-extend").extend(
		defineExtension(defineExtensionId("wide")).add(...sixtyDefinitions),
	);
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

// 45+ Extensions in one `.extend()` call must not hit TS2589 (excessively deep instantiation)
const e0 = defineExtension(defineExtensionId("e0"))
	.flags({ f0: { type: "boolean" } })
	.provide(p0())
	.add(defineCommand("ec0", (command) => command.flags({ x: { type: "string" } })));
const e1 = defineExtension(defineExtensionId("e1"))
	.flags({ f1: { type: "boolean" } })
	.provide(p1())
	.add(defineCommand("ec1", (command) => command.flags({ x: { type: "string" } })));
const e2 = defineExtension(defineExtensionId("e2"))
	.flags({ f2: { type: "boolean" } })
	.provide(p2())
	.add(defineCommand("ec2", (command) => command.flags({ x: { type: "string" } })));
const e3 = defineExtension(defineExtensionId("e3"))
	.flags({ f3: { type: "boolean" } })
	.provide(p3())
	.add(defineCommand("ec3", (command) => command.flags({ x: { type: "string" } })));
const e4 = defineExtension(defineExtensionId("e4"))
	.flags({ f4: { type: "boolean" } })
	.provide(p4())
	.add(defineCommand("ec4", (command) => command.flags({ x: { type: "string" } })));
const e5 = defineExtension(defineExtensionId("e5"))
	.flags({ f5: { type: "boolean" } })
	.provide(p5())
	.add(defineCommand("ec5", (command) => command.flags({ x: { type: "string" } })));
const e6 = defineExtension(defineExtensionId("e6"))
	.flags({ f6: { type: "boolean" } })
	.provide(p6())
	.add(defineCommand("ec6", (command) => command.flags({ x: { type: "string" } })));
const e7 = defineExtension(defineExtensionId("e7"))
	.flags({ f7: { type: "boolean" } })
	.provide(p7())
	.add(defineCommand("ec7", (command) => command.flags({ x: { type: "string" } })));
const e8 = defineExtension(defineExtensionId("e8"))
	.flags({ f8: { type: "boolean" } })
	.provide(p8())
	.add(defineCommand("ec8", (command) => command.flags({ x: { type: "string" } })));
const e9 = defineExtension(defineExtensionId("e9"))
	.flags({ f9: { type: "boolean" } })
	.provide(p9())
	.add(defineCommand("ec9", (command) => command.flags({ x: { type: "string" } })));
const e10 = defineExtension(defineExtensionId("e10"))
	.flags({ f10: { type: "boolean" } })
	.provide(p10())
	.add(defineCommand("ec10", (command) => command.flags({ x: { type: "string" } })));
const e11 = defineExtension(defineExtensionId("e11"))
	.flags({ f11: { type: "boolean" } })
	.provide(p11())
	.add(defineCommand("ec11", (command) => command.flags({ x: { type: "string" } })));
const e12 = defineExtension(defineExtensionId("e12"))
	.flags({ f12: { type: "boolean" } })
	.provide(p12())
	.add(defineCommand("ec12", (command) => command.flags({ x: { type: "string" } })));
const e13 = defineExtension(defineExtensionId("e13"))
	.flags({ f13: { type: "boolean" } })
	.provide(p13())
	.add(defineCommand("ec13", (command) => command.flags({ x: { type: "string" } })));
const e14 = defineExtension(defineExtensionId("e14"))
	.flags({ f14: { type: "boolean" } })
	.provide(p14())
	.add(defineCommand("ec14", (command) => command.flags({ x: { type: "string" } })));
const e15 = defineExtension(defineExtensionId("e15"))
	.flags({ f15: { type: "boolean" } })
	.provide(p15())
	.add(defineCommand("ec15", (command) => command.flags({ x: { type: "string" } })));
const e16 = defineExtension(defineExtensionId("e16"))
	.flags({ f16: { type: "boolean" } })
	.provide(p16())
	.add(defineCommand("ec16", (command) => command.flags({ x: { type: "string" } })));
const e17 = defineExtension(defineExtensionId("e17"))
	.flags({ f17: { type: "boolean" } })
	.provide(p17())
	.add(defineCommand("ec17", (command) => command.flags({ x: { type: "string" } })));
const e18 = defineExtension(defineExtensionId("e18"))
	.flags({ f18: { type: "boolean" } })
	.provide(p18())
	.add(defineCommand("ec18", (command) => command.flags({ x: { type: "string" } })));
const e19 = defineExtension(defineExtensionId("e19"))
	.flags({ f19: { type: "boolean" } })
	.provide(p19())
	.add(defineCommand("ec19", (command) => command.flags({ x: { type: "string" } })));
const e20 = defineExtension(defineExtensionId("e20"))
	.flags({ f20: { type: "boolean" } })
	.provide(p20())
	.add(defineCommand("ec20", (command) => command.flags({ x: { type: "string" } })));
const e21 = defineExtension(defineExtensionId("e21"))
	.flags({ f21: { type: "boolean" } })
	.provide(p21())
	.add(defineCommand("ec21", (command) => command.flags({ x: { type: "string" } })));
const e22 = defineExtension(defineExtensionId("e22"))
	.flags({ f22: { type: "boolean" } })
	.provide(p22())
	.add(defineCommand("ec22", (command) => command.flags({ x: { type: "string" } })));
const e23 = defineExtension(defineExtensionId("e23"))
	.flags({ f23: { type: "boolean" } })
	.provide(p23())
	.add(defineCommand("ec23", (command) => command.flags({ x: { type: "string" } })));
const e24 = defineExtension(defineExtensionId("e24"))
	.flags({ f24: { type: "boolean" } })
	.provide(p24())
	.add(defineCommand("ec24", (command) => command.flags({ x: { type: "string" } })));
const e25 = defineExtension(defineExtensionId("e25"))
	.flags({ f25: { type: "boolean" } })
	.provide(p25())
	.add(defineCommand("ec25", (command) => command.flags({ x: { type: "string" } })));
const e26 = defineExtension(defineExtensionId("e26"))
	.flags({ f26: { type: "boolean" } })
	.provide(p26())
	.add(defineCommand("ec26", (command) => command.flags({ x: { type: "string" } })));
const e27 = defineExtension(defineExtensionId("e27"))
	.flags({ f27: { type: "boolean" } })
	.provide(p27())
	.add(defineCommand("ec27", (command) => command.flags({ x: { type: "string" } })));
const e28 = defineExtension(defineExtensionId("e28"))
	.flags({ f28: { type: "boolean" } })
	.provide(p28())
	.add(defineCommand("ec28", (command) => command.flags({ x: { type: "string" } })));
const e29 = defineExtension(defineExtensionId("e29"))
	.flags({ f29: { type: "boolean" } })
	.provide(p29())
	.add(defineCommand("ec29", (command) => command.flags({ x: { type: "string" } })));
const e30 = defineExtension(defineExtensionId("e30"))
	.flags({ f30: { type: "boolean" } })
	.provide(p30())
	.add(defineCommand("ec30", (command) => command.flags({ x: { type: "string" } })));
const e31 = defineExtension(defineExtensionId("e31"))
	.flags({ f31: { type: "boolean" } })
	.provide(p31())
	.add(defineCommand("ec31", (command) => command.flags({ x: { type: "string" } })));
const e32 = defineExtension(defineExtensionId("e32"))
	.flags({ f32: { type: "boolean" } })
	.provide(p32())
	.add(defineCommand("ec32", (command) => command.flags({ x: { type: "string" } })));
const e33 = defineExtension(defineExtensionId("e33"))
	.flags({ f33: { type: "boolean" } })
	.provide(p33())
	.add(defineCommand("ec33", (command) => command.flags({ x: { type: "string" } })));
const e34 = defineExtension(defineExtensionId("e34"))
	.flags({ f34: { type: "boolean" } })
	.provide(p34())
	.add(defineCommand("ec34", (command) => command.flags({ x: { type: "string" } })));
const e35 = defineExtension(defineExtensionId("e35"))
	.flags({ f35: { type: "boolean" } })
	.provide(p35())
	.add(defineCommand("ec35", (command) => command.flags({ x: { type: "string" } })));
const e36 = defineExtension(defineExtensionId("e36"))
	.flags({ f36: { type: "boolean" } })
	.provide(p36())
	.add(defineCommand("ec36", (command) => command.flags({ x: { type: "string" } })));
const e37 = defineExtension(defineExtensionId("e37"))
	.flags({ f37: { type: "boolean" } })
	.provide(p37())
	.add(defineCommand("ec37", (command) => command.flags({ x: { type: "string" } })));
const e38 = defineExtension(defineExtensionId("e38"))
	.flags({ f38: { type: "boolean" } })
	.provide(p38())
	.add(defineCommand("ec38", (command) => command.flags({ x: { type: "string" } })));
const e39 = defineExtension(defineExtensionId("e39"))
	.flags({ f39: { type: "boolean" } })
	.provide(p39())
	.add(defineCommand("ec39", (command) => command.flags({ x: { type: "string" } })));
const e40 = defineExtension(defineExtensionId("e40"))
	.flags({ f40: { type: "boolean" } })
	.provide(p40())
	.add(defineCommand("ec40", (command) => command.flags({ x: { type: "string" } })));
const e41 = defineExtension(defineExtensionId("e41"))
	.flags({ f41: { type: "boolean" } })
	.provide(p41())
	.add(defineCommand("ec41", (command) => command.flags({ x: { type: "string" } })));
const e42 = defineExtension(defineExtensionId("e42"))
	.flags({ f42: { type: "boolean" } })
	.provide(p42())
	.add(defineCommand("ec42", (command) => command.flags({ x: { type: "string" } })));
const e43 = defineExtension(defineExtensionId("e43"))
	.flags({ f43: { type: "boolean" } })
	.provide(p43())
	.add(defineCommand("ec43", (command) => command.flags({ x: { type: "string" } })));
const e44 = defineExtension(defineExtensionId("e44"))
	.flags({ f44: { type: "boolean" } })
	.provide(p44())
	.add(defineCommand("ec44", (command) => command.flags({ x: { type: "string" } })));
const e45 = defineExtension(defineExtensionId("e45"))
	.flags({ f45: { type: "boolean" } })
	.provide(p45())
	.add(defineCommand("ec45", (command) => command.flags({ x: { type: "string" } })));
const e46 = defineExtension(defineExtensionId("e46"))
	.flags({ f46: { type: "boolean" } })
	.provide(p46())
	.add(defineCommand("ec46", (command) => command.flags({ x: { type: "string" } })));
const e47 = defineExtension(defineExtensionId("e47"))
	.flags({ f47: { type: "boolean" } })
	.provide(p47())
	.add(defineCommand("ec47", (command) => command.flags({ x: { type: "string" } })));
const e48 = defineExtension(defineExtensionId("e48"))
	.flags({ f48: { type: "boolean" } })
	.provide(p48())
	.add(defineCommand("ec48", (command) => command.flags({ x: { type: "string" } })));
const e49 = defineExtension(defineExtensionId("e49"))
	.flags({ f49: { type: "boolean" } })
	.provide(p49())
	.add(defineCommand("ec49", (command) => command.flags({ x: { type: "string" } })));
const e50 = defineExtension(defineExtensionId("e50"))
	.flags({ f50: { type: "boolean" } })
	.provide(p50())
	.add(defineCommand("ec50", (command) => command.flags({ x: { type: "string" } })));
const e51 = defineExtension(defineExtensionId("e51"))
	.flags({ f51: { type: "boolean" } })
	.provide(p51())
	.add(defineCommand("ec51", (command) => command.flags({ x: { type: "string" } })));
const e52 = defineExtension(defineExtensionId("e52"))
	.flags({ f52: { type: "boolean" } })
	.provide(p52())
	.add(defineCommand("ec52", (command) => command.flags({ x: { type: "string" } })));
const e53 = defineExtension(defineExtensionId("e53"))
	.flags({ f53: { type: "boolean" } })
	.provide(p53())
	.add(defineCommand("ec53", (command) => command.flags({ x: { type: "string" } })));
const e54 = defineExtension(defineExtensionId("e54"))
	.flags({ f54: { type: "boolean" } })
	.provide(p54())
	.add(defineCommand("ec54", (command) => command.flags({ x: { type: "string" } })));
const e55 = defineExtension(defineExtensionId("e55"))
	.flags({ f55: { type: "boolean" } })
	.provide(p55())
	.add(defineCommand("ec55", (command) => command.flags({ x: { type: "string" } })));
const e56 = defineExtension(defineExtensionId("e56"))
	.flags({ f56: { type: "boolean" } })
	.provide(p56())
	.add(defineCommand("ec56", (command) => command.flags({ x: { type: "string" } })));
const e57 = defineExtension(defineExtensionId("e57"))
	.flags({ f57: { type: "boolean" } })
	.provide(p57())
	.add(defineCommand("ec57", (command) => command.flags({ x: { type: "string" } })));
const e58 = defineExtension(defineExtensionId("e58"))
	.flags({ f58: { type: "boolean" } })
	.provide(p58())
	.add(defineCommand("ec58", (command) => command.flags({ x: { type: "string" } })));
const e59 = defineExtension(defineExtensionId("e59"))
	.flags({ f59: { type: "boolean" } })
	.provide(p59())
	.add(defineCommand("ec59", (command) => command.flags({ x: { type: "string" } })));
function _typecheckExtendsSixtyExtensionsInOneCall() {
	const app = new Crust("wide").extend(
		e0,
		e1,
		e2,
		e3,
		e4,
		e5,
		e6,
		e7,
		e8,
		e9,
		e10,
		e11,
		e12,
		e13,
		e14,
		e15,
		e16,
		e17,
		e18,
		e19,
		e20,
		e21,
		e22,
		e23,
		e24,
		e25,
		e26,
		e27,
		e28,
		e29,
		e30,
		e31,
		e32,
		e33,
		e34,
		e35,
		e36,
		e37,
		e38,
		e39,
		e40,
		e41,
		e42,
		e43,
		e44,
		e45,
		e46,
		e47,
		e48,
		e49,
		e50,
		e51,
		e52,
		e53,
		e54,
		e55,
		e56,
		e57,
		e58,
		e59,
	);
	app.action(async ({ ctx, flags }) => {
		type _firstContext = Expect<Equal<Awaited<typeof ctx.p0>, number>>;
		type _middleContext = Expect<Equal<Awaited<typeof ctx.p30>, number>>;
		type _lastContext = Expect<Equal<Awaited<typeof ctx.p59>, number>>;
		type _firstFlag = Expect<Equal<typeof flags.f0, boolean | undefined>>;
		type _middleFlag = Expect<Equal<typeof flags.f30, boolean | undefined>>;
		type _lastFlag = Expect<Equal<typeof flags.f59, boolean | undefined>>;
		// @ts-expect-error -- only the sixty Extension-provided Contexts are on `ctx`
		void ctx.p60;
	});
	type Tree = (typeof app)["_types"]["tree"];
	type _commands = Expect<Equal<"ec0" | "ec30" | "ec59" extends keyof Tree ? true : false, true>>;
	type _closedTree = Expect<Equal<string extends keyof Tree ? true : false, false>>;
}

function _typecheckExtendsOpenRestExtensionTuple(
	rest: readonly [typeof e0, ...(typeof e1)[]],
	optional: readonly [typeof e0, typeof e1, typeof e2?],
) {
	const app = new Crust("rest").extend(...rest);
	app.action(({ ctx, flags }) => {
		type _leadingFlag = Expect<Equal<typeof flags.f0, boolean | undefined>>;
		// The rest's flags and Contexts are open: any name type-checks.
		type _restFlag = Expect<Equal<typeof flags.f1, unknown>>;
		void ctx.p1;
	});
	type _openTree = Expect<
		Equal<string extends keyof (typeof app)["_types"]["tree"] ? true : false, true>
	>;
	// @ts-expect-error -- an optional element may be `undefined`, which is not an Extension
	new Crust("optional").extend(...optional);
}

// A chain of 50+ `.extend()` calls adding flags, Contexts and commands must not hit TS2589.
function _typecheckChainedFlagExtensions() {
	const app = new Crust("chained-flags")
		.extend(e0)
		.extend(e1)
		.extend(e2)
		.extend(e3)
		.extend(e4)
		.extend(e5)
		.extend(e6)
		.extend(e7)
		.extend(e8)
		.extend(e9)
		.extend(e10)
		.extend(e11)
		.extend(e12)
		.extend(e13)
		.extend(e14)
		.extend(e15)
		.extend(e16)
		.extend(e17)
		.extend(e18)
		.extend(e19)
		.extend(e20)
		.extend(e21)
		.extend(e22)
		.extend(e23)
		.extend(e24)
		.extend(e25)
		.extend(e26)
		.extend(e27)
		.extend(e28)
		.extend(e29)
		.extend(e30)
		.extend(e31)
		.extend(e32)
		.extend(e33)
		.extend(e34)
		.extend(e35)
		.extend(e36)
		.extend(e37)
		.extend(e38)
		.extend(e39)
		.extend(e40)
		.extend(e41)
		.extend(e42)
		.extend(e43)
		.extend(e44)
		.extend(e45)
		.extend(e46)
		.extend(e47)
		.extend(e48)
		.extend(e49)
		.extend(e50)
		.extend(e51)
		.extend(e52)
		.extend(e53)
		.extend(e54)
		.extend(e55)
		.extend(e56)
		.extend(e57)
		.extend(e58)
		.extend(e59);
	const last = app.run(["ec59"]);
	type _last = Expect<Equal<typeof last, Promise<RunOutcome<void>>>>;
	type Tree = (typeof app)["_types"]["tree"];
	// The first command still inherits the last Extension's recursive flag.
	type _inherited = Expect<Equal<"f59" extends keyof Tree["ec0"]["flags"] ? true : false, true>>;
	app.action(({ ctx, flags }) => {
		type _lastContext = Expect<Equal<Awaited<typeof ctx.p59>, number>>;
		type _lastFlag = Expect<Equal<typeof flags.f59, boolean | undefined>>;
	});
}

// A chain of 90+ `.extend()` calls must not hit TS2589: each call resolves its command tree.
const chained0 = defineExtension(defineExtensionId("chained-0")).add(
	defineCommand("chained-0", (command) =>
		command.flags({ "chained-flag-0": { type: "boolean" } }).action(() => 0 as const),
	),
);
const chained1 = defineExtension(defineExtensionId("chained-1")).add(
	defineCommand("chained-1", (command) =>
		command.flags({ "chained-flag-1": { type: "boolean" } }).action(() => 1 as const),
	),
);
const chained2 = defineExtension(defineExtensionId("chained-2")).add(
	defineCommand("chained-2", (command) =>
		command.flags({ "chained-flag-2": { type: "boolean" } }).action(() => 2 as const),
	),
);
const chained3 = defineExtension(defineExtensionId("chained-3")).add(
	defineCommand("chained-3", (command) =>
		command.flags({ "chained-flag-3": { type: "boolean" } }).action(() => 3 as const),
	),
);
const chained4 = defineExtension(defineExtensionId("chained-4")).add(
	defineCommand("chained-4", (command) =>
		command.flags({ "chained-flag-4": { type: "boolean" } }).action(() => 4 as const),
	),
);
const chained5 = defineExtension(defineExtensionId("chained-5")).add(
	defineCommand("chained-5", (command) =>
		command.flags({ "chained-flag-5": { type: "boolean" } }).action(() => 5 as const),
	),
);
const chained6 = defineExtension(defineExtensionId("chained-6")).add(
	defineCommand("chained-6", (command) =>
		command.flags({ "chained-flag-6": { type: "boolean" } }).action(() => 6 as const),
	),
);
const chained7 = defineExtension(defineExtensionId("chained-7")).add(
	defineCommand("chained-7", (command) =>
		command.flags({ "chained-flag-7": { type: "boolean" } }).action(() => 7 as const),
	),
);
const chained8 = defineExtension(defineExtensionId("chained-8")).add(
	defineCommand("chained-8", (command) =>
		command.flags({ "chained-flag-8": { type: "boolean" } }).action(() => 8 as const),
	),
);
const chained9 = defineExtension(defineExtensionId("chained-9")).add(
	defineCommand("chained-9", (command) =>
		command.flags({ "chained-flag-9": { type: "boolean" } }).action(() => 9 as const),
	),
);
const chained10 = defineExtension(defineExtensionId("chained-10")).add(
	defineCommand("chained-10", (command) =>
		command.flags({ "chained-flag-10": { type: "boolean" } }).action(() => 10 as const),
	),
);
const chained11 = defineExtension(defineExtensionId("chained-11")).add(
	defineCommand("chained-11", (command) =>
		command.flags({ "chained-flag-11": { type: "boolean" } }).action(() => 11 as const),
	),
);
const chained12 = defineExtension(defineExtensionId("chained-12")).add(
	defineCommand("chained-12", (command) =>
		command.flags({ "chained-flag-12": { type: "boolean" } }).action(() => 12 as const),
	),
);
const chained13 = defineExtension(defineExtensionId("chained-13")).add(
	defineCommand("chained-13", (command) =>
		command.flags({ "chained-flag-13": { type: "boolean" } }).action(() => 13 as const),
	),
);
const chained14 = defineExtension(defineExtensionId("chained-14")).add(
	defineCommand("chained-14", (command) =>
		command.flags({ "chained-flag-14": { type: "boolean" } }).action(() => 14 as const),
	),
);
const chained15 = defineExtension(defineExtensionId("chained-15")).add(
	defineCommand("chained-15", (command) =>
		command.flags({ "chained-flag-15": { type: "boolean" } }).action(() => 15 as const),
	),
);
const chained16 = defineExtension(defineExtensionId("chained-16")).add(
	defineCommand("chained-16", (command) =>
		command.flags({ "chained-flag-16": { type: "boolean" } }).action(() => 16 as const),
	),
);
const chained17 = defineExtension(defineExtensionId("chained-17")).add(
	defineCommand("chained-17", (command) =>
		command.flags({ "chained-flag-17": { type: "boolean" } }).action(() => 17 as const),
	),
);
const chained18 = defineExtension(defineExtensionId("chained-18")).add(
	defineCommand("chained-18", (command) =>
		command.flags({ "chained-flag-18": { type: "boolean" } }).action(() => 18 as const),
	),
);
const chained19 = defineExtension(defineExtensionId("chained-19")).add(
	defineCommand("chained-19", (command) =>
		command.flags({ "chained-flag-19": { type: "boolean" } }).action(() => 19 as const),
	),
);
const chained20 = defineExtension(defineExtensionId("chained-20")).add(
	defineCommand("chained-20", (command) =>
		command.flags({ "chained-flag-20": { type: "boolean" } }).action(() => 20 as const),
	),
);
const chained21 = defineExtension(defineExtensionId("chained-21")).add(
	defineCommand("chained-21", (command) =>
		command.flags({ "chained-flag-21": { type: "boolean" } }).action(() => 21 as const),
	),
);
const chained22 = defineExtension(defineExtensionId("chained-22")).add(
	defineCommand("chained-22", (command) =>
		command.flags({ "chained-flag-22": { type: "boolean" } }).action(() => 22 as const),
	),
);
const chained23 = defineExtension(defineExtensionId("chained-23")).add(
	defineCommand("chained-23", (command) =>
		command.flags({ "chained-flag-23": { type: "boolean" } }).action(() => 23 as const),
	),
);
const chained24 = defineExtension(defineExtensionId("chained-24")).add(
	defineCommand("chained-24", (command) =>
		command.flags({ "chained-flag-24": { type: "boolean" } }).action(() => 24 as const),
	),
);
const chained25 = defineExtension(defineExtensionId("chained-25")).add(
	defineCommand("chained-25", (command) =>
		command.flags({ "chained-flag-25": { type: "boolean" } }).action(() => 25 as const),
	),
);
const chained26 = defineExtension(defineExtensionId("chained-26")).add(
	defineCommand("chained-26", (command) =>
		command.flags({ "chained-flag-26": { type: "boolean" } }).action(() => 26 as const),
	),
);
const chained27 = defineExtension(defineExtensionId("chained-27")).add(
	defineCommand("chained-27", (command) =>
		command.flags({ "chained-flag-27": { type: "boolean" } }).action(() => 27 as const),
	),
);
const chained28 = defineExtension(defineExtensionId("chained-28")).add(
	defineCommand("chained-28", (command) =>
		command.flags({ "chained-flag-28": { type: "boolean" } }).action(() => 28 as const),
	),
);
const chained29 = defineExtension(defineExtensionId("chained-29")).add(
	defineCommand("chained-29", (command) =>
		command.flags({ "chained-flag-29": { type: "boolean" } }).action(() => 29 as const),
	),
);
const chained30 = defineExtension(defineExtensionId("chained-30")).add(
	defineCommand("chained-30", (command) =>
		command.flags({ "chained-flag-30": { type: "boolean" } }).action(() => 30 as const),
	),
);
const chained31 = defineExtension(defineExtensionId("chained-31")).add(
	defineCommand("chained-31", (command) =>
		command.flags({ "chained-flag-31": { type: "boolean" } }).action(() => 31 as const),
	),
);
const chained32 = defineExtension(defineExtensionId("chained-32")).add(
	defineCommand("chained-32", (command) =>
		command.flags({ "chained-flag-32": { type: "boolean" } }).action(() => 32 as const),
	),
);
const chained33 = defineExtension(defineExtensionId("chained-33")).add(
	defineCommand("chained-33", (command) =>
		command.flags({ "chained-flag-33": { type: "boolean" } }).action(() => 33 as const),
	),
);
const chained34 = defineExtension(defineExtensionId("chained-34")).add(
	defineCommand("chained-34", (command) =>
		command.flags({ "chained-flag-34": { type: "boolean" } }).action(() => 34 as const),
	),
);
const chained35 = defineExtension(defineExtensionId("chained-35")).add(
	defineCommand("chained-35", (command) =>
		command.flags({ "chained-flag-35": { type: "boolean" } }).action(() => 35 as const),
	),
);
const chained36 = defineExtension(defineExtensionId("chained-36")).add(
	defineCommand("chained-36", (command) =>
		command.flags({ "chained-flag-36": { type: "boolean" } }).action(() => 36 as const),
	),
);
const chained37 = defineExtension(defineExtensionId("chained-37")).add(
	defineCommand("chained-37", (command) =>
		command.flags({ "chained-flag-37": { type: "boolean" } }).action(() => 37 as const),
	),
);
const chained38 = defineExtension(defineExtensionId("chained-38")).add(
	defineCommand("chained-38", (command) =>
		command.flags({ "chained-flag-38": { type: "boolean" } }).action(() => 38 as const),
	),
);
const chained39 = defineExtension(defineExtensionId("chained-39")).add(
	defineCommand("chained-39", (command) =>
		command.flags({ "chained-flag-39": { type: "boolean" } }).action(() => 39 as const),
	),
);
const chained40 = defineExtension(defineExtensionId("chained-40")).add(
	defineCommand("chained-40", (command) =>
		command.flags({ "chained-flag-40": { type: "boolean" } }).action(() => 40 as const),
	),
);
const chained41 = defineExtension(defineExtensionId("chained-41")).add(
	defineCommand("chained-41", (command) =>
		command.flags({ "chained-flag-41": { type: "boolean" } }).action(() => 41 as const),
	),
);
const chained42 = defineExtension(defineExtensionId("chained-42")).add(
	defineCommand("chained-42", (command) =>
		command.flags({ "chained-flag-42": { type: "boolean" } }).action(() => 42 as const),
	),
);
const chained43 = defineExtension(defineExtensionId("chained-43")).add(
	defineCommand("chained-43", (command) =>
		command.flags({ "chained-flag-43": { type: "boolean" } }).action(() => 43 as const),
	),
);
const chained44 = defineExtension(defineExtensionId("chained-44")).add(
	defineCommand("chained-44", (command) =>
		command.flags({ "chained-flag-44": { type: "boolean" } }).action(() => 44 as const),
	),
);
const chained45 = defineExtension(defineExtensionId("chained-45")).add(
	defineCommand("chained-45", (command) =>
		command.flags({ "chained-flag-45": { type: "boolean" } }).action(() => 45 as const),
	),
);
const chained46 = defineExtension(defineExtensionId("chained-46")).add(
	defineCommand("chained-46", (command) =>
		command.flags({ "chained-flag-46": { type: "boolean" } }).action(() => 46 as const),
	),
);
const chained47 = defineExtension(defineExtensionId("chained-47")).add(
	defineCommand("chained-47", (command) =>
		command.flags({ "chained-flag-47": { type: "boolean" } }).action(() => 47 as const),
	),
);
const chained48 = defineExtension(defineExtensionId("chained-48")).add(
	defineCommand("chained-48", (command) =>
		command.flags({ "chained-flag-48": { type: "boolean" } }).action(() => 48 as const),
	),
);
const chained49 = defineExtension(defineExtensionId("chained-49")).add(
	defineCommand("chained-49", (command) =>
		command.flags({ "chained-flag-49": { type: "boolean" } }).action(() => 49 as const),
	),
);
const chained50 = defineExtension(defineExtensionId("chained-50")).add(
	defineCommand("chained-50", (command) =>
		command.flags({ "chained-flag-50": { type: "boolean" } }).action(() => 50 as const),
	),
);
const chained51 = defineExtension(defineExtensionId("chained-51")).add(
	defineCommand("chained-51", (command) =>
		command.flags({ "chained-flag-51": { type: "boolean" } }).action(() => 51 as const),
	),
);
const chained52 = defineExtension(defineExtensionId("chained-52")).add(
	defineCommand("chained-52", (command) =>
		command.flags({ "chained-flag-52": { type: "boolean" } }).action(() => 52 as const),
	),
);
const chained53 = defineExtension(defineExtensionId("chained-53")).add(
	defineCommand("chained-53", (command) =>
		command.flags({ "chained-flag-53": { type: "boolean" } }).action(() => 53 as const),
	),
);
const chained54 = defineExtension(defineExtensionId("chained-54")).add(
	defineCommand("chained-54", (command) =>
		command.flags({ "chained-flag-54": { type: "boolean" } }).action(() => 54 as const),
	),
);
const chained55 = defineExtension(defineExtensionId("chained-55")).add(
	defineCommand("chained-55", (command) =>
		command.flags({ "chained-flag-55": { type: "boolean" } }).action(() => 55 as const),
	),
);
const chained56 = defineExtension(defineExtensionId("chained-56")).add(
	defineCommand("chained-56", (command) =>
		command.flags({ "chained-flag-56": { type: "boolean" } }).action(() => 56 as const),
	),
);
const chained57 = defineExtension(defineExtensionId("chained-57")).add(
	defineCommand("chained-57", (command) =>
		command.flags({ "chained-flag-57": { type: "boolean" } }).action(() => 57 as const),
	),
);
const chained58 = defineExtension(defineExtensionId("chained-58")).add(
	defineCommand("chained-58", (command) =>
		command.flags({ "chained-flag-58": { type: "boolean" } }).action(() => 58 as const),
	),
);
const chained59 = defineExtension(defineExtensionId("chained-59")).add(
	defineCommand("chained-59", (command) =>
		command.flags({ "chained-flag-59": { type: "boolean" } }).action(() => 59 as const),
	),
);
const chained60 = defineExtension(defineExtensionId("chained-60")).add(
	defineCommand("chained-60", (command) =>
		command.flags({ "chained-flag-60": { type: "boolean" } }).action(() => 60 as const),
	),
);
const chained61 = defineExtension(defineExtensionId("chained-61")).add(
	defineCommand("chained-61", (command) =>
		command.flags({ "chained-flag-61": { type: "boolean" } }).action(() => 61 as const),
	),
);
const chained62 = defineExtension(defineExtensionId("chained-62")).add(
	defineCommand("chained-62", (command) =>
		command.flags({ "chained-flag-62": { type: "boolean" } }).action(() => 62 as const),
	),
);
const chained63 = defineExtension(defineExtensionId("chained-63")).add(
	defineCommand("chained-63", (command) =>
		command.flags({ "chained-flag-63": { type: "boolean" } }).action(() => 63 as const),
	),
);
const chained64 = defineExtension(defineExtensionId("chained-64")).add(
	defineCommand("chained-64", (command) =>
		command.flags({ "chained-flag-64": { type: "boolean" } }).action(() => 64 as const),
	),
);
const chained65 = defineExtension(defineExtensionId("chained-65")).add(
	defineCommand("chained-65", (command) =>
		command.flags({ "chained-flag-65": { type: "boolean" } }).action(() => 65 as const),
	),
);
const chained66 = defineExtension(defineExtensionId("chained-66")).add(
	defineCommand("chained-66", (command) =>
		command.flags({ "chained-flag-66": { type: "boolean" } }).action(() => 66 as const),
	),
);
const chained67 = defineExtension(defineExtensionId("chained-67")).add(
	defineCommand("chained-67", (command) =>
		command.flags({ "chained-flag-67": { type: "boolean" } }).action(() => 67 as const),
	),
);
const chained68 = defineExtension(defineExtensionId("chained-68")).add(
	defineCommand("chained-68", (command) =>
		command.flags({ "chained-flag-68": { type: "boolean" } }).action(() => 68 as const),
	),
);
const chained69 = defineExtension(defineExtensionId("chained-69")).add(
	defineCommand("chained-69", (command) =>
		command.flags({ "chained-flag-69": { type: "boolean" } }).action(() => 69 as const),
	),
);
const chained70 = defineExtension(defineExtensionId("chained-70")).add(
	defineCommand("chained-70", (command) =>
		command.flags({ "chained-flag-70": { type: "boolean" } }).action(() => 70 as const),
	),
);
const chained71 = defineExtension(defineExtensionId("chained-71")).add(
	defineCommand("chained-71", (command) =>
		command.flags({ "chained-flag-71": { type: "boolean" } }).action(() => 71 as const),
	),
);
const chained72 = defineExtension(defineExtensionId("chained-72")).add(
	defineCommand("chained-72", (command) =>
		command.flags({ "chained-flag-72": { type: "boolean" } }).action(() => 72 as const),
	),
);
const chained73 = defineExtension(defineExtensionId("chained-73")).add(
	defineCommand("chained-73", (command) =>
		command.flags({ "chained-flag-73": { type: "boolean" } }).action(() => 73 as const),
	),
);
const chained74 = defineExtension(defineExtensionId("chained-74")).add(
	defineCommand("chained-74", (command) =>
		command.flags({ "chained-flag-74": { type: "boolean" } }).action(() => 74 as const),
	),
);
const chained75 = defineExtension(defineExtensionId("chained-75")).add(
	defineCommand("chained-75", (command) =>
		command.flags({ "chained-flag-75": { type: "boolean" } }).action(() => 75 as const),
	),
);
const chained76 = defineExtension(defineExtensionId("chained-76")).add(
	defineCommand("chained-76", (command) =>
		command.flags({ "chained-flag-76": { type: "boolean" } }).action(() => 76 as const),
	),
);
const chained77 = defineExtension(defineExtensionId("chained-77")).add(
	defineCommand("chained-77", (command) =>
		command.flags({ "chained-flag-77": { type: "boolean" } }).action(() => 77 as const),
	),
);
const chained78 = defineExtension(defineExtensionId("chained-78")).add(
	defineCommand("chained-78", (command) =>
		command.flags({ "chained-flag-78": { type: "boolean" } }).action(() => 78 as const),
	),
);
const chained79 = defineExtension(defineExtensionId("chained-79")).add(
	defineCommand("chained-79", (command) =>
		command.flags({ "chained-flag-79": { type: "boolean" } }).action(() => 79 as const),
	),
);
const chained80 = defineExtension(defineExtensionId("chained-80")).add(
	defineCommand("chained-80", (command) =>
		command.flags({ "chained-flag-80": { type: "boolean" } }).action(() => 80 as const),
	),
);
const chained81 = defineExtension(defineExtensionId("chained-81")).add(
	defineCommand("chained-81", (command) =>
		command.flags({ "chained-flag-81": { type: "boolean" } }).action(() => 81 as const),
	),
);
const chained82 = defineExtension(defineExtensionId("chained-82")).add(
	defineCommand("chained-82", (command) =>
		command.flags({ "chained-flag-82": { type: "boolean" } }).action(() => 82 as const),
	),
);
const chained83 = defineExtension(defineExtensionId("chained-83")).add(
	defineCommand("chained-83", (command) =>
		command.flags({ "chained-flag-83": { type: "boolean" } }).action(() => 83 as const),
	),
);
const chained84 = defineExtension(defineExtensionId("chained-84")).add(
	defineCommand("chained-84", (command) =>
		command.flags({ "chained-flag-84": { type: "boolean" } }).action(() => 84 as const),
	),
);
const chained85 = defineExtension(defineExtensionId("chained-85")).add(
	defineCommand("chained-85", (command) =>
		command.flags({ "chained-flag-85": { type: "boolean" } }).action(() => 85 as const),
	),
);
const chained86 = defineExtension(defineExtensionId("chained-86")).add(
	defineCommand("chained-86", (command) =>
		command.flags({ "chained-flag-86": { type: "boolean" } }).action(() => 86 as const),
	),
);
const chained87 = defineExtension(defineExtensionId("chained-87")).add(
	defineCommand("chained-87", (command) =>
		command.flags({ "chained-flag-87": { type: "boolean" } }).action(() => 87 as const),
	),
);
const chained88 = defineExtension(defineExtensionId("chained-88")).add(
	defineCommand("chained-88", (command) =>
		command.flags({ "chained-flag-88": { type: "boolean" } }).action(() => 88 as const),
	),
);
const chained89 = defineExtension(defineExtensionId("chained-89")).add(
	defineCommand("chained-89", (command) =>
		command.flags({ "chained-flag-89": { type: "boolean" } }).action(() => 89 as const),
	),
);
const chained90 = defineExtension(defineExtensionId("chained-90")).add(
	defineCommand("chained-90", (command) =>
		command.flags({ "chained-flag-90": { type: "boolean" } }).action(() => 90 as const),
	),
);
const chained91 = defineExtension(defineExtensionId("chained-91")).add(
	defineCommand("chained-91", (command) =>
		command.flags({ "chained-flag-91": { type: "boolean" } }).action(() => 91 as const),
	),
);
const chained92 = defineExtension(defineExtensionId("chained-92")).add(
	defineCommand("chained-92", (command) =>
		command.flags({ "chained-flag-92": { type: "boolean" } }).action(() => 92 as const),
	),
);
const chained93 = defineExtension(defineExtensionId("chained-93")).add(
	defineCommand("chained-93", (command) =>
		command.flags({ "chained-flag-93": { type: "boolean" } }).action(() => 93 as const),
	),
);
const chained94 = defineExtension(defineExtensionId("chained-94")).add(
	defineCommand("chained-94", (command) =>
		command.flags({ "chained-flag-94": { type: "boolean" } }).action(() => 94 as const),
	),
);
const chained95 = defineExtension(defineExtensionId("chained-95")).add(
	defineCommand("chained-95", (command) =>
		command.flags({ "chained-flag-95": { type: "boolean" } }).action(() => 95 as const),
	),
);
const chained96 = defineExtension(defineExtensionId("chained-96")).add(
	defineCommand("chained-96", (command) =>
		command.flags({ "chained-flag-96": { type: "boolean" } }).action(() => 96 as const),
	),
);
const chained97 = defineExtension(defineExtensionId("chained-97")).add(
	defineCommand("chained-97", (command) =>
		command.flags({ "chained-flag-97": { type: "boolean" } }).action(() => 97 as const),
	),
);
const chained98 = defineExtension(defineExtensionId("chained-98")).add(
	defineCommand("chained-98", (command) =>
		command.flags({ "chained-flag-98": { type: "boolean" } }).action(() => 98 as const),
	),
);
const chained99 = defineExtension(defineExtensionId("chained-99")).add(
	defineCommand("chained-99", (command) =>
		command.flags({ "chained-flag-99": { type: "boolean" } }).action(() => 99 as const),
	),
);
function _typecheckChainedExtendCalls() {
	const app = new Crust("chained")
		.extend(chained0)
		.extend(chained1)
		.extend(chained2)
		.extend(chained3)
		.extend(chained4)
		.extend(chained5)
		.extend(chained6)
		.extend(chained7)
		.extend(chained8)
		.extend(chained9)
		.extend(chained10)
		.extend(chained11)
		.extend(chained12)
		.extend(chained13)
		.extend(chained14)
		.extend(chained15)
		.extend(chained16)
		.extend(chained17)
		.extend(chained18)
		.extend(chained19)
		.extend(chained20)
		.extend(chained21)
		.extend(chained22)
		.extend(chained23)
		.extend(chained24)
		.extend(chained25)
		.extend(chained26)
		.extend(chained27)
		.extend(chained28)
		.extend(chained29)
		.extend(chained30)
		.extend(chained31)
		.extend(chained32)
		.extend(chained33)
		.extend(chained34)
		.extend(chained35)
		.extend(chained36)
		.extend(chained37)
		.extend(chained38)
		.extend(chained39)
		.extend(chained40)
		.extend(chained41)
		.extend(chained42)
		.extend(chained43)
		.extend(chained44)
		.extend(chained45)
		.extend(chained46)
		.extend(chained47)
		.extend(chained48)
		.extend(chained49)
		.extend(chained50)
		.extend(chained51)
		.extend(chained52)
		.extend(chained53)
		.extend(chained54)
		.extend(chained55)
		.extend(chained56)
		.extend(chained57)
		.extend(chained58)
		.extend(chained59)
		.extend(chained60)
		.extend(chained61)
		.extend(chained62)
		.extend(chained63)
		.extend(chained64)
		.extend(chained65)
		.extend(chained66)
		.extend(chained67)
		.extend(chained68)
		.extend(chained69)
		.extend(chained70)
		.extend(chained71)
		.extend(chained72)
		.extend(chained73)
		.extend(chained74)
		.extend(chained75)
		.extend(chained76)
		.extend(chained77)
		.extend(chained78)
		.extend(chained79)
		.extend(chained80)
		.extend(chained81)
		.extend(chained82)
		.extend(chained83)
		.extend(chained84)
		.extend(chained85)
		.extend(chained86)
		.extend(chained87)
		.extend(chained88)
		.extend(chained89)
		.extend(chained90)
		.extend(chained91)
		.extend(chained92)
		.extend(chained93)
		.extend(chained94)
		.extend(chained95)
		.extend(chained96)
		.extend(chained97)
		.extend(chained98)
		.extend(chained99);
	const last = app.run(["chained-99"]);
	type _last = Expect<Equal<typeof last, Promise<RunOutcome<99>>>>;
}

// A long literal `.add()` batch followed by a runtime-only name must not hit TS2589.
function _typecheckMixedLiteralAndDynamicAdd() {
	const name: string = "dynamic";
	const app = new Crust("mixed").add(
		defineCommand("mixed-0", (command) => command.action(() => 0 as const)),
		defineCommand("mixed-1", (command) => command.action(() => 1 as const)),
		defineCommand("mixed-2", (command) => command.action(() => 2 as const)),
		defineCommand("mixed-3", (command) => command.action(() => 3 as const)),
		defineCommand("mixed-4", (command) => command.action(() => 4 as const)),
		defineCommand("mixed-5", (command) => command.action(() => 5 as const)),
		defineCommand("mixed-6", (command) => command.action(() => 6 as const)),
		defineCommand("mixed-7", (command) => command.action(() => 7 as const)),
		defineCommand("mixed-8", (command) => command.action(() => 8 as const)),
		defineCommand("mixed-9", (command) => command.action(() => 9 as const)),
		defineCommand("mixed-10", (command) => command.action(() => 10 as const)),
		defineCommand("mixed-11", (command) => command.action(() => 11 as const)),
		defineCommand("mixed-12", (command) => command.action(() => 12 as const)),
		defineCommand("mixed-13", (command) => command.action(() => 13 as const)),
		defineCommand("mixed-14", (command) => command.action(() => 14 as const)),
		defineCommand("mixed-15", (command) => command.action(() => 15 as const)),
		defineCommand("mixed-16", (command) => command.action(() => 16 as const)),
		defineCommand("mixed-17", (command) => command.action(() => 17 as const)),
		defineCommand("mixed-18", (command) => command.action(() => 18 as const)),
		defineCommand("mixed-19", (command) => command.action(() => 19 as const)),
		defineCommand("mixed-20", (command) => command.action(() => 20 as const)),
		defineCommand("mixed-21", (command) => command.action(() => 21 as const)),
		defineCommand("mixed-22", (command) => command.action(() => 22 as const)),
		defineCommand("mixed-23", (command) => command.action(() => 23 as const)),
		defineCommand("mixed-24", (command) => command.action(() => 24 as const)),
		defineCommand("mixed-25", (command) => command.action(() => 25 as const)),
		defineCommand("mixed-26", (command) => command.action(() => 26 as const)),
		defineCommand("mixed-27", (command) => command.action(() => 27 as const)),
		defineCommand("mixed-28", (command) => command.action(() => 28 as const)),
		defineCommand("mixed-29", (command) => command.action(() => 29 as const)),
		defineCommand("mixed-30", (command) => command.action(() => 30 as const)),
		defineCommand("mixed-31", (command) => command.action(() => 31 as const)),
		defineCommand("mixed-32", (command) => command.action(() => 32 as const)),
		defineCommand("mixed-33", (command) => command.action(() => 33 as const)),
		defineCommand("mixed-34", (command) => command.action(() => 34 as const)),
		defineCommand("mixed-35", (command) => command.action(() => 35 as const)),
		defineCommand("mixed-36", (command) => command.action(() => 36 as const)),
		defineCommand("mixed-37", (command) => command.action(() => 37 as const)),
		defineCommand("mixed-38", (command) => command.action(() => 38 as const)),
		defineCommand("mixed-39", (command) => command.action(() => 39 as const)),
		defineCommand("mixed-40", (command) => command.action(() => 40 as const)),
		defineCommand("mixed-41", (command) => command.action(() => 41 as const)),
		defineCommand("mixed-42", (command) => command.action(() => 42 as const)),
		defineCommand("mixed-43", (command) => command.action(() => 43 as const)),
		defineCommand("mixed-44", (command) => command.action(() => 44 as const)),
		defineCommand("mixed-45", (command) => command.action(() => 45 as const)),
		defineCommand("mixed-46", (command) => command.action(() => 46 as const)),
		defineCommand("mixed-47", (command) => command.action(() => 47 as const)),
		defineCommand("mixed-48", (command) => command.action(() => 48 as const)),
		defineCommand("mixed-49", (command) => command.action(() => 49 as const)),
		defineCommand("mixed-50", (command) => command.action(() => 50 as const)),
		defineCommand("mixed-51", (command) => command.action(() => 51 as const)),
		defineCommand("mixed-52", (command) => command.action(() => 52 as const)),
		defineCommand("mixed-53", (command) => command.action(() => 53 as const)),
		defineCommand("mixed-54", (command) => command.action(() => 54 as const)),
		defineCommand("mixed-55", (command) => command.action(() => 55 as const)),
		defineCommand("mixed-56", (command) => command.action(() => 56 as const)),
		defineCommand("mixed-57", (command) => command.action(() => 57 as const)),
		defineCommand("mixed-58", (command) => command.action(() => 58 as const)),
		defineCommand("mixed-59", (command) => command.action(() => 59 as const)),
		defineCommand(name, (command) => command),
	);
	const first = app.run(["mixed-0"]);
	type _first = Expect<Equal<typeof first, Promise<RunOutcome<0>>>>;
}

// A runtime-only Extension command name opens the tree; recursive Extension flags still apply to it.
function _typecheckRecursiveFlagsReachAnOpenTree(name: string) {
	const open = defineExtension(defineExtensionId("open-recursive"))
		.flags({ r: { type: "boolean" } })
		.add(defineCommand(name, (command) => command));
	const app = new Crust("open-recursive")
		.add(defineCommand("known", (command) => command))
		.extend(open);
	// @ts-expect-error -- the recursive Extension flag is a boolean on every command
	void app.run(["anything"], { flags: { r: "notbool" } });
	void app.run(["anything"], { flags: { r: true } });
}

// Recursive flags registered before an opening `.extend()` still reach the opened tree.
function _typecheckEarlierRecursiveFlagsReachALaterOpenTree(name: string) {
	const trace = defineExtension(defineExtensionId("earlier-trace")).flags({
		trace: { type: "boolean" },
	});
	const tools = defineExtension(defineExtensionId("earlier-tools")).add(
		defineCommand("tool", (command) => command.action(() => 7 as const)),
	);
	const runtimeName = defineExtension(defineExtensionId("later-open")).add(
		defineCommand(name, (command) => command),
	);
	const app = new Crust("earlier-recursive")
		.add(defineCommand("known", (command) => command.action(() => 42 as const)))
		.extend(tools, trace)
		.extend(runtimeName);
	// @ts-expect-error -- the earlier recursive flag is a boolean on the widened Extension command
	void app.run(["tool"], { flags: { trace: "x" } });
	// @ts-expect-error -- and on any runtime-only path
	void app.run(["whatever"], { flags: { trace: "x" } });
	void app.run(["known"], { flags: { trace: true } });
}

// 120 chained `.flags()` calls must not hit TS2589 (excessively deep instantiation).
function _typecheckChainedFlagsCalls() {
	const chained = defineCommand("chained-flags", (command) =>
		command
			.flags({ "chained-flag-0": { type: "string" } })
			.flags({ "chained-flag-1": { type: "string" } })
			.flags({ "chained-flag-2": { type: "string" } })
			.flags({ "chained-flag-3": { type: "string" } })
			.flags({ "chained-flag-4": { type: "string" } })
			.flags({ "chained-flag-5": { type: "string" } })
			.flags({ "chained-flag-6": { type: "string" } })
			.flags({ "chained-flag-7": { type: "string" } })
			.flags({ "chained-flag-8": { type: "string" } })
			.flags({ "chained-flag-9": { type: "string" } })
			.flags({ "chained-flag-10": { type: "string" } })
			.flags({ "chained-flag-11": { type: "string" } })
			.flags({ "chained-flag-12": { type: "string" } })
			.flags({ "chained-flag-13": { type: "string" } })
			.flags({ "chained-flag-14": { type: "string" } })
			.flags({ "chained-flag-15": { type: "string" } })
			.flags({ "chained-flag-16": { type: "string" } })
			.flags({ "chained-flag-17": { type: "string" } })
			.flags({ "chained-flag-18": { type: "string" } })
			.flags({ "chained-flag-19": { type: "string" } })
			.flags({ "chained-flag-20": { type: "string" } })
			.flags({ "chained-flag-21": { type: "string" } })
			.flags({ "chained-flag-22": { type: "string" } })
			.flags({ "chained-flag-23": { type: "string" } })
			.flags({ "chained-flag-24": { type: "string" } })
			.flags({ "chained-flag-25": { type: "string" } })
			.flags({ "chained-flag-26": { type: "string" } })
			.flags({ "chained-flag-27": { type: "string" } })
			.flags({ "chained-flag-28": { type: "string" } })
			.flags({ "chained-flag-29": { type: "string" } })
			.flags({ "chained-flag-30": { type: "string" } })
			.flags({ "chained-flag-31": { type: "string" } })
			.flags({ "chained-flag-32": { type: "string" } })
			.flags({ "chained-flag-33": { type: "string" } })
			.flags({ "chained-flag-34": { type: "string" } })
			.flags({ "chained-flag-35": { type: "string" } })
			.flags({ "chained-flag-36": { type: "string" } })
			.flags({ "chained-flag-37": { type: "string" } })
			.flags({ "chained-flag-38": { type: "string" } })
			.flags({ "chained-flag-39": { type: "string" } })
			.flags({ "chained-flag-40": { type: "string" } })
			.flags({ "chained-flag-41": { type: "string" } })
			.flags({ "chained-flag-42": { type: "string" } })
			.flags({ "chained-flag-43": { type: "string" } })
			.flags({ "chained-flag-44": { type: "string" } })
			.flags({ "chained-flag-45": { type: "string" } })
			.flags({ "chained-flag-46": { type: "string" } })
			.flags({ "chained-flag-47": { type: "string" } })
			.flags({ "chained-flag-48": { type: "string" } })
			.flags({ "chained-flag-49": { type: "string" } })
			.flags({ "chained-flag-50": { type: "string" } })
			.flags({ "chained-flag-51": { type: "string" } })
			.flags({ "chained-flag-52": { type: "string" } })
			.flags({ "chained-flag-53": { type: "string" } })
			.flags({ "chained-flag-54": { type: "string" } })
			.flags({ "chained-flag-55": { type: "string" } })
			.flags({ "chained-flag-56": { type: "string" } })
			.flags({ "chained-flag-57": { type: "string" } })
			.flags({ "chained-flag-58": { type: "string" } })
			.flags({ "chained-flag-59": { type: "string" } })
			.flags({ "chained-flag-60": { type: "string" } })
			.flags({ "chained-flag-61": { type: "string" } })
			.flags({ "chained-flag-62": { type: "string" } })
			.flags({ "chained-flag-63": { type: "string" } })
			.flags({ "chained-flag-64": { type: "string" } })
			.flags({ "chained-flag-65": { type: "string" } })
			.flags({ "chained-flag-66": { type: "string" } })
			.flags({ "chained-flag-67": { type: "string" } })
			.flags({ "chained-flag-68": { type: "string" } })
			.flags({ "chained-flag-69": { type: "string" } })
			.flags({ "chained-flag-70": { type: "string" } })
			.flags({ "chained-flag-71": { type: "string" } })
			.flags({ "chained-flag-72": { type: "string" } })
			.flags({ "chained-flag-73": { type: "string" } })
			.flags({ "chained-flag-74": { type: "string" } })
			.flags({ "chained-flag-75": { type: "string" } })
			.flags({ "chained-flag-76": { type: "string" } })
			.flags({ "chained-flag-77": { type: "string" } })
			.flags({ "chained-flag-78": { type: "string" } })
			.flags({ "chained-flag-79": { type: "string" } })
			.flags({ "chained-flag-80": { type: "string" } })
			.flags({ "chained-flag-81": { type: "string" } })
			.flags({ "chained-flag-82": { type: "string" } })
			.flags({ "chained-flag-83": { type: "string" } })
			.flags({ "chained-flag-84": { type: "string" } })
			.flags({ "chained-flag-85": { type: "string" } })
			.flags({ "chained-flag-86": { type: "string" } })
			.flags({ "chained-flag-87": { type: "string" } })
			.flags({ "chained-flag-88": { type: "string" } })
			.flags({ "chained-flag-89": { type: "string" } })
			.flags({ "chained-flag-90": { type: "string" } })
			.flags({ "chained-flag-91": { type: "string" } })
			.flags({ "chained-flag-92": { type: "string" } })
			.flags({ "chained-flag-93": { type: "string" } })
			.flags({ "chained-flag-94": { type: "string" } })
			.flags({ "chained-flag-95": { type: "string" } })
			.flags({ "chained-flag-96": { type: "string" } })
			.flags({ "chained-flag-97": { type: "string" } })
			.flags({ "chained-flag-98": { type: "string" } })
			.flags({ "chained-flag-99": { type: "string" } })
			.flags({ "chained-flag-100": { type: "string" } })
			.flags({ "chained-flag-101": { type: "string" } })
			.flags({ "chained-flag-102": { type: "string" } })
			.flags({ "chained-flag-103": { type: "string" } })
			.flags({ "chained-flag-104": { type: "string" } })
			.flags({ "chained-flag-105": { type: "string" } })
			.flags({ "chained-flag-106": { type: "string" } })
			.flags({ "chained-flag-107": { type: "string" } })
			.flags({ "chained-flag-108": { type: "string" } })
			.flags({ "chained-flag-109": { type: "string" } })
			.flags({ "chained-flag-110": { type: "string" } })
			.flags({ "chained-flag-111": { type: "string" } })
			.flags({ "chained-flag-112": { type: "string" } })
			.flags({ "chained-flag-113": { type: "string" } })
			.flags({ "chained-flag-114": { type: "string" } })
			.flags({ "chained-flag-115": { type: "string" } })
			.flags({ "chained-flag-116": { type: "string" } })
			.flags({ "chained-flag-117": { type: "string" } })
			.flags({ "chained-flag-118": { type: "string" } })
			.flags({ "chained-flag-119": { type: "string" } })
			.action(({ flags }) => {
				// First and middle too: an accumulator that drops earlier calls must fail.
				type _first = Expect<Equal<(typeof flags)["chained-flag-0"], string | undefined>>;
				type _middle = Expect<Equal<(typeof flags)["chained-flag-60"], string | undefined>>;
				return flags["chained-flag-119"];
			}),
	);
	const last = new Crust("chained").add(chained).run(["chained-flags"]);
	type _last = Expect<Equal<typeof last, Promise<RunOutcome<string | undefined>>>>;
}

// 120 chained `.provide()` calls of flag-owning Contexts must not hit TS2589.
const owner0 = defineContext("owner-0")
	.flags({ "owner-flag-0": { type: "string" } })
	.setup(() => 0);
const owner1 = defineContext("owner-1")
	.flags({ "owner-flag-1": { type: "string" } })
	.setup(() => 1);
const owner2 = defineContext("owner-2")
	.flags({ "owner-flag-2": { type: "string" } })
	.setup(() => 2);
const owner3 = defineContext("owner-3")
	.flags({ "owner-flag-3": { type: "string" } })
	.setup(() => 3);
const owner4 = defineContext("owner-4")
	.flags({ "owner-flag-4": { type: "string" } })
	.setup(() => 4);
const owner5 = defineContext("owner-5")
	.flags({ "owner-flag-5": { type: "string" } })
	.setup(() => 5);
const owner6 = defineContext("owner-6")
	.flags({ "owner-flag-6": { type: "string" } })
	.setup(() => 6);
const owner7 = defineContext("owner-7")
	.flags({ "owner-flag-7": { type: "string" } })
	.setup(() => 7);
const owner8 = defineContext("owner-8")
	.flags({ "owner-flag-8": { type: "string" } })
	.setup(() => 8);
const owner9 = defineContext("owner-9")
	.flags({ "owner-flag-9": { type: "string" } })
	.setup(() => 9);
const owner10 = defineContext("owner-10")
	.flags({ "owner-flag-10": { type: "string" } })
	.setup(() => 10);
const owner11 = defineContext("owner-11")
	.flags({ "owner-flag-11": { type: "string" } })
	.setup(() => 11);
const owner12 = defineContext("owner-12")
	.flags({ "owner-flag-12": { type: "string" } })
	.setup(() => 12);
const owner13 = defineContext("owner-13")
	.flags({ "owner-flag-13": { type: "string" } })
	.setup(() => 13);
const owner14 = defineContext("owner-14")
	.flags({ "owner-flag-14": { type: "string" } })
	.setup(() => 14);
const owner15 = defineContext("owner-15")
	.flags({ "owner-flag-15": { type: "string" } })
	.setup(() => 15);
const owner16 = defineContext("owner-16")
	.flags({ "owner-flag-16": { type: "string" } })
	.setup(() => 16);
const owner17 = defineContext("owner-17")
	.flags({ "owner-flag-17": { type: "string" } })
	.setup(() => 17);
const owner18 = defineContext("owner-18")
	.flags({ "owner-flag-18": { type: "string" } })
	.setup(() => 18);
const owner19 = defineContext("owner-19")
	.flags({ "owner-flag-19": { type: "string" } })
	.setup(() => 19);
const owner20 = defineContext("owner-20")
	.flags({ "owner-flag-20": { type: "string" } })
	.setup(() => 20);
const owner21 = defineContext("owner-21")
	.flags({ "owner-flag-21": { type: "string" } })
	.setup(() => 21);
const owner22 = defineContext("owner-22")
	.flags({ "owner-flag-22": { type: "string" } })
	.setup(() => 22);
const owner23 = defineContext("owner-23")
	.flags({ "owner-flag-23": { type: "string" } })
	.setup(() => 23);
const owner24 = defineContext("owner-24")
	.flags({ "owner-flag-24": { type: "string" } })
	.setup(() => 24);
const owner25 = defineContext("owner-25")
	.flags({ "owner-flag-25": { type: "string" } })
	.setup(() => 25);
const owner26 = defineContext("owner-26")
	.flags({ "owner-flag-26": { type: "string" } })
	.setup(() => 26);
const owner27 = defineContext("owner-27")
	.flags({ "owner-flag-27": { type: "string" } })
	.setup(() => 27);
const owner28 = defineContext("owner-28")
	.flags({ "owner-flag-28": { type: "string" } })
	.setup(() => 28);
const owner29 = defineContext("owner-29")
	.flags({ "owner-flag-29": { type: "string" } })
	.setup(() => 29);
const owner30 = defineContext("owner-30")
	.flags({ "owner-flag-30": { type: "string" } })
	.setup(() => 30);
const owner31 = defineContext("owner-31")
	.flags({ "owner-flag-31": { type: "string" } })
	.setup(() => 31);
const owner32 = defineContext("owner-32")
	.flags({ "owner-flag-32": { type: "string" } })
	.setup(() => 32);
const owner33 = defineContext("owner-33")
	.flags({ "owner-flag-33": { type: "string" } })
	.setup(() => 33);
const owner34 = defineContext("owner-34")
	.flags({ "owner-flag-34": { type: "string" } })
	.setup(() => 34);
const owner35 = defineContext("owner-35")
	.flags({ "owner-flag-35": { type: "string" } })
	.setup(() => 35);
const owner36 = defineContext("owner-36")
	.flags({ "owner-flag-36": { type: "string" } })
	.setup(() => 36);
const owner37 = defineContext("owner-37")
	.flags({ "owner-flag-37": { type: "string" } })
	.setup(() => 37);
const owner38 = defineContext("owner-38")
	.flags({ "owner-flag-38": { type: "string" } })
	.setup(() => 38);
const owner39 = defineContext("owner-39")
	.flags({ "owner-flag-39": { type: "string" } })
	.setup(() => 39);
const owner40 = defineContext("owner-40")
	.flags({ "owner-flag-40": { type: "string" } })
	.setup(() => 40);
const owner41 = defineContext("owner-41")
	.flags({ "owner-flag-41": { type: "string" } })
	.setup(() => 41);
const owner42 = defineContext("owner-42")
	.flags({ "owner-flag-42": { type: "string" } })
	.setup(() => 42);
const owner43 = defineContext("owner-43")
	.flags({ "owner-flag-43": { type: "string" } })
	.setup(() => 43);
const owner44 = defineContext("owner-44")
	.flags({ "owner-flag-44": { type: "string" } })
	.setup(() => 44);
const owner45 = defineContext("owner-45")
	.flags({ "owner-flag-45": { type: "string" } })
	.setup(() => 45);
const owner46 = defineContext("owner-46")
	.flags({ "owner-flag-46": { type: "string" } })
	.setup(() => 46);
const owner47 = defineContext("owner-47")
	.flags({ "owner-flag-47": { type: "string" } })
	.setup(() => 47);
const owner48 = defineContext("owner-48")
	.flags({ "owner-flag-48": { type: "string" } })
	.setup(() => 48);
const owner49 = defineContext("owner-49")
	.flags({ "owner-flag-49": { type: "string" } })
	.setup(() => 49);
const owner50 = defineContext("owner-50")
	.flags({ "owner-flag-50": { type: "string" } })
	.setup(() => 50);
const owner51 = defineContext("owner-51")
	.flags({ "owner-flag-51": { type: "string" } })
	.setup(() => 51);
const owner52 = defineContext("owner-52")
	.flags({ "owner-flag-52": { type: "string" } })
	.setup(() => 52);
const owner53 = defineContext("owner-53")
	.flags({ "owner-flag-53": { type: "string" } })
	.setup(() => 53);
const owner54 = defineContext("owner-54")
	.flags({ "owner-flag-54": { type: "string" } })
	.setup(() => 54);
const owner55 = defineContext("owner-55")
	.flags({ "owner-flag-55": { type: "string" } })
	.setup(() => 55);
const owner56 = defineContext("owner-56")
	.flags({ "owner-flag-56": { type: "string" } })
	.setup(() => 56);
const owner57 = defineContext("owner-57")
	.flags({ "owner-flag-57": { type: "string" } })
	.setup(() => 57);
const owner58 = defineContext("owner-58")
	.flags({ "owner-flag-58": { type: "string" } })
	.setup(() => 58);
const owner59 = defineContext("owner-59")
	.flags({ "owner-flag-59": { type: "string" } })
	.setup(() => 59);
const owner60 = defineContext("owner-60")
	.flags({ "owner-flag-60": { type: "string" } })
	.setup(() => 60);
const owner61 = defineContext("owner-61")
	.flags({ "owner-flag-61": { type: "string" } })
	.setup(() => 61);
const owner62 = defineContext("owner-62")
	.flags({ "owner-flag-62": { type: "string" } })
	.setup(() => 62);
const owner63 = defineContext("owner-63")
	.flags({ "owner-flag-63": { type: "string" } })
	.setup(() => 63);
const owner64 = defineContext("owner-64")
	.flags({ "owner-flag-64": { type: "string" } })
	.setup(() => 64);
const owner65 = defineContext("owner-65")
	.flags({ "owner-flag-65": { type: "string" } })
	.setup(() => 65);
const owner66 = defineContext("owner-66")
	.flags({ "owner-flag-66": { type: "string" } })
	.setup(() => 66);
const owner67 = defineContext("owner-67")
	.flags({ "owner-flag-67": { type: "string" } })
	.setup(() => 67);
const owner68 = defineContext("owner-68")
	.flags({ "owner-flag-68": { type: "string" } })
	.setup(() => 68);
const owner69 = defineContext("owner-69")
	.flags({ "owner-flag-69": { type: "string" } })
	.setup(() => 69);
const owner70 = defineContext("owner-70")
	.flags({ "owner-flag-70": { type: "string" } })
	.setup(() => 70);
const owner71 = defineContext("owner-71")
	.flags({ "owner-flag-71": { type: "string" } })
	.setup(() => 71);
const owner72 = defineContext("owner-72")
	.flags({ "owner-flag-72": { type: "string" } })
	.setup(() => 72);
const owner73 = defineContext("owner-73")
	.flags({ "owner-flag-73": { type: "string" } })
	.setup(() => 73);
const owner74 = defineContext("owner-74")
	.flags({ "owner-flag-74": { type: "string" } })
	.setup(() => 74);
const owner75 = defineContext("owner-75")
	.flags({ "owner-flag-75": { type: "string" } })
	.setup(() => 75);
const owner76 = defineContext("owner-76")
	.flags({ "owner-flag-76": { type: "string" } })
	.setup(() => 76);
const owner77 = defineContext("owner-77")
	.flags({ "owner-flag-77": { type: "string" } })
	.setup(() => 77);
const owner78 = defineContext("owner-78")
	.flags({ "owner-flag-78": { type: "string" } })
	.setup(() => 78);
const owner79 = defineContext("owner-79")
	.flags({ "owner-flag-79": { type: "string" } })
	.setup(() => 79);
const owner80 = defineContext("owner-80")
	.flags({ "owner-flag-80": { type: "string" } })
	.setup(() => 80);
const owner81 = defineContext("owner-81")
	.flags({ "owner-flag-81": { type: "string" } })
	.setup(() => 81);
const owner82 = defineContext("owner-82")
	.flags({ "owner-flag-82": { type: "string" } })
	.setup(() => 82);
const owner83 = defineContext("owner-83")
	.flags({ "owner-flag-83": { type: "string" } })
	.setup(() => 83);
const owner84 = defineContext("owner-84")
	.flags({ "owner-flag-84": { type: "string" } })
	.setup(() => 84);
const owner85 = defineContext("owner-85")
	.flags({ "owner-flag-85": { type: "string" } })
	.setup(() => 85);
const owner86 = defineContext("owner-86")
	.flags({ "owner-flag-86": { type: "string" } })
	.setup(() => 86);
const owner87 = defineContext("owner-87")
	.flags({ "owner-flag-87": { type: "string" } })
	.setup(() => 87);
const owner88 = defineContext("owner-88")
	.flags({ "owner-flag-88": { type: "string" } })
	.setup(() => 88);
const owner89 = defineContext("owner-89")
	.flags({ "owner-flag-89": { type: "string" } })
	.setup(() => 89);
const owner90 = defineContext("owner-90")
	.flags({ "owner-flag-90": { type: "string" } })
	.setup(() => 90);
const owner91 = defineContext("owner-91")
	.flags({ "owner-flag-91": { type: "string" } })
	.setup(() => 91);
const owner92 = defineContext("owner-92")
	.flags({ "owner-flag-92": { type: "string" } })
	.setup(() => 92);
const owner93 = defineContext("owner-93")
	.flags({ "owner-flag-93": { type: "string" } })
	.setup(() => 93);
const owner94 = defineContext("owner-94")
	.flags({ "owner-flag-94": { type: "string" } })
	.setup(() => 94);
const owner95 = defineContext("owner-95")
	.flags({ "owner-flag-95": { type: "string" } })
	.setup(() => 95);
const owner96 = defineContext("owner-96")
	.flags({ "owner-flag-96": { type: "string" } })
	.setup(() => 96);
const owner97 = defineContext("owner-97")
	.flags({ "owner-flag-97": { type: "string" } })
	.setup(() => 97);
const owner98 = defineContext("owner-98")
	.flags({ "owner-flag-98": { type: "string" } })
	.setup(() => 98);
const owner99 = defineContext("owner-99")
	.flags({ "owner-flag-99": { type: "string" } })
	.setup(() => 99);
const owner100 = defineContext("owner-100")
	.flags({ "owner-flag-100": { type: "string" } })
	.setup(() => 100);
const owner101 = defineContext("owner-101")
	.flags({ "owner-flag-101": { type: "string" } })
	.setup(() => 101);
const owner102 = defineContext("owner-102")
	.flags({ "owner-flag-102": { type: "string" } })
	.setup(() => 102);
const owner103 = defineContext("owner-103")
	.flags({ "owner-flag-103": { type: "string" } })
	.setup(() => 103);
const owner104 = defineContext("owner-104")
	.flags({ "owner-flag-104": { type: "string" } })
	.setup(() => 104);
const owner105 = defineContext("owner-105")
	.flags({ "owner-flag-105": { type: "string" } })
	.setup(() => 105);
const owner106 = defineContext("owner-106")
	.flags({ "owner-flag-106": { type: "string" } })
	.setup(() => 106);
const owner107 = defineContext("owner-107")
	.flags({ "owner-flag-107": { type: "string" } })
	.setup(() => 107);
const owner108 = defineContext("owner-108")
	.flags({ "owner-flag-108": { type: "string" } })
	.setup(() => 108);
const owner109 = defineContext("owner-109")
	.flags({ "owner-flag-109": { type: "string" } })
	.setup(() => 109);
const owner110 = defineContext("owner-110")
	.flags({ "owner-flag-110": { type: "string" } })
	.setup(() => 110);
const owner111 = defineContext("owner-111")
	.flags({ "owner-flag-111": { type: "string" } })
	.setup(() => 111);
const owner112 = defineContext("owner-112")
	.flags({ "owner-flag-112": { type: "string" } })
	.setup(() => 112);
const owner113 = defineContext("owner-113")
	.flags({ "owner-flag-113": { type: "string" } })
	.setup(() => 113);
const owner114 = defineContext("owner-114")
	.flags({ "owner-flag-114": { type: "string" } })
	.setup(() => 114);
const owner115 = defineContext("owner-115")
	.flags({ "owner-flag-115": { type: "string" } })
	.setup(() => 115);
const owner116 = defineContext("owner-116")
	.flags({ "owner-flag-116": { type: "string" } })
	.setup(() => 116);
const owner117 = defineContext("owner-117")
	.flags({ "owner-flag-117": { type: "string" } })
	.setup(() => 117);
const owner118 = defineContext("owner-118")
	.flags({ "owner-flag-118": { type: "string" } })
	.setup(() => 118);
const owner119 = defineContext("owner-119")
	.flags({ "owner-flag-119": { type: "string" } })
	.setup(() => 119);
function _typecheckChainedProvideCalls() {
	new Crust("chained-provide")
		.provide(owner0())
		.provide(owner1())
		.provide(owner2())
		.provide(owner3())
		.provide(owner4())
		.provide(owner5())
		.provide(owner6())
		.provide(owner7())
		.provide(owner8())
		.provide(owner9())
		.provide(owner10())
		.provide(owner11())
		.provide(owner12())
		.provide(owner13())
		.provide(owner14())
		.provide(owner15())
		.provide(owner16())
		.provide(owner17())
		.provide(owner18())
		.provide(owner19())
		.provide(owner20())
		.provide(owner21())
		.provide(owner22())
		.provide(owner23())
		.provide(owner24())
		.provide(owner25())
		.provide(owner26())
		.provide(owner27())
		.provide(owner28())
		.provide(owner29())
		.provide(owner30())
		.provide(owner31())
		.provide(owner32())
		.provide(owner33())
		.provide(owner34())
		.provide(owner35())
		.provide(owner36())
		.provide(owner37())
		.provide(owner38())
		.provide(owner39())
		.provide(owner40())
		.provide(owner41())
		.provide(owner42())
		.provide(owner43())
		.provide(owner44())
		.provide(owner45())
		.provide(owner46())
		.provide(owner47())
		.provide(owner48())
		.provide(owner49())
		.provide(owner50())
		.provide(owner51())
		.provide(owner52())
		.provide(owner53())
		.provide(owner54())
		.provide(owner55())
		.provide(owner56())
		.provide(owner57())
		.provide(owner58())
		.provide(owner59())
		.provide(owner60())
		.provide(owner61())
		.provide(owner62())
		.provide(owner63())
		.provide(owner64())
		.provide(owner65())
		.provide(owner66())
		.provide(owner67())
		.provide(owner68())
		.provide(owner69())
		.provide(owner70())
		.provide(owner71())
		.provide(owner72())
		.provide(owner73())
		.provide(owner74())
		.provide(owner75())
		.provide(owner76())
		.provide(owner77())
		.provide(owner78())
		.provide(owner79())
		.provide(owner80())
		.provide(owner81())
		.provide(owner82())
		.provide(owner83())
		.provide(owner84())
		.provide(owner85())
		.provide(owner86())
		.provide(owner87())
		.provide(owner88())
		.provide(owner89())
		.provide(owner90())
		.provide(owner91())
		.provide(owner92())
		.provide(owner93())
		.provide(owner94())
		.provide(owner95())
		.provide(owner96())
		.provide(owner97())
		.provide(owner98())
		.provide(owner99())
		.provide(owner100())
		.provide(owner101())
		.provide(owner102())
		.provide(owner103())
		.provide(owner104())
		.provide(owner105())
		.provide(owner106())
		.provide(owner107())
		.provide(owner108())
		.provide(owner109())
		.provide(owner110())
		.provide(owner111())
		.provide(owner112())
		.provide(owner113())
		.provide(owner114())
		.provide(owner115())
		.provide(owner116())
		.provide(owner117())
		.provide(owner118())
		.provide(owner119())
		.action(async ({ ctx, flags }) => {
			type _firstContext = Expect<Equal<Awaited<(typeof ctx)["owner-0"]>, number>>;
			type _lastContext = Expect<Equal<Awaited<(typeof ctx)["owner-119"]>, number>>;
			type _firstFlag = Expect<Equal<(typeof flags)["owner-flag-0"], string | undefined>>;
			type _middleFlag = Expect<Equal<(typeof flags)["owner-flag-60"], string | undefined>>;
			type _lastFlag = Expect<Equal<(typeof flags)["owner-flag-119"], string | undefined>>;
		});
}

// 120 chained Extension and Context builder `.flags()` calls must not hit TS2589.
function _typecheckChainedBuilderFlagsCalls() {
	const extension = defineExtension(defineExtensionId("chained-flags"))
		.flags({ "extension-flag-0": { type: "string" } })
		.flags({ "extension-flag-1": { type: "string" } })
		.flags({ "extension-flag-2": { type: "string" } })
		.flags({ "extension-flag-3": { type: "string" } })
		.flags({ "extension-flag-4": { type: "string" } })
		.flags({ "extension-flag-5": { type: "string" } })
		.flags({ "extension-flag-6": { type: "string" } })
		.flags({ "extension-flag-7": { type: "string" } })
		.flags({ "extension-flag-8": { type: "string" } })
		.flags({ "extension-flag-9": { type: "string" } })
		.flags({ "extension-flag-10": { type: "string" } })
		.flags({ "extension-flag-11": { type: "string" } })
		.flags({ "extension-flag-12": { type: "string" } })
		.flags({ "extension-flag-13": { type: "string" } })
		.flags({ "extension-flag-14": { type: "string" } })
		.flags({ "extension-flag-15": { type: "string" } })
		.flags({ "extension-flag-16": { type: "string" } })
		.flags({ "extension-flag-17": { type: "string" } })
		.flags({ "extension-flag-18": { type: "string" } })
		.flags({ "extension-flag-19": { type: "string" } })
		.flags({ "extension-flag-20": { type: "string" } })
		.flags({ "extension-flag-21": { type: "string" } })
		.flags({ "extension-flag-22": { type: "string" } })
		.flags({ "extension-flag-23": { type: "string" } })
		.flags({ "extension-flag-24": { type: "string" } })
		.flags({ "extension-flag-25": { type: "string" } })
		.flags({ "extension-flag-26": { type: "string" } })
		.flags({ "extension-flag-27": { type: "string" } })
		.flags({ "extension-flag-28": { type: "string" } })
		.flags({ "extension-flag-29": { type: "string" } })
		.flags({ "extension-flag-30": { type: "string" } })
		.flags({ "extension-flag-31": { type: "string" } })
		.flags({ "extension-flag-32": { type: "string" } })
		.flags({ "extension-flag-33": { type: "string" } })
		.flags({ "extension-flag-34": { type: "string" } })
		.flags({ "extension-flag-35": { type: "string" } })
		.flags({ "extension-flag-36": { type: "string" } })
		.flags({ "extension-flag-37": { type: "string" } })
		.flags({ "extension-flag-38": { type: "string" } })
		.flags({ "extension-flag-39": { type: "string" } })
		.flags({ "extension-flag-40": { type: "string" } })
		.flags({ "extension-flag-41": { type: "string" } })
		.flags({ "extension-flag-42": { type: "string" } })
		.flags({ "extension-flag-43": { type: "string" } })
		.flags({ "extension-flag-44": { type: "string" } })
		.flags({ "extension-flag-45": { type: "string" } })
		.flags({ "extension-flag-46": { type: "string" } })
		.flags({ "extension-flag-47": { type: "string" } })
		.flags({ "extension-flag-48": { type: "string" } })
		.flags({ "extension-flag-49": { type: "string" } })
		.flags({ "extension-flag-50": { type: "string" } })
		.flags({ "extension-flag-51": { type: "string" } })
		.flags({ "extension-flag-52": { type: "string" } })
		.flags({ "extension-flag-53": { type: "string" } })
		.flags({ "extension-flag-54": { type: "string" } })
		.flags({ "extension-flag-55": { type: "string" } })
		.flags({ "extension-flag-56": { type: "string" } })
		.flags({ "extension-flag-57": { type: "string" } })
		.flags({ "extension-flag-58": { type: "string" } })
		.flags({ "extension-flag-59": { type: "string" } })
		.flags({ "extension-flag-60": { type: "string" } })
		.flags({ "extension-flag-61": { type: "string" } })
		.flags({ "extension-flag-62": { type: "string" } })
		.flags({ "extension-flag-63": { type: "string" } })
		.flags({ "extension-flag-64": { type: "string" } })
		.flags({ "extension-flag-65": { type: "string" } })
		.flags({ "extension-flag-66": { type: "string" } })
		.flags({ "extension-flag-67": { type: "string" } })
		.flags({ "extension-flag-68": { type: "string" } })
		.flags({ "extension-flag-69": { type: "string" } })
		.flags({ "extension-flag-70": { type: "string" } })
		.flags({ "extension-flag-71": { type: "string" } })
		.flags({ "extension-flag-72": { type: "string" } })
		.flags({ "extension-flag-73": { type: "string" } })
		.flags({ "extension-flag-74": { type: "string" } })
		.flags({ "extension-flag-75": { type: "string" } })
		.flags({ "extension-flag-76": { type: "string" } })
		.flags({ "extension-flag-77": { type: "string" } })
		.flags({ "extension-flag-78": { type: "string" } })
		.flags({ "extension-flag-79": { type: "string" } })
		.flags({ "extension-flag-80": { type: "string" } })
		.flags({ "extension-flag-81": { type: "string" } })
		.flags({ "extension-flag-82": { type: "string" } })
		.flags({ "extension-flag-83": { type: "string" } })
		.flags({ "extension-flag-84": { type: "string" } })
		.flags({ "extension-flag-85": { type: "string" } })
		.flags({ "extension-flag-86": { type: "string" } })
		.flags({ "extension-flag-87": { type: "string" } })
		.flags({ "extension-flag-88": { type: "string" } })
		.flags({ "extension-flag-89": { type: "string" } })
		.flags({ "extension-flag-90": { type: "string" } })
		.flags({ "extension-flag-91": { type: "string" } })
		.flags({ "extension-flag-92": { type: "string" } })
		.flags({ "extension-flag-93": { type: "string" } })
		.flags({ "extension-flag-94": { type: "string" } })
		.flags({ "extension-flag-95": { type: "string" } })
		.flags({ "extension-flag-96": { type: "string" } })
		.flags({ "extension-flag-97": { type: "string" } })
		.flags({ "extension-flag-98": { type: "string" } })
		.flags({ "extension-flag-99": { type: "string" } })
		.flags({ "extension-flag-100": { type: "string" } })
		.flags({ "extension-flag-101": { type: "string" } })
		.flags({ "extension-flag-102": { type: "string" } })
		.flags({ "extension-flag-103": { type: "string" } })
		.flags({ "extension-flag-104": { type: "string" } })
		.flags({ "extension-flag-105": { type: "string" } })
		.flags({ "extension-flag-106": { type: "string" } })
		.flags({ "extension-flag-107": { type: "string" } })
		.flags({ "extension-flag-108": { type: "string" } })
		.flags({ "extension-flag-109": { type: "string" } })
		.flags({ "extension-flag-110": { type: "string" } })
		.flags({ "extension-flag-111": { type: "string" } })
		.flags({ "extension-flag-112": { type: "string" } })
		.flags({ "extension-flag-113": { type: "string" } })
		.flags({ "extension-flag-114": { type: "string" } })
		.flags({ "extension-flag-115": { type: "string" } })
		.flags({ "extension-flag-116": { type: "string" } })
		.flags({ "extension-flag-117": { type: "string" } })
		.flags({ "extension-flag-118": { type: "string" } })
		.flags({ "extension-flag-119": { type: "string" } });
	const context = defineContext("chained-flags")
		.flags({ "context-flag-0": { type: "string" } })
		.flags({ "context-flag-1": { type: "string" } })
		.flags({ "context-flag-2": { type: "string" } })
		.flags({ "context-flag-3": { type: "string" } })
		.flags({ "context-flag-4": { type: "string" } })
		.flags({ "context-flag-5": { type: "string" } })
		.flags({ "context-flag-6": { type: "string" } })
		.flags({ "context-flag-7": { type: "string" } })
		.flags({ "context-flag-8": { type: "string" } })
		.flags({ "context-flag-9": { type: "string" } })
		.flags({ "context-flag-10": { type: "string" } })
		.flags({ "context-flag-11": { type: "string" } })
		.flags({ "context-flag-12": { type: "string" } })
		.flags({ "context-flag-13": { type: "string" } })
		.flags({ "context-flag-14": { type: "string" } })
		.flags({ "context-flag-15": { type: "string" } })
		.flags({ "context-flag-16": { type: "string" } })
		.flags({ "context-flag-17": { type: "string" } })
		.flags({ "context-flag-18": { type: "string" } })
		.flags({ "context-flag-19": { type: "string" } })
		.flags({ "context-flag-20": { type: "string" } })
		.flags({ "context-flag-21": { type: "string" } })
		.flags({ "context-flag-22": { type: "string" } })
		.flags({ "context-flag-23": { type: "string" } })
		.flags({ "context-flag-24": { type: "string" } })
		.flags({ "context-flag-25": { type: "string" } })
		.flags({ "context-flag-26": { type: "string" } })
		.flags({ "context-flag-27": { type: "string" } })
		.flags({ "context-flag-28": { type: "string" } })
		.flags({ "context-flag-29": { type: "string" } })
		.flags({ "context-flag-30": { type: "string" } })
		.flags({ "context-flag-31": { type: "string" } })
		.flags({ "context-flag-32": { type: "string" } })
		.flags({ "context-flag-33": { type: "string" } })
		.flags({ "context-flag-34": { type: "string" } })
		.flags({ "context-flag-35": { type: "string" } })
		.flags({ "context-flag-36": { type: "string" } })
		.flags({ "context-flag-37": { type: "string" } })
		.flags({ "context-flag-38": { type: "string" } })
		.flags({ "context-flag-39": { type: "string" } })
		.flags({ "context-flag-40": { type: "string" } })
		.flags({ "context-flag-41": { type: "string" } })
		.flags({ "context-flag-42": { type: "string" } })
		.flags({ "context-flag-43": { type: "string" } })
		.flags({ "context-flag-44": { type: "string" } })
		.flags({ "context-flag-45": { type: "string" } })
		.flags({ "context-flag-46": { type: "string" } })
		.flags({ "context-flag-47": { type: "string" } })
		.flags({ "context-flag-48": { type: "string" } })
		.flags({ "context-flag-49": { type: "string" } })
		.flags({ "context-flag-50": { type: "string" } })
		.flags({ "context-flag-51": { type: "string" } })
		.flags({ "context-flag-52": { type: "string" } })
		.flags({ "context-flag-53": { type: "string" } })
		.flags({ "context-flag-54": { type: "string" } })
		.flags({ "context-flag-55": { type: "string" } })
		.flags({ "context-flag-56": { type: "string" } })
		.flags({ "context-flag-57": { type: "string" } })
		.flags({ "context-flag-58": { type: "string" } })
		.flags({ "context-flag-59": { type: "string" } })
		.flags({ "context-flag-60": { type: "string" } })
		.flags({ "context-flag-61": { type: "string" } })
		.flags({ "context-flag-62": { type: "string" } })
		.flags({ "context-flag-63": { type: "string" } })
		.flags({ "context-flag-64": { type: "string" } })
		.flags({ "context-flag-65": { type: "string" } })
		.flags({ "context-flag-66": { type: "string" } })
		.flags({ "context-flag-67": { type: "string" } })
		.flags({ "context-flag-68": { type: "string" } })
		.flags({ "context-flag-69": { type: "string" } })
		.flags({ "context-flag-70": { type: "string" } })
		.flags({ "context-flag-71": { type: "string" } })
		.flags({ "context-flag-72": { type: "string" } })
		.flags({ "context-flag-73": { type: "string" } })
		.flags({ "context-flag-74": { type: "string" } })
		.flags({ "context-flag-75": { type: "string" } })
		.flags({ "context-flag-76": { type: "string" } })
		.flags({ "context-flag-77": { type: "string" } })
		.flags({ "context-flag-78": { type: "string" } })
		.flags({ "context-flag-79": { type: "string" } })
		.flags({ "context-flag-80": { type: "string" } })
		.flags({ "context-flag-81": { type: "string" } })
		.flags({ "context-flag-82": { type: "string" } })
		.flags({ "context-flag-83": { type: "string" } })
		.flags({ "context-flag-84": { type: "string" } })
		.flags({ "context-flag-85": { type: "string" } })
		.flags({ "context-flag-86": { type: "string" } })
		.flags({ "context-flag-87": { type: "string" } })
		.flags({ "context-flag-88": { type: "string" } })
		.flags({ "context-flag-89": { type: "string" } })
		.flags({ "context-flag-90": { type: "string" } })
		.flags({ "context-flag-91": { type: "string" } })
		.flags({ "context-flag-92": { type: "string" } })
		.flags({ "context-flag-93": { type: "string" } })
		.flags({ "context-flag-94": { type: "string" } })
		.flags({ "context-flag-95": { type: "string" } })
		.flags({ "context-flag-96": { type: "string" } })
		.flags({ "context-flag-97": { type: "string" } })
		.flags({ "context-flag-98": { type: "string" } })
		.flags({ "context-flag-99": { type: "string" } })
		.flags({ "context-flag-100": { type: "string" } })
		.flags({ "context-flag-101": { type: "string" } })
		.flags({ "context-flag-102": { type: "string" } })
		.flags({ "context-flag-103": { type: "string" } })
		.flags({ "context-flag-104": { type: "string" } })
		.flags({ "context-flag-105": { type: "string" } })
		.flags({ "context-flag-106": { type: "string" } })
		.flags({ "context-flag-107": { type: "string" } })
		.flags({ "context-flag-108": { type: "string" } })
		.flags({ "context-flag-109": { type: "string" } })
		.flags({ "context-flag-110": { type: "string" } })
		.flags({ "context-flag-111": { type: "string" } })
		.flags({ "context-flag-112": { type: "string" } })
		.flags({ "context-flag-113": { type: "string" } })
		.flags({ "context-flag-114": { type: "string" } })
		.flags({ "context-flag-115": { type: "string" } })
		.flags({ "context-flag-116": { type: "string" } })
		.flags({ "context-flag-117": { type: "string" } })
		.flags({ "context-flag-118": { type: "string" } })
		.flags({ "context-flag-119": { type: "string" } })
		.setup(() => 0);
	new Crust("chained-builders")
		.extend(extension)
		.provide(context())
		.action(({ flags }) => {
			type _extensionFirst = Expect<Equal<(typeof flags)["extension-flag-0"], string | undefined>>;
			type _extensionMiddle = Expect<
				Equal<(typeof flags)["extension-flag-60"], string | undefined>
			>;
			type _extensionFlag = Expect<Equal<(typeof flags)["extension-flag-119"], string | undefined>>;
			type _contextFirst = Expect<Equal<(typeof flags)["context-flag-0"], string | undefined>>;
			type _contextMiddle = Expect<Equal<(typeof flags)["context-flag-60"], string | undefined>>;
			type _contextFlag = Expect<Equal<(typeof flags)["context-flag-119"], string | undefined>>;
		});
}
