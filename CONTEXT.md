# Crust

Crust is a TypeScript-first framework for defining and distributing command-line applications.

## Language

**Application Author**:
A developer who builds a command-line application with Crust's supported command-authoring API.
_Avoid_: End user, consumer

**Extension Author**:
A developer who builds reusable capabilities for Crust applications through the supported extension-authoring API.
_Avoid_: Plugin author, tooling author

**Extension**:
An application-wide reusable capability that owns any commands or flags it contributes to a Crust application.
_Avoid_: Plugin, add-on, middleware

**Context**:
A named command dependency inherited by descendant commands and constructed only when its command path is executed.
_Avoid_: Application singleton, global, arbitrary context bag

**Command Handler**:
The function that implements a command's behavior after its inputs and Contexts are ready.
_Avoid_: Action, callback, runner

**Command Snapshot**:
A readonly, serializable description of a command exposed across public API boundaries.
_Avoid_: Command node, command tree, runtime node
