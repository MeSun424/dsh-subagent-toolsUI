# dsh-subagent-toolsUI

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 0.1.5 及后续版本提供按会话锁定的子代理模型选择。

| [English](README.md) | [中文](README.zh.md) |
| --- | --- |

## 界面展示

选择器在对话工具栏里。可以继续继承主模型，也可以为这个会话里之后新建的子代理锁定一个模型。

![子代理模型选择器](docs/images/subagent-model-selector.png)

## 功能

Harness 0.1.5 已经允许主模型从主机白名单里给子代理选模型。这个插件不替换那套官方运行时，只在上面加一层**按会话的用户锁**。

- **子代理路由由用户决定。** 默认继承主模型，也可以钉死后续子代理要用的模型。
- **思考强度仍由主 AI 按次选择。** 每次委派都可以带 `reasoning_effort`（旧的 `reasoningEffort` 也能用）。
- **spawn 和 fork 都认这把锁。** 用户锁定后，`provider` / `model` 参数不能改路由；fork 也不会偷偷留在主模型上。
- **真正干活的还是官方工具。** `subagent`、`subagent_fork`、后台/可续跑任务，以及 `list_subagent_models` 仍然来自 `@deepseek-ai/dsh-tool-subagent`。
- **官方白名单继续生效。** 如果 Harness 设置里打开了子代理模型选择，工具栏只显示允许的路由。
- **能力提示还在。** 主 AI 能看到当前路由、已公布的思考档位，以及是否明确支持图片输入。无法确认时按纯文本处理。
- **原来的附加参数还在。** 每次调用仍可使用 `persona`、`toolFilter` 和 `backend`（spawn/fork）。

改选择器只影响之后新建的子代理，已经在跑的子代理继续用创建时的模型。

## 为什么官方设置替代不了它

官方 0.1.5 的能力是**全局白名单**。主模型从名单里挑子代理路由，fork 默认继续走主模型。

这个插件是工具栏里的**会话锁**。用户选择继承或固定模型；主 AI 不能自己编一个模型 ID，fork 也要跟这把锁。

两者可以一起用：Harness 限制哪些模型能出现，这个插件决定当前对话实际用哪一个。

## 安装

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

本地克隆目录，或当前 Harness 支持的 Git 地址都可以。安装后重启 web profile，并新建会话。已经存在的会话会沿用创建时的插件组合。

不要把 agent preset 改成指向这个包。`subagent` / `subagent_fork` 应继续使用 `@deepseek-ai/dsh-tool-subagent`。如果旧版 0.4.10 生成过 `standard-plus` preset，请把默认 preset 改回 `standard`。

## 使用模型选择器

1. 在对话工具栏打开子代理模型选择器。
2. 选“继承”跟随主模型，或选一个固定模型给后续子代理用。
3. 可以随时改，只有下一次新建的子代理会用新选择。

主 AI 可以按任务设置 `reasoning_effort`。只能用当前模型公布的档位。例如 DeepSeek V4 Flash 可能提供 `off`、`high`、`max`。

## 兼容性

当前版本面向 DeepSeek Harness `0.1.5-rc.1`，以及继续保留官方 `dsh-tool-subagent` 模型选择契约的后续版本。它不修改 Harness 源码，不改写 preset，也不替换官方 spawn/fork 运行时。

目前只在 macOS 的 Harness web profile 上验证过。Windows 和 Linux 未测试。

## 许可证

MIT 许可证。本项目基于 [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools)，现在把会话级锁定、思考强度、能力提示和工具栏选择叠在官方 0.1.5 工具之上。
