---
"@crustjs/config": minor
---

`config.extension` supplies the files' values through core's new `defaults` hook, so where it is listed in `.extend()` no longer matters. The files are read only when the command's action will run, after `--input` is bound and before `prompts()` asks: a flag given in `--input` never fails on a broken file, a broken file fails the run before any question, and a `-C` Extension that changes the working directory in its `setup` may be listed anywhere.
