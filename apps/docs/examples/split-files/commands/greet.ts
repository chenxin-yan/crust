import { defineCommand } from "@crustjs/core";

import { logger } from "../shared.ts";

export const greetCommand = defineCommand("greet", { requires: [logger] }, (command) =>
  command
    .args({ name: "name", type: "string", default: "world" })
    .flags({ name: "greeting", type: "string", default: "Hello", short: "g" })
    .action(({ args, flags, ctx, stdout }) => {
      ctx.logger.write("Preparing greeting");
      stdout(`${flags.greeting}, ${args.name}!`);
    }),
);
