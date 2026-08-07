---
name: demo
description: Manage demo deployments.
metadata:
  version: "1.0.0"
---

# demo

Manage demo deployments.

You should use this skill when you need accurate help with `demo` commands, including command selection, syntax, arguments, flags, defaults, and subcommands.

## How to Use This Skill

1. You must find the command that best matches the user's task from the Command Reference below.
2. You must check the `Type` column before suggesting execution: `runnable` and `runnable, group` commands can be executed, while `group` commands are organizational only.
3. You should read only the linked file or files you need from `commands/`.
4. You must read a command's file before answering a command-specific question or suggesting that command.
5. You must treat the command file as the source of truth for usage, arguments, flags, aliases, and defaults.
6. If a flag, argument, alias, or default is not documented there, you must say it is not documented instead of guessing.

## Command Reference

You should use this table to locate the command file you need.

| Command | Type | Documentation |
| ------- | ---- | ------------- |
| `demo` | group | [commands/demo.md](commands/demo.md) |
| `demo __complete` | runnable | [commands/__complete.md](commands/__complete.md) |
| `demo deploy` | group | [commands/deploy.md](commands/deploy.md) |
| `demo deploy status` | runnable | [commands/deploy/status.md](commands/deploy/status.md) |
