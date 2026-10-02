# dsh-subagent-toolsUI

[English](README.md) · 简体中文

为 DeepSeek Harness 提供会话级子智能体模型选择。在对话工具栏中，可以让子智能体继承主模型，也可以为当前会话指定独立的子智能体模型。

![子代理模型选择器](docs/images/subagent-model-selector.png)

模型选择按会话保存。普通派遣和 fork 创建的子智能体均采用该设置，便于在不同对话中分别配置主模型与子智能体模型。

## 安装

当前适配 DeepSeek Harness 桌面版 `0.2.0-rc.2` 和网页版 `0.1.5`；桌面版已在 macOS 上验证。

### 桌面版

1. 打开左侧「插件」页面，选择「添加插件」。
2. 在安装地址中填入：

   ```text
   github:MeSun424/dsh-subagent-toolsUI
   ```

3. 完成安装后启用插件，退出并重新打开 Harness。

打开对话后，输入框旁的工具栏会显示「子代理模型」选择器。

如果使用本地 `.tgz` 安装包，在安装地址中填写该文件的绝对路径即可。

<details>
<summary>macOS 命令行安装</summary>

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:MeSun424/dsh-subagent-toolsUI
```

执行完成后，退出并重新打开 Harness。

</details>

### 网页版

```sh
dsh plugin --profile web add github:MeSun424/dsh-subagent-toolsUI
```

安装后重启 Harness 网页服务，并刷新页面。

## 使用

打开需要配置的对话，点击工具栏中的「子代理模型」，选择以下任一方式：

| 选择方式 | 子智能体使用的模型 |
| --- | --- |
| 继承 | 创建时继承主模型的当前设置；主模型切换后，后续创建的子智能体随之使用新模型。 |
| 指定模型 | 使用选定的模型；主模型切换不会改变该会话的子智能体模型设置。 |

设置可随时调整，**仅对之后创建的子智能体生效**。已经创建的子智能体继续使用原模型。

选择器设置的是模型，推理强度仍由主模型在派遣时根据任务和所选模型的能力决定。插件也会向主模型提供可确认的图片输入能力；能力未知时按文本模型处理。

启用 Harness 的子智能体模型白名单后，可选模型会受该名单限制。

### 与 Agent Teams 配合使用

启用实验性 Agent Teams 后，插件会提供以下工具，供主模型继续管理普通子智能体：

| 工具 | 用途 |
| --- | --- |
| `list_subagents` | 查看可继续对话的子智能体及其状态。 |
| `steer_subagent` | 向子智能体发送补充要求或后续任务。 |
| `stop_subagent` | 请求停止子智能体当前正在执行的任务。 |

这些工具由主模型调用，无需在界面中手动输入参数。

## 常见问题

### 安装后没有显示选择器

确认插件页面中的 `dsh-subagent-tools-ui` 已启用，然后完全退出并重新打开桌面版；使用网页版时，重启网页服务并刷新页面。请在主对话中查看工具栏，子智能体对话不显示该选择器。

### 找不到需要的模型

选择器使用 Harness 中已配置的模型列表。请检查对应的模型服务是否已启用，以及子智能体模型白名单是否允许该模型。

### 如何更新插件

在「插件」页面卸载旧版本，按上述步骤重新安装并启用，再重启 Harness。通过 GitHub 地址安装时会获取仓库中的当前版本。

## 许可证与致谢

采用 [MIT 许可证](LICENSE)，基于 [lynx-gt/dsh-subagent-tools](https://github.com/lynx-gt/dsh-subagent-tools) 开发。
