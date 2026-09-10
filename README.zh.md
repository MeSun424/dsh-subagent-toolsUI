# dsh-subagent-toolsUI

在 DeepSeek Harness 的对话工具栏里，给子代理选模型。

默认先看 [英文说明](README.md)。

![子代理模型选择器](docs/images/subagent-model-selector.png)

Harness 0.1.5 可以让主模型给子代理选模型，但那是全局名单，真正点选的还是主模型。Fork 默认也会跟着主模型走。

这个插件把选择放进当前对话。你可以继续继承主模型，也可以给这个会话里之后新建的子代理锁一个模型。主模型还是按任务选思考强度，不要自己编模型 ID。

## 能做什么

- 对话输入栏旁边有一个子代理模型选择器
- 可以继承主模型，也可以锁死后续子代理用的模型
- 普通派遣和 fork 都跟这个选择走
- 思考强度仍然每次单独选
- 如果 Harness 设置里开了子代理模型白名单，选择器只显示名单里的模型
- 会告诉主模型当前选择支不支持图片；说不清就按纯文本处理
- `persona`、工具过滤、spawn/fork 这些原来的参数还能用

改选择只影响之后新建的子代理。已经在跑的，还是创建时的模型。

## 安装

需要 DeepSeek Harness 0.1.5 或更高版本。

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

装完重启 web profile，再开一个新对话。旧对话还是创建时的状态。

如果以前的版本生成过 `standard-plus` preset，把默认 preset 改回 `standard`。官方子代理工具不用改。

## 怎么用

1. 打开对话，看输入框旁边的工具栏。
2. 保持「继承」，或者给后续子代理选一个模型。
3. 随时可以改，只有下一次新建的子代理会换模型。

主模型创建子代理时可以带 `reasoning_effort`。只能用当前模型公布过的档位，比如 DeepSeek V4 Flash 上的 `off`、`high`、`max`。

## 其他

目前只在 macOS 的 Harness 网页版上用过。Windows 和 Linux 没测。

MIT 许可证。基于 [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools)。
