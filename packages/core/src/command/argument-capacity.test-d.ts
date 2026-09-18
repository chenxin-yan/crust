import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "./crust.ts";

// Capacity regression, not a checker-speed or editor-responsiveness benchmark.
const fifty = new Crust("capacity")
	.args({ name: "a0", type: "string" })
	.args({ name: "a1", type: "string" })
	.args({ name: "a2", type: "string" })
	.args({ name: "a3", type: "string" })
	.args({ name: "a4", type: "string" })
	.args({ name: "a5", type: "string" })
	.args({ name: "a6", type: "string" })
	.args({ name: "a7", type: "string" })
	.args({ name: "a8", type: "string" })
	.args({ name: "a9", type: "string" })
	.args({ name: "a10", type: "string" })
	.args({ name: "a11", type: "string" })
	.args({ name: "a12", type: "string" })
	.args({ name: "a13", type: "string" })
	.args({ name: "a14", type: "string" })
	.args({ name: "a15", type: "string" })
	.args({ name: "a16", type: "string" })
	.args({ name: "a17", type: "string" })
	.args({ name: "a18", type: "string" })
	.args({ name: "a19", type: "string" })
	.args({ name: "a20", type: "string" })
	.args({ name: "a21", type: "string" })
	.args({ name: "a22", type: "string" })
	.args({ name: "a23", type: "string" })
	.args({ name: "a24", type: "string" })
	.args({ name: "a25", type: "string" })
	.args({ name: "a26", type: "string" })
	.args({ name: "a27", type: "string" })
	.args({ name: "a28", type: "string" })
	.args({ name: "a29", type: "string" })
	.args({ name: "a30", type: "string" })
	.args({ name: "a31", type: "string" })
	.args({ name: "a32", type: "string" })
	.args({ name: "a33", type: "string" })
	.args({ name: "a34", type: "string" })
	.args({ name: "a35", type: "string" })
	.args({ name: "a36", type: "string" })
	.args({ name: "a37", type: "string" })
	.args({ name: "a38", type: "string" })
	.args({ name: "a39", type: "string" })
	.args({ name: "a40", type: "string" })
	.args({ name: "a41", type: "string" })
	.args({ name: "a42", type: "string" })
	.args({ name: "a43", type: "string" })
	.args({ name: "a44", type: "string" })
	.args({ name: "a45", type: "string" })
	.args({ name: "a46", type: "string" })
	.args({ name: "a47", type: "string" })
	.args({ name: "a48", type: "string" })
	.args({ name: "a49", type: "string" })
	.action(({ args }) => {
		type _last = Expect<Equal<typeof args.a49, string | undefined>>;
		return args.a49;
	});

const hundred = fifty
	.args({ name: "a50", type: "string" })
	.args({ name: "a51", type: "string" })
	.args({ name: "a52", type: "string" })
	.args({ name: "a53", type: "string" })
	.args({ name: "a54", type: "string" })
	.args({ name: "a55", type: "string" })
	.args({ name: "a56", type: "string" })
	.args({ name: "a57", type: "string" })
	.args({ name: "a58", type: "string" })
	.args({ name: "a59", type: "string" })
	.args({ name: "a60", type: "string" })
	.args({ name: "a61", type: "string" })
	.args({ name: "a62", type: "string" })
	.args({ name: "a63", type: "string" })
	.args({ name: "a64", type: "string" })
	.args({ name: "a65", type: "string" })
	.args({ name: "a66", type: "string" })
	.args({ name: "a67", type: "string" })
	.args({ name: "a68", type: "string" })
	.args({ name: "a69", type: "string" })
	.args({ name: "a70", type: "string" })
	.args({ name: "a71", type: "string" })
	.args({ name: "a72", type: "string" })
	.args({ name: "a73", type: "string" })
	.args({ name: "a74", type: "string" })
	.args({ name: "a75", type: "string" })
	.args({ name: "a76", type: "string" })
	.args({ name: "a77", type: "string" })
	.args({ name: "a78", type: "string" })
	.args({ name: "a79", type: "string" })
	.args({ name: "a80", type: "string" })
	.args({ name: "a81", type: "string" })
	.args({ name: "a82", type: "string" })
	.args({ name: "a83", type: "string" })
	.args({ name: "a84", type: "string" })
	.args({ name: "a85", type: "string" })
	.args({ name: "a86", type: "string" })
	.args({ name: "a87", type: "string" })
	.args({ name: "a88", type: "string" })
	.args({ name: "a89", type: "string" })
	.args({ name: "a90", type: "string" })
	.args({ name: "a91", type: "string" })
	.args({ name: "a92", type: "string" })
	.args({ name: "a93", type: "string" })
	.args({ name: "a94", type: "string" })
	.args({ name: "a95", type: "string" })
	.args({ name: "a96", type: "string" })
	.args({ name: "a97", type: "string" })
	.args({ name: "a98", type: "string" })
	.args({ name: "a99", type: "string" })
	.action(({ args }) => {
		type _last = Expect<Equal<typeof args.a99, string | undefined>>;
		return args.a99;
	});

declare const fiftyValues: { [D in (typeof fifty)["_types"]["args"][number] as D["name"]]: string };
declare const hundredValues: {
	[D in (typeof hundred)["_types"]["args"][number] as D["name"]]: string;
};
void fifty.run([], { args: fiftyValues });
void hundred.run([], { args: hundredValues });
// @ts-expect-error A long chain must not weaken positional prefix validation.
void fifty.run([], { args: { a49: "gap" } });
// @ts-expect-error The 100-argument input still requires all earlier positions.
void hundred.run([], { args: { a99: "gap" } });
