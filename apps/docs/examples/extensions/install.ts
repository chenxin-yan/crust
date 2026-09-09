import { Crust, runtime } from "@crustjs/core";
import {
  completion,
  didYouMean,
  help,
  noColor,
  updateNotifier,
  version,
} from "@crustjs/extensions";

export const app = new Crust("my-cli", { version: "0.2.0" }).extend(
  runtime([
    help(),
    version(),
    completion(),
    didYouMean(),
    noColor(),
    updateNotifier({ packageName: "my-cli" }),
  ]),
);
