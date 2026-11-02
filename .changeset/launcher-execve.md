---
"@crustjs/crust": minor
---

On macOS and Linux, the generated npm launcher now replaces itself with the platform binary (`process.execve`) instead of running it as a child process. Signals and the exit status now belong to the binary alone, as if it ran directly: a `SIGINT` sent to the launcher's PID inside a terminal is no longer dropped, and a `SIGINT` sent to the whole process group without a terminal no longer arrives twice. The launcher needs Node.js `^22.15.0 || >=23.11.0`, which the root package now declares in `engines.node` (library `exports` keep your range), and prints the required version on unsupported Node.js. It also loads faster, since it no longer imports Node.js modules at startup. Windows, which has no `execve`, keeps the spawning launcher.
