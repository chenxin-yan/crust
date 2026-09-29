import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const outcomes = defineExtension(defineExtensionId("acme:outcomes"))
	.flags({ name: "skip", type: "boolean" })
	.preRun((ctx) => {
		if (ctx.flags.skip === true) return ctx.handled(); // [!code highlight]
	})
	// [!code highlight:2]
	.postRun((ctx, outcome) => {
		ctx.stdout(`outcome: ${outcome.status}`);
		//                             ^?
	});

const completed = new Crust("app").extend(outcomes).action(() => {});
console.log((await completed.run([])).stdout); // => "outcome: completed"
console.log((await completed.run([], { flags: { skip: true } })).stdout);
// => "outcome: handled"

const failed = new Crust("app").extend(outcomes).action(() => {
	throw new Error("boom");
});
console.log((await failed.run([])).stdout); // => "outcome: failed"
