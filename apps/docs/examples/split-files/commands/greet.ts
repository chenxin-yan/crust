import { defineCommand } from "@crustjs/core";

import { logger, verbose } from "../shared.ts";

export const greetCommand = defineCommand("greet", { flags: [verbose], ctx: [logger] }, (command) =>
  command
    .args({ name: "name", type: "string", default: "world" })
    .flags({ name: "greeting", type: "string", default: "Hello", short: "g" })
    .handle(({ args, flags, ctx, stdout }) => {
      if (flags.verbose) ctx.logger.write("Preparing greeting");
      stdout(`${flags.greeting}, ${args.name}!`);
    }),
);
