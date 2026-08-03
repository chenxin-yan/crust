import { Crust } from "@crustjs/core";
import {
  completion,
  didYouMean,
  help,
  noColor,
  updateNotifier,
  version,
} from "@crustjs/extensions";

export const app = new Crust("my-cli").extend(
  help(),
  version("0.2.0"),
  completion(),
  didYouMean(),
  noColor(),
  updateNotifier({ packageName: "my-cli", currentVersion: "0.2.0" }),
);
