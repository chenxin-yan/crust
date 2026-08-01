---
"@crustjs/testing": patch
---

Export the structural `RunnableApp` contract and accept any application with its `run(argv, io)` shape in `captureRun` and `interactiveRun`.

Inert command definitions are not directly runnable; mount them into an application before passing them to either helper.
