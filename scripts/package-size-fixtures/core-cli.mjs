// Minimal executable CLI: one flag, one action. Bundled with the finished-build
// define `crust build` applies, so this row tracks what a shipped CLI pays.
import { Crust, defineFlag } from "@crustjs/core";

await new Crust("probe")
	.flags(defineFlag("name", { type: "string", default: "world" }))
	.action(({ flags, stdout }) => stdout(`Hello ${flags.name}`))
	.execute();
