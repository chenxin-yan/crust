import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

export const app = new Crust("my-cli")
  .extend(help())
  .mount(
    defineCommand("build", (command) =>
      command
        .flags({ name: "minify", type: "boolean" })
        .handle(({ flags, stdout }) => stdout(`minify: ${flags.minify ?? false}`)),
    ),
  );
