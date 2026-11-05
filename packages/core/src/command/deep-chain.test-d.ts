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

// 45+ Extensions in one `.extend()` call must not hit TS2589 (excessively deep instantiation)
const e0 = defineExtension(defineExtensionId("e0"))
	.flags({ name: "f0", type: "boolean" })
	.provide(p0())
	.add(defineCommand("ec0", (command) => command));
const e1 = defineExtension(defineExtensionId("e1"))
	.flags({ name: "f1", type: "boolean" })
	.provide(p1())
	.add(defineCommand("ec1", (command) => command));
const e2 = defineExtension(defineExtensionId("e2"))
	.flags({ name: "f2", type: "boolean" })
	.provide(p2())
	.add(defineCommand("ec2", (command) => command));
const e3 = defineExtension(defineExtensionId("e3"))
	.flags({ name: "f3", type: "boolean" })
	.provide(p3())
	.add(defineCommand("ec3", (command) => command));
const e4 = defineExtension(defineExtensionId("e4"))
	.flags({ name: "f4", type: "boolean" })
	.provide(p4())
	.add(defineCommand("ec4", (command) => command));
const e5 = defineExtension(defineExtensionId("e5"))
	.flags({ name: "f5", type: "boolean" })
	.provide(p5())
	.add(defineCommand("ec5", (command) => command));
const e6 = defineExtension(defineExtensionId("e6"))
	.flags({ name: "f6", type: "boolean" })
	.provide(p6())
	.add(defineCommand("ec6", (command) => command));
const e7 = defineExtension(defineExtensionId("e7"))
	.flags({ name: "f7", type: "boolean" })
	.provide(p7())
	.add(defineCommand("ec7", (command) => command));
const e8 = defineExtension(defineExtensionId("e8"))
	.flags({ name: "f8", type: "boolean" })
	.provide(p8())
	.add(defineCommand("ec8", (command) => command));
const e9 = defineExtension(defineExtensionId("e9"))
	.flags({ name: "f9", type: "boolean" })
	.provide(p9())
	.add(defineCommand("ec9", (command) => command));
const e10 = defineExtension(defineExtensionId("e10"))
	.flags({ name: "f10", type: "boolean" })
	.provide(p10())
	.add(defineCommand("ec10", (command) => command));
const e11 = defineExtension(defineExtensionId("e11"))
	.flags({ name: "f11", type: "boolean" })
	.provide(p11())
	.add(defineCommand("ec11", (command) => command));
const e12 = defineExtension(defineExtensionId("e12"))
	.flags({ name: "f12", type: "boolean" })
	.provide(p12())
	.add(defineCommand("ec12", (command) => command));
const e13 = defineExtension(defineExtensionId("e13"))
	.flags({ name: "f13", type: "boolean" })
	.provide(p13())
	.add(defineCommand("ec13", (command) => command));
const e14 = defineExtension(defineExtensionId("e14"))
	.flags({ name: "f14", type: "boolean" })
	.provide(p14())
	.add(defineCommand("ec14", (command) => command));
const e15 = defineExtension(defineExtensionId("e15"))
	.flags({ name: "f15", type: "boolean" })
	.provide(p15())
	.add(defineCommand("ec15", (command) => command));
const e16 = defineExtension(defineExtensionId("e16"))
	.flags({ name: "f16", type: "boolean" })
	.provide(p16())
	.add(defineCommand("ec16", (command) => command));
const e17 = defineExtension(defineExtensionId("e17"))
	.flags({ name: "f17", type: "boolean" })
	.provide(p17())
	.add(defineCommand("ec17", (command) => command));
const e18 = defineExtension(defineExtensionId("e18"))
	.flags({ name: "f18", type: "boolean" })
	.provide(p18())
	.add(defineCommand("ec18", (command) => command));
const e19 = defineExtension(defineExtensionId("e19"))
	.flags({ name: "f19", type: "boolean" })
	.provide(p19())
	.add(defineCommand("ec19", (command) => command));
const e20 = defineExtension(defineExtensionId("e20"))
	.flags({ name: "f20", type: "boolean" })
	.provide(p20())
	.add(defineCommand("ec20", (command) => command));
const e21 = defineExtension(defineExtensionId("e21"))
	.flags({ name: "f21", type: "boolean" })
	.provide(p21())
	.add(defineCommand("ec21", (command) => command));
const e22 = defineExtension(defineExtensionId("e22"))
	.flags({ name: "f22", type: "boolean" })
	.provide(p22())
	.add(defineCommand("ec22", (command) => command));
const e23 = defineExtension(defineExtensionId("e23"))
	.flags({ name: "f23", type: "boolean" })
	.provide(p23())
	.add(defineCommand("ec23", (command) => command));
const e24 = defineExtension(defineExtensionId("e24"))
	.flags({ name: "f24", type: "boolean" })
	.provide(p24())
	.add(defineCommand("ec24", (command) => command));
const e25 = defineExtension(defineExtensionId("e25"))
	.flags({ name: "f25", type: "boolean" })
	.provide(p25())
	.add(defineCommand("ec25", (command) => command));
const e26 = defineExtension(defineExtensionId("e26"))
	.flags({ name: "f26", type: "boolean" })
	.provide(p26())
	.add(defineCommand("ec26", (command) => command));
const e27 = defineExtension(defineExtensionId("e27"))
	.flags({ name: "f27", type: "boolean" })
	.provide(p27())
	.add(defineCommand("ec27", (command) => command));
const e28 = defineExtension(defineExtensionId("e28"))
	.flags({ name: "f28", type: "boolean" })
	.provide(p28())
	.add(defineCommand("ec28", (command) => command));
const e29 = defineExtension(defineExtensionId("e29"))
	.flags({ name: "f29", type: "boolean" })
	.provide(p29())
	.add(defineCommand("ec29", (command) => command));
const e30 = defineExtension(defineExtensionId("e30"))
	.flags({ name: "f30", type: "boolean" })
	.provide(p30())
	.add(defineCommand("ec30", (command) => command));
const e31 = defineExtension(defineExtensionId("e31"))
	.flags({ name: "f31", type: "boolean" })
	.provide(p31())
	.add(defineCommand("ec31", (command) => command));
const e32 = defineExtension(defineExtensionId("e32"))
	.flags({ name: "f32", type: "boolean" })
	.provide(p32())
	.add(defineCommand("ec32", (command) => command));
const e33 = defineExtension(defineExtensionId("e33"))
	.flags({ name: "f33", type: "boolean" })
	.provide(p33())
	.add(defineCommand("ec33", (command) => command));
const e34 = defineExtension(defineExtensionId("e34"))
	.flags({ name: "f34", type: "boolean" })
	.provide(p34())
	.add(defineCommand("ec34", (command) => command));
const e35 = defineExtension(defineExtensionId("e35"))
	.flags({ name: "f35", type: "boolean" })
	.provide(p35())
	.add(defineCommand("ec35", (command) => command));
const e36 = defineExtension(defineExtensionId("e36"))
	.flags({ name: "f36", type: "boolean" })
	.provide(p36())
	.add(defineCommand("ec36", (command) => command));
const e37 = defineExtension(defineExtensionId("e37"))
	.flags({ name: "f37", type: "boolean" })
	.provide(p37())
	.add(defineCommand("ec37", (command) => command));
const e38 = defineExtension(defineExtensionId("e38"))
	.flags({ name: "f38", type: "boolean" })
	.provide(p38())
	.add(defineCommand("ec38", (command) => command));
const e39 = defineExtension(defineExtensionId("e39"))
	.flags({ name: "f39", type: "boolean" })
	.provide(p39())
	.add(defineCommand("ec39", (command) => command));
const e40 = defineExtension(defineExtensionId("e40"))
	.flags({ name: "f40", type: "boolean" })
	.provide(p40())
	.add(defineCommand("ec40", (command) => command));
const e41 = defineExtension(defineExtensionId("e41"))
	.flags({ name: "f41", type: "boolean" })
	.provide(p41())
	.add(defineCommand("ec41", (command) => command));
const e42 = defineExtension(defineExtensionId("e42"))
	.flags({ name: "f42", type: "boolean" })
	.provide(p42())
	.add(defineCommand("ec42", (command) => command));
const e43 = defineExtension(defineExtensionId("e43"))
	.flags({ name: "f43", type: "boolean" })
	.provide(p43())
	.add(defineCommand("ec43", (command) => command));
const e44 = defineExtension(defineExtensionId("e44"))
	.flags({ name: "f44", type: "boolean" })
	.provide(p44())
	.add(defineCommand("ec44", (command) => command));
const e45 = defineExtension(defineExtensionId("e45"))
	.flags({ name: "f45", type: "boolean" })
	.provide(p45())
	.add(defineCommand("ec45", (command) => command));
const e46 = defineExtension(defineExtensionId("e46"))
	.flags({ name: "f46", type: "boolean" })
	.provide(p46())
	.add(defineCommand("ec46", (command) => command));
const e47 = defineExtension(defineExtensionId("e47"))
	.flags({ name: "f47", type: "boolean" })
	.provide(p47())
	.add(defineCommand("ec47", (command) => command));
const e48 = defineExtension(defineExtensionId("e48"))
	.flags({ name: "f48", type: "boolean" })
	.provide(p48())
	.add(defineCommand("ec48", (command) => command));
const e49 = defineExtension(defineExtensionId("e49"))
	.flags({ name: "f49", type: "boolean" })
	.provide(p49())
	.add(defineCommand("ec49", (command) => command));
const e50 = defineExtension(defineExtensionId("e50"))
	.flags({ name: "f50", type: "boolean" })
	.provide(p50())
	.add(defineCommand("ec50", (command) => command));
const e51 = defineExtension(defineExtensionId("e51"))
	.flags({ name: "f51", type: "boolean" })
	.provide(p51())
	.add(defineCommand("ec51", (command) => command));
const e52 = defineExtension(defineExtensionId("e52"))
	.flags({ name: "f52", type: "boolean" })
	.provide(p52())
	.add(defineCommand("ec52", (command) => command));
const e53 = defineExtension(defineExtensionId("e53"))
	.flags({ name: "f53", type: "boolean" })
	.provide(p53())
	.add(defineCommand("ec53", (command) => command));
const e54 = defineExtension(defineExtensionId("e54"))
	.flags({ name: "f54", type: "boolean" })
	.provide(p54())
	.add(defineCommand("ec54", (command) => command));
const e55 = defineExtension(defineExtensionId("e55"))
	.flags({ name: "f55", type: "boolean" })
	.provide(p55())
	.add(defineCommand("ec55", (command) => command));
const e56 = defineExtension(defineExtensionId("e56"))
	.flags({ name: "f56", type: "boolean" })
	.provide(p56())
	.add(defineCommand("ec56", (command) => command));
const e57 = defineExtension(defineExtensionId("e57"))
	.flags({ name: "f57", type: "boolean" })
	.provide(p57())
	.add(defineCommand("ec57", (command) => command));
const e58 = defineExtension(defineExtensionId("e58"))
	.flags({ name: "f58", type: "boolean" })
	.provide(p58())
	.add(defineCommand("ec58", (command) => command));
const e59 = defineExtension(defineExtensionId("e59"))
	.flags({ name: "f59", type: "boolean" })
	.provide(p59())
	.add(defineCommand("ec59", (command) => command));
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
