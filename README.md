# dsh-subagent-toolsUI

English · [简体中文](README.zh.md)

Choose a subagent model for each DeepSeek Harness conversation. The conversation toolbar lets you inherit the main model or select a separate model for subagents.

![Subagent model selector](docs/images/subagent-model-selector.png)

Your choice is saved per conversation and applies to subagents created through both regular delegation and fork. Each conversation can use its own combination of main and subagent models.

## Installation

Compatible with DeepSeek Harness Desktop `0.2.0-rc.2` and Web `0.1.5`. Desktop compatibility has been verified on macOS.

### Desktop

1. Open **Plugins** in the sidebar and select **Add plugin**.
2. Enter this installation address:

   ```text
   github:MeSun424/dsh-subagent-toolsUI
   ```

3. Complete the installation, enable the plugin, then quit and reopen Harness.

Open a conversation to find the subagent model selector in the toolbar beside the message input.

To install a local `.tgz` package instead, enter its absolute file path as the installation address.

<details>
<summary>Command-line installation on macOS</summary>

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:MeSun424/dsh-subagent-toolsUI
```

Quit and reopen Harness after installation.

</details>

### Web

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

Restart the Harness web service and refresh the page after installation.

## Usage

Open the conversation you want to configure, click the subagent model selector, and choose one of these options:

| Option | Model used by subagents |
| --- | --- |
| Inherit | Uses the main model's current settings at creation. After you switch the main model, newly created subagents inherit the new model. |
| Select a model | Uses your selected model. Switching the main model does not change this conversation's subagent model setting. |

You can change the selection at any time. **Changes apply only to subagents created afterward.** Existing subagents continue using their original model.

The selector controls the model. The main model still chooses reasoning effort for each delegation according to the task and the selected model's capabilities. The plugin also provides confirmed image-input capabilities to the main model; unknown image support is treated as text-only.

If you enable Harness's subagent model allowlist, the available choices are restricted to that list.

### Using Agent Teams

When experimental Agent Teams is enabled, the plugin provides these tools so the main model can continue managing regular subagents:

| Tool | Purpose |
| --- | --- |
| `list_subagents` | Lists subagents that support follow-up conversations and their status. |
| `steer_subagent` | Sends additional instructions or a follow-up task to a subagent. |
| `stop_subagent` | Requests that a subagent stop its current task. |

The main model calls these tools. You do not need to enter their parameters in the interface.

## Common questions

### The selector does not appear after installation

Check that `dsh-subagent-tools-ui` is enabled on the Plugins page, then fully quit and reopen Desktop. For Web, restart the web service and refresh the page. Look in the main conversation's toolbar; the selector is not shown in subagent conversations.

### A model is missing from the list

The selector uses the models configured in Harness. Check that the corresponding model provider is enabled and that the subagent model allowlist permits the model.

### How do I update the plugin?

Uninstall the previous version from the Plugins page, reinstall and enable it using the steps above, then restart Harness. Installing from the GitHub address retrieves the repository's current version.

## License and acknowledgments

Licensed under [MIT](LICENSE). Based on [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools).
