import { Crust, defineExtension } from "@crustjs/core";

export const quiet = defineExtension("acme:quiet")
	.flags({ quiet: { type: "boolean" } })
	// [!code highlight:4]
	.renderer((ctx) =>
		// Drop what the action writes to stdout; keep its diagnostics.
		ctx.flags.quiet === true ? { text: () => {}, diag: ctx.stderr.write } : undefined,
	);

const app = new Crust("app").extend(quiet).action(({ stdout }) => {
	stdout("deployed");
});
console.log((await app.run([])).stdout); // => "deployed\n"
console.log((await app.run([], { flags: { quiet: true } })).stdout); // => ""
