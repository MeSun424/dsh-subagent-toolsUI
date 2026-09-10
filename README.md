# dsh-subagent-toolsUI

Pick the model your subagents use, from the DeepSeek Harness toolbar.

English is the default. [中文说明](README.zh.md)

![Subagent model selector](docs/images/subagent-model-selector.png)

DeepSeek Harness 0.1.5 can let the main model choose a subagent model. That is a global list, and the main model still makes the call. Forks also stay on the parent model unless you change them.

This plugin puts the choice in the current chat. You can inherit the parent model, or lock a model for later subagents in that session. The main model can still pick thinking strength. It should not invent a model id.

## What you get

- A selector in the conversation toolbar
- Inherit the parent model, or lock one model for later subagents
- Spawn and fork both follow that lock
- Thinking strength is still chosen per task
- If Harness has an allowlist turned on, the selector only shows those models
- The main model is told whether the chosen model can take images; if that is unknown, treat it as text-only
- Existing extras still work: persona, tool filter, and spawn/fork backend

A change only applies to subagents created after that. Ones already running keep the model they started with.

## Install

Needs DeepSeek Harness 0.1.5 or later.

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

Restart the web profile, then open a new chat. Older chats keep whatever they were created with.

If an older version of this plugin created a `standard-plus` preset, switch the default preset back to `standard`. Leave the official subagent tools as they are.

## Use

1. Open a chat and look at the toolbar next to the input.
2. Leave it on Inherit, or pick a model for later subagents.
3. Change it whenever you want. Only the next subagent uses the new choice.

When the main model starts a subagent, it can set `reasoning_effort`. Use a value the selected model actually publishes, such as `off`, `high`, or `max` on DeepSeek V4 Flash.

## Notes

This has been used on macOS with the Harness web profile. Windows and Linux have not been tested.

MIT license. Based on [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools).
