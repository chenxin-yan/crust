import { scaffold } from "./scaffold.ts";

// A call that would write nothing does not compile: `template`, `files`, or both.
// @ts-expect-error neither `template` nor `files`
void scaffold({ dest: "out" });
void scaffold({ dest: "out", template: "templates/base" });
void scaffold({ dest: "out", files: { "README.md": "# app\n" } });
void scaffold({ dest: "out", template: "templates/base", files: { "README.md": "# app\n" } });
// @ts-expect-error `files` values are text: binaries belong in the template
void scaffold({ dest: "out", files: { "logo.png": new Uint8Array() } });
