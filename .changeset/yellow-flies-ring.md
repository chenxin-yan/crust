---
"@crustjs/core": minor
"@crustjs/extensions": patch
"@crustjs/skills": patch
"@crustjs/man": patch
---

Add `runtime(value)` for explicit checked command names and structured invocation. The wrapper does not validate or copy values; the consuming operation checks them against the actual command. Checked known-path calls retain action result types, while wrapped dynamic paths return an unknown result.

Require supplied positional inputs to form a prefix and required core variadics without defaults to be nonempty. Keep prevalidation parser arrays potentially empty. Reject invalid literal command names, repeated flag spellings, and invalid short-flag lengths at compile time.

A bare `Crust` type now has an empty argument tuple. Prefer inferred builders, `AnyCrust` for completed-app inspection, execute, and checked run (not authoring), or `Crust<Flags, ArgsDef>` for an explicitly open argument state. Open input states require checked invocation. Explicit earlier class type arguments prevent inference of the trailing name parameter; use `runtime(name)` for those constructor calls. Migrate Extensions and Skills dynamic command-name callers.

Require explicit checked Context, command, and Extension collections when destination relations are unproven. Check declared availability without constructing Contexts, and consume Extension factory/section results when produced. Metadata requirements remain TypeScript-owned. Keep unknown namespaces open instead of treating them as empty proof. Infinite template-literal and branded names require `runtime(name)`; template-valued choice members require checked membership. Uncertain primitive kinds and definition unions require checked supplied inputs, and exported input types no longer treat conditional flag records or possibly-required fields as empty.

Own structural definition arrays without cloning JSON, URL, schema, callback, or Context option payloads. Consume immutable Context/Extension defining data through structural copies and preserve command recipe proof independently of public phantom fields. Prevent explicitly empty Context, command, and root holders from erasing retained relation state.

Preserve precise return types for built-in static Extension factories. Completion and Skills have configurable command names and require `.extend(runtime([extension]))`. Preserve Context/Extension replacement ordering. Runtime identity checks reject supplied canonical flag keys retired by actual same-ID Extension replacement, unless a current definition supplies that key.

Keep demanded Context callback values type-safe on ordinary and checked attachment, including every conditional recipe and nested provider branch used by Extension hooks. Compatible and unrelated replacements remain supported; unknown outputs cannot establish a known demand. Keep hook demands separate from contributed command/provider attachment requirements.

Checked canonical Extension command replacement uses the surviving shape; open replacements no longer retain stale child result types. Check pending Extension flag relations at checked consumption and carry checked ownership into delayed recipes. Remove duplicate trusted graph, parser-result, default-choice, and structured-input checks while preserving CLI/schema/post-transform validation and finishing-hook behavior.

Flag and argument helper results are shallow-frozen because their exposed local proof is reused at later checked consumption. Their structural collections are copied and conditional definition fields remain distinct; user payload identity remains unchanged.
