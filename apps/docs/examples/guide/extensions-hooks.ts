import { Crust, defineExtension } from "@crustjs/core";

export const outcomes = defineExtension("acme:outcomes")
	.flags({ skip: { type: "boolean" } })
	.handle("skip", () => {}) // [!code highlight]
	// [!code highlight:2]
	.postRun((ctx, outcome) => {
		ctx.stdout(`outcome: ${outcome.status}`);
		//                             ^?
	});

const completed = new Crust("app").extend(outcomes).action(() => {});
console.log((await completed.run([])).stdout); // => "outcome: completed\n"
console.log((await completed.run([], { flags: { skip: true } })).stdout);
// => "outcome: handled\n"

const failed = new Crust("app").extend(outcomes).action(() => {
	throw new Error("boom");
});
console.log((await failed.run([])).stdout); // => "outcome: failed\n"
