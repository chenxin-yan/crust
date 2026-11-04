// A consumer that uses only help(): tracks that every other extension in the
// single-file dist tree-shakes away (each factory call is `/* @__PURE__ */`).
import { help } from "@crustjs/extensions";

export const helpExtension = help();
