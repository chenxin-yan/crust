import { defineExtension, defineExtensionId } from "@crustjs/core";

//#region cached
export const cached = defineExtension(defineExtensionId("cached"), {
  flags: [{ name: "cached", type: "boolean" }],
  hooks: {
    preRun(ctx) {
      if (ctx.flags.cached !== true) return;
      ctx.stdout("cached result");
      return ctx.finish();
    },
  },
});
//#endregion

//#region service-errors
export const serviceErrors = defineExtension(defineExtensionId("service-errors"), {
  hooks: {
    onError(error, ctx) {
      if (!(error instanceof Error) || error.name !== "ServiceUnavailableError") return;
      ctx.stderr(error.message);
      return true;
    },
  },
});
//#endregion
