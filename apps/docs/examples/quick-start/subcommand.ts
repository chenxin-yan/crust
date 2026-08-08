import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

export const app = new Crust("my-cli")
  .extend(help())
  .add(
    defineCommand("build", (command) =>
      command
        .flags({ name: "minify", type: "boolean" })
        .action(({ flags, stdout }) => stdout(`minify: ${flags.minify ?? false}`)),
    ),
  );
