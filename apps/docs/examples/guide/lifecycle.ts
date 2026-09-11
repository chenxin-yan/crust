import {
  Crust,
  defineContext,
  defineExtension,
  defineExtensionId,
} from "@crustjs/core";

//#region order
const resource = defineContext("resource", ({ stdout }) => ({
  [Symbol.asyncDispose]() {
    stdout("dispose");
  },
}));

const trace = defineExtension(defineExtensionId("trace"), {
  hooks: {
    preRun({ stdout }) {
      stdout("preRun");
    },
    postRun({ stdout }, outcome) {
      stdout(`postRun:${outcome.status}`);
    },
  },
});

const app = new Crust("work")
  .provide(resource())
  .extend(trace)
  .action(async ({ ctx, stdout }) => {
    await ctx.resource;
    stdout("action");
  });

const outcome = await app.run([]);
console.log(outcome.stdout);
// preRun
// action
// postRun:completed
// dispose
//#endregion
