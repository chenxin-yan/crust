import { defineContext, defineFlag } from "@crustjs/core";

const verbose = defineFlag("verbose", { type: "boolean" });

export const logger = defineContext("logger", { flags: [verbose] }, ({ flags, stderr }) => ({
  write(message: string) {
    if (flags.verbose) stderr(message);
  },
}));
