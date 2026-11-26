import { scaffold } from "./scaffold.ts";

// A call that would write nothing does not compile: `copy`, `write`, or both.
// @ts-expect-error neither `copy` nor `write`
void scaffold({ dest: "out" });
void scaffold({ dest: "out", copy: "templates/base" });
void scaffold({ dest: "out", write: { "README.md": "# app\n" } });
void scaffold({ dest: "out", copy: "templates/base", write: { "README.md": "# app\n" } });
// @ts-expect-error `write` values are text: binaries belong in the directory to copy
void scaffold({ dest: "out", write: { "logo.png": new Uint8Array() } });
