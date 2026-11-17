---
"@crustjs/extensions": minor
---

New `telemetry({ env, enabled, send })` Extension: after each invocation it passes one event, `{ command, outcome, durationMs, ci }`, to your `send`. `command` is the command path (`["acme", "deploy"]`), never argument or flag values; `outcome` is `completed`, `failed`, or `handled`. Crust has no network code and no default: `enabled` is `"opt-in"` (sends only when the user sets the `env` variable, such as `ACME_TELEMETRY=1`) or `"opt-out"` (sends unless it is `0` or `false`), and `DO_NOT_TRACK` set to anything but empty or `0` turns it off in both modes. `send(event, { signal })` is waited for at most 1 second, when `signal` aborts with a `TimeoutError`: pass it to your request so it does not keep the process alive. Its failures are ignored. Routing failures before setup send nothing.
