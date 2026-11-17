---
"@crustjs/crust": minor
---

`crust build` keeps one copy of a build artifact that several bins write at the same path with the same bytes, such as the data files of one API they share. Different bytes at the same path still fail the build, naming both bins.
