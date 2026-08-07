import { defineContext, defineFlag } from "@crustjs/core";

const verbose = defineFlag("verbose", { type: "boolean", short: "v" });

export const logger = defineContext("logger", { ownFlags: [verbose] }, ({ flags }) => ({
  write(message: string) {
    if (flags.verbose) console.error(message);
  },
}));
