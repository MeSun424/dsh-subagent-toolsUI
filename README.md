# dsh-subagent-tools

User-controlled subagent models and adaptive reasoning for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

| [English](README.md) | [中文](README.zh.md) |
| --- | --- |

## What it does

- **Choose the subagent model per session.** The selector uses the same model directory as Harness, with `Inherit` pinned at the top.
- **Inherit the parent model by default.** New sessions start without changing the parent route.
- **Lock future children to a selected model.** Changing the selection affects subagents created afterwards. Children that are already running keep the model they started with.
- **Let the parent AI choose reasoning effort.** Each delegation can use an effort published by the selected model, such as `off`, `high`, or `max`.
- **Expose model capabilities to the parent AI.** The current route, available effort levels, and confirmed image-input support are made available for task planning. Unknown image support is treated as text-only.
- **Keep the controls available across top-level Harness modes.** The feature is not tied to a single custom preset.
- **Fit the Harness interface.** The selector uses native icons, layout slots, and theme variables, so it follows light and dark themes without a separate dashboard.
- **Retain the useful delegation controls.** `persona`, `toolFilter`, and delegation backend selection remain available for each child.

## Why it is different

Most DSH subagent extensions stop at a static preset or a one-call override. This plugin makes model routing a normal part of the session workflow:

- The **user controls the route** from the conversation UI instead of editing a preset or relying on the parent model to invent a model id.
- The **parent AI controls effort per task**, using only the levels the selected model actually reports.
- A model change is **forward-looking and predictable**: it applies to new children and never interrupts children already in progress.
- The same integration can be used from different top-level modes, so a deployment does not need a separate copy of the subagent setup for every mode.

The result is a practical split of responsibilities: the user chooses where work runs, while the parent AI decides how much reasoning each new child needs.

## Installation

Install the repository with the Harness plugin command:

```sh
dsh plugin --profile web add /path/to/dsh-subagent-tools
```

You can use a cloned repository path or a Git repository URL supported by your Harness installation. Restart the web profile and create a new session after installation. A session keeps the plugin composition it was created with, so existing sessions may need to be reopened.

## Using the selector

1. Open the subagent model selector in the conversation toolbar.
2. Choose **Inherit** to follow the parent model, or choose a fixed model for future children in this session.
3. Leave the selector unchanged to keep the parent route. Change it at any time; the next child uses the new choice.

The parent AI can set `reasoningEffort` for each new child. The plugin does not assume every model supports the same levels: only the selected model's published values are used. For example, a DeepSeek V4 Flash route may expose `off`, `high`, and `max`.

## Multimodal handling

The parent AI is told whether the selected route has confirmed image-input support. Missing or unverified capability information is handled conservatively as text-only, so visual tasks are not sent to a model that has not declared image support.

## Compatibility

This release targets DeepSeek Harness `0.1.0-rc.6`. Harness is still evolving; recheck the plugin after upgrading to a release with changed model-selection or subagent APIs.

## License and attribution

MIT License. This project is based on [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools), with additional session-level model selection, reasoning-effort routing, capability reporting, and Harness UI integration.
