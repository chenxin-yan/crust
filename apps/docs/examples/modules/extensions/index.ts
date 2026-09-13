import { Crust } from "@crustjs/core";
import {
  completion,
  didYouMean,
  help,
  noColor,
  updateNotifier,
  version,
} from "@crustjs/extensions";

export const app = new Crust("my-cli", { version: "0.2.0" }).extend(
  noColor(),
  help(),
  version(),
  completion(),
  didYouMean(),
  updateNotifier({ packageName: "my-cli" }),
);
