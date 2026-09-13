import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const outcomes = defineExtension(defineExtensionId("acme:outcomes"), {
  flags: [{ name: "finish", type: "boolean" }],
  hooks: {
    preRun(ctx) {
      if (ctx.flags.finish === true) return ctx.finish();
    },
    postRun(ctx, outcome) {
      ctx.stdout(`outcome: ${outcome.status}`);
    },
  },
});

const completed = new Crust("app").extend(outcomes).action(() => {});
console.log((await completed.run([])).stdout); // => "outcome: completed"
console.log((await completed.run([], { flags: { finish: true } })).stdout);
// => "outcome: finished"

const failed = new Crust("app").extend(outcomes).action(() => {
  throw new Error("boom");
});
console.log((await failed.run([])).stdout); // => "outcome: failed"
