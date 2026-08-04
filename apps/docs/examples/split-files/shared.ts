import { defineContext, defineFlag } from "@crustjs/core";

export const verbose = defineFlag("verbose", { type: "boolean", inherit: true });

export const logger = defineContext("logger", () => ({
  write(message: string) {
    console.error(message);
  },
}));
