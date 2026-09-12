import {
  Crust,
  CrustError,
  defineContext,
  defineExtension,
  defineExtensionId,
} from "@crustjs/core";

//#region crust-error
const regionSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "example",
    validate() {
      return { issues: [{ message: "Unknown region" }] };
    },
  },
};
const validatedApp = new Crust("deploy")
  .flags({ name: "region", type: "string", schema: regionSchema })
  .action(() => {});

const validationOutcome = await validatedApp.run([], { flags: { region: "unknown" } });
if (
  validationOutcome.status === "failed" &&
  validationOutcome.error instanceof CrustError &&
  validationOutcome.error.is("VALIDATION")
) {
  console.log(validationOutcome.error.code); // VALIDATION
}
//#endregion

//#region cleanup
const trace: string[] = [];
const resource = defineContext("resource", () => ({
  [Symbol.dispose]() {
    trace.push("dispose");
  },
}));
const lifecycle = defineExtension(defineExtensionId("lifecycle"), {
  hooks: {
    postRun(_ctx, outcome) {
      trace.push(`postRun: ${outcome.status}`);
    },
  },
});
const cleanupApp = new Crust("app")
  .provide(resource())
  .extend(lifecycle)
  .action(async ({ ctx }) => {
    await ctx.resource;
    throw new Error("service unavailable");
  });

await cleanupApp.run([]);
console.log(trace.join("\n"));
// postRun: failed
// dispose
//#endregion

//#region failed-outcome
const failure = new Error("service unavailable");
const programmaticApp = new Crust("app").action(({ stderr }) => {
  stderr("request started");
  throw failure;
});

const failedOutcome = await programmaticApp.run([]);
if (failedOutcome.status === "failed" && failedOutcome.error instanceof Error) {
  console.assert(failedOutcome.error === failure);
  console.log(`${failedOutcome.status}: ${failedOutcome.error.message}`);
  console.log(failedOutcome.stderr);
}
// failed: service unavailable
// request started
//#endregion

//#region terminal-presentation
const serviceErrors = defineExtension(defineExtensionId("service-errors"), {
  hooks: {
    onError(error, ctx) {
      if (!(error instanceof Error)) return;
      ctx.stderr(`Service error: ${error.message}`);
      return true;
    },
  },
});
const terminalApp = new Crust("app").extend(serviceErrors).action(() => {
  throw new Error("unavailable");
});
const rendered: string[] = [];
const exitCode = await terminalApp.execute({
  argv: [],
  io: { stderr: (text) => rendered.push(text) },
});

console.log(rendered.join("\n")); // Service error: unavailable
console.log(exitCode); // 1
//#endregion

//#region cancellation
const cancellableApp = new Crust("app").action(() => {
  throw new DOMException("Cancelled", "AbortError");
});
const cancellationOutcome = await cancellableApp.run([]);
if (
  cancellationOutcome.status === "failed" &&
  cancellationOutcome.error instanceof Error &&
  cancellationOutcome.error.name === "AbortError"
) {
  console.log("cancelled"); // cancelled
}
//#endregion
