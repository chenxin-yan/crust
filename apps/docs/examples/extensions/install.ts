import { Crust } from "@crustjs/core";
import {
  completion,
  didYouMean,
  help,
  noColor,
  updateNotifier,
  version,
} from "@crustjs/extensions";

const currentVersion = "0.2.0";

export const app = new Crust("my-cli", { version: currentVersion }).extend(
  help(),
  version(),
  completion(),
  didYouMean(),
  noColor(),
  updateNotifier({ packageName: "my-cli", currentVersion }),
);
