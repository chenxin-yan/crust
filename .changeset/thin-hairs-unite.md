---
"@crustjs/create": minor
---

Add an optional `render` callback to `scaffold()` for using a template engine. It receives each text file's contents and `context`, may return a string or a promise, and replaces the built-in `{{key}}` interpolation. Binary files are still copied unchanged, and destination conflict and symlink checks still run before any file is rendered.
