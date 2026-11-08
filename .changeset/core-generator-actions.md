---
"@crustjs/core": minor
---

Command Actions can stream events as `async function*` generators: each `yield` emits an event and the `return` value becomes the result, validated by `.output()` when declared. `run()` and `execute()` take an `onEvent(event)` option that receives each event live, an Extension's `Renderer` gets `stream()` once before the first event and `event(value)` per yield, and the `run()` outcome and `postRun`'s `InvocationOutcome` carry the yielded values as `events` (`[]` for a generator that yields nothing; absent for ordinary actions), typed from the yields in `run()`. Events are never printed by default. Cancellation, or a throwing renderer `event` or `onEvent` callback, closes the generator with `return()` and fails the invocation, keeping the events yielded so far.
