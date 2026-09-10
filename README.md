# dsh-subagent-toolsUI

User-controlled subagent model lock for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 0.1.5 and later.

| [English](README.md) | [中文](README.zh.md) |
| --- | --- |

## In the interface

The selector lives in the conversation toolbar. Keep inheriting the parent model, or lock a model for future subagents in this session.

![Subagent model selector](docs/images/subagent-model-selector.png)

## What it does

Harness 0.1.5 already lets the parent model pick a child route from a host allowlist. This plugin keeps that official runtime and adds a **per-session user lock** on top of it.

- **The user owns the child route.** Inherit the parent model, or pin a model for later children.
- **The parent AI owns effort.** Each call can still set `reasoning_effort` (`reasoningEffort` is accepted too).
- **Spawn and fork both honor the lock.** A locked route wins over `provider` / `model` arguments, including forks that would otherwise stay on the parent route.
- **Official tools keep doing the work.** `subagent`, `subagent_fork`, background/continuable jobs, and `list_subagent_models` stay on `@deepseek-ai/dsh-tool-subagent`.
- **Host allowlist is still respected.** If Harness settings enable subagent model selection, the toolbar only shows those routes.
- **Capability notices stay.** The parent AI sees the current route, published efforts, and confirmed image-input support. Unknown image support is treated as text-only.
- **Useful extras remain.** `persona`, `toolFilter`, and `backend` (spawn/fork) still work per call.

Changing the selector only affects children created afterwards. Running children keep the route they started with.

## Why the official setting is not a replacement

The official 0.1.5 control is a **global allowlist**. The parent model then chooses a route from that list, and forks stay on the parent route by default.

This plugin is a **session lock in the toolbar**. The user chooses inherit or a fixed model; the parent AI must not invent a model id, and forks follow the same lock.

Use both if you want: Harness can limit which models are allowed, while this plugin decides which allowed model a given conversation actually uses.

## Installation

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

A local clone or another Git URL that your Harness install accepts also works. Restart the web profile and open a new session afterwards. Existing sessions keep the composition they were created with.

Do not point agent presets at this package. Leave `subagent` / `subagent_fork` on `@deepseek-ai/dsh-tool-subagent`. Older 0.4.10 installs that created a `standard-plus` preset should switch the default preset back to `standard`.

## Using the selector

1. Open the subagent model control in the conversation toolbar.
2. Choose **Inherit** to follow the parent model, or choose a fixed model for later children.
3. Change it whenever you want; only the next child picks up the new choice.

The parent AI can set `reasoning_effort` per child. Only values published by the selected model are valid. DeepSeek V4 Flash, for example, may expose `off`, `high`, and `max`.

## Compatibility

This release targets DeepSeek Harness `0.1.5-rc.1` and later builds that keep the official `dsh-tool-subagent` model-selection contract. It does not patch Harness source, rewrite presets, or replace the official spawn/fork runtime.

Tested on macOS with the Harness web profile. Windows and Linux are untested.

## License

MIT License. This project started from [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools) and now layers session-level locking, effort routing, capability notices, and toolbar UI on the official 0.1.5 tools.
