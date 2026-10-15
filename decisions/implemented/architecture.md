# cocode 酷码工作室 · Cocode Studio VideoForge

分类：architecture

## Problem

产品需要只加载三个自有插件、隐藏 DSH 默认 UI、使用独立多租户数据和固定模型。需求提供的 `dsh start --plugins` 不是本机 DSH 0.1.0-rc.6 支持的命令。用户追加明确要求模型自由生成代码，只做语法及引擎结构检查。

## Decision

使用原版 DSH CLI 启动空 `videoforge` profile；三个 Cordis `apply` 插件提供全部业务。UI 插件独立提供 HTTP 服务与 React 根，导演插件实现仅含三个视频工具的 Agent 调度，数据插件提供 `ctx.provide` 服务。项目独立 DSH_HOME，不修改现有全局配置。前端 `activate` 与宿主 `apply` 分离。

新生产队列在一次模型调用中生成全片结构化方案和完整 HTML，总时间线由模型编写；不再分别调用独立镜头生成，不使用固定视觉模板、固定方向或固定转场。motion-doctrine 单独前置，十个领域 Skill 完整常驻。检查覆盖语法、Hyperframes 契约、实际布局、对比度、主文案阅读时间、回退跳转一致性和成片媒体流。整片模式不自动调用模型修复。旧镜头工具保留兼容测试，测试样例不做生产回退。

JSON 存储限定单进程，所有修改串行化、原子替换；认证身份由服务端会话绑定。队列只在当前进程运行，重启把未完成任务标记失败。独立计量不因项目删除而消失。

## Alternatives considered

默认 Web profile 隐藏按钮不能保证默认工具/API 不加载，因此不采用。改 DSH 核心不符合要求。用户否定的模板型渲染已从生产路径移除。直接采用默认 DSH Session 不符合独立存储要求。

## Consequences

真实可用的启动命令与需求中的示例不同，统一封装为 npm start。账号与项目功能无需模型凭证即可工作，视频生成必须配置有效凭证。自由模型代码的渲染质量与外部资源可用性由实际输出决定，失败会明确显示。JSON 部署只支持一个服务实例。后续多进程扩容可替换数据服务和队列。

## 环境事实

DSH npm CLI 已公开，本机 0.1.0-rc.6 实际插件使用 @deepseek-ai/cordis 4.0.1。旧技能文档关于所有官方包未公开的描述不再适用于当前 npm 安装；依赖统一在宿主根声明，插件包不重复声明官方 peer。DSH 依赖版本范围会吸入更新 rc，因此锁定已实测闭包并交付 lockfile。

DSH rc 包有循环 peer 图；npm 自动补全会形成重复依赖树并长时间解析。项目 .npmrc 使用 legacy-peer-deps，必需的 scope、timeout、invariants、brand、group 在宿主显式声明，真实启动验证其闭包。Windows loader 的绝对路径必须用 file URL，裸 C:/ 路径不能由 ESM import 解析。Cordis 4.0.1 生命周期使用 ctx.effect 返回清理函数，没有 dispose 事件。Hyperframes 0.8.29 对系统字体要求 local @font-face 声明；Windows 深层输出路径会触及临时事务目录长度限制，测试使用较短系统临时目录并复制成片。

DSH CLI 拒绝在它自己读取的 .env 中声明 DEEPSEEK_BASE_URL 等启动变量。产品启动器先读取项目 .env，然后以继承环境变量启动 DSH，子进程 cwd 指向独立 DSH_HOME；业务根目录通过 VIDEOFORGE_ROOT 明确传递，不依赖子进程 cwd。此行为未修改 DSH 核心。
