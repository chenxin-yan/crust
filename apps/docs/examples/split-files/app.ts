import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";

import { logger, verbose } from "./shared.ts";

export const app = new Crust("my-cli")
  .meta({ description: "A split-file CLI" })
  .extend(version("0.2.0"), help())
  .flags(verbose)
  .provide(logger());
