---
"@crustjs/core": minor
"@crustjs/skills": minor
"@crustjs/utils": minor
---

`artifactPath(path)` replaces `resolveArtifactDir(name)` and accepts a path below a shipped directory, so files shipped with your CLI no longer need a `join`.

```ts
import { artifactPath } from "@crustjs/core";

const template = artifactPath("templates/base");
const schema = readFileSync(artifactPath("data/schema.json"), "utf8");
```

The path starts with an Extension artifact or `crust.include` directory name. An absolute path, an empty, `.`, or `..` segment, or a segment starting with a drive such as `D:` throws.

`loadPackagedSkills()` reads the skills shipped with the CLI when called without a directory.

**Behavior change:** `resolveArtifactDir()` is removed from `@crustjs/core`. Rename each call to `artifactPath()`; a single directory name works as before.
