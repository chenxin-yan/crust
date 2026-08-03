import { defineExtension } from "@crustjs/core";

//#region cached
export const cached = defineExtension("cached", {
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
export const serviceErrors = defineExtension("service-errors", {
  hooks: {
    onError(error, ctx) {
      if (!(error instanceof Error) || error.name !== "ServiceUnavailableError") return;
      ctx.stderr(error.message);
      return true;
    },
  },
});
//#endregion
