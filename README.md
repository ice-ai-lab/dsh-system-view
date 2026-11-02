# dsh-system-view

在 DSH 会话区的「对话」「轨迹」旁新增一个 **「系统」Tab**，聚合展示当前会话的上下文生效情况：系统提示词、请求实际携带的工具列表、可用 Skills 和请求配置。参考 [dsh-mcp-lazy](../dsh-mcp-lazy/) 的插件形态，是一个**双面 bundle**（Node 半 inert 占位 + 浏览器客户端半承载全部能力）。

## 展示什么

| 二级页 | 内容 | 数据来源 |
|---|---|---|
| 提示词 | 当前生效的系统提示词全文，字符数、历史内更新标记、搜索、复制 | `system/message` 会话事件（surface 折叠语义与轨迹视图一致） |
| 工具 | 当前请求实际携带的完整工具列表（名称 + 描述 + 参数 schema，可搜索、可展开）。开着 `dsh-mcp-lazy` 时显示的就是 `ToolSearch`/`DeferExecuteTool` 这类**生效面**，被隐藏的 `mcp__*` 不会出现 | `request/header` 事件的 `header.tools`（每轮请求实际组装结果） |
| Skills | `<available_skills>` 目录块的解析结果（名称 + 摘要卡片）；无法解析时回退展示原始块 | 系统提示词文本 |
| 配置 | provider/model/温度/最大 token/推理力度/上下文窗口等请求配置 + 适配器默认值 + 原始 JSON | `request/header` 事件的 `header.config` + `request/context` 事件的 `contextWindow` |

所有数据都从**已提交的会话事件**重建，不发起任何 I/O，不向模型请求注入任何内容——满足 DSH「模型可见 ⟺ 可由会话日志重建」的仓库级规则。

## 实现机制

- **Tab 注入**：`ctx.slots.inject("conversation.view", …)` 注册 `id: "system", order: 20` 的视图 entry，与官方 chat（order 0）、trajectory（order 10）并列。这是文档化的扩展点（`docs/subsystems/slots.md`，`replaceRisk: none`）。
- **数据折叠**：三个 Conversation 事件 Definition（`uiConversation.events.register`）挂在插件私有的 `systemView` target 上，复用 `uiConversation` 服务暴露的纯函数解释器 `inspectSystemPrompt` / `inspectRequestPrompt`（客户端 bundle 不能值导入其他插件模块，所以走服务方法 seam，与轨迹视图同一条路径），`request/context` 事件由插件自己的 Definition 直接解析。
- **组件取数**：`ctx.uiSession.provide({ hooks: ["systemView"] })` 声明标准 hook，组件经 `useSystemView(selector)` prop 订阅 target 快照。
- **客户端 bundle**：`client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 闭包工厂格式，外部依赖仅 `react` 与 `react/jsx-runtime`（平台模块表提供），无构建步骤。宿主经 package.json 的 `dsh.client` 声明自动扫描并把 bundle 注入 `window.__DSH_BOOT__`。

## 安装

在 DSH 会话中：

```
plugin_manager install_bundle target=/Users/gatesma/project/DeepseekHarness/plugins/dsh-system-view
```

安装后**刷新 Web GUI 页面**（客户端 bundle 随页面启动加载），新会话或已有会话的会话区头部即出现「系统」Tab。

## 验证

1. 页面加载无控制台报错，Tab 出现在「轨迹」右侧。
2. 新会话发起第一轮对话后，「提示词」「工具」「配置」页出现内容；概览条显示模型、工具数、Skills 数。
3. 「工具」页搜索 `ToolSearch` 可见（启用 dsh-mcp-lazy 时），搜索 `mcp__` 无结果。
4. 「Skills」页显示当前目录块的 skill 卡片。
5. 「配置」页显示「上下文窗口」行，值来自 `request/context` 事件（如 GLM 路由显示 1000000）。

## 已知边界

- 历史加载遵循会话窗口分页：长会话重启后初始窗口在尾部，「系统」Tab 激活时会自动向上补载直到生效上下文出现；也可手动滚到对话顶部触发。
- Skills 解析只认 `- \`name\`: summary` 列表形态；目录块格式变化时回退原始文本展示，不影响其他页。
- 视图是纯展示层；不做任何写操作，也不提供修改配置的入口。
