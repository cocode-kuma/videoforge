# DeepSeek 自主创作 Harness

默认 `VIDEOFORGE_CREATION_MODE=harness`。每个对话独立挂载 DSH rc.6 原生 AgentRegistry、AgentLoop、SessionStore、JSONL 持久化、请求检查点、请求重试、TokenMeter、工具结果整理和上下文压缩。产品层提供视频工具、用户工作区、鉴权、计费与事件界面；不再由自写聊天循环负责主流程。一次响应的输出窗口只影响本次输出。五阶段方法保留为创作参考，旧 `pipeline` 模式仍可回退。

## 当前能力

| 能力 | 实现 |
| --- | --- |
| 对话 | 独立多对话、完整执行记录、公开回复、分析状态、提问及回答、工具参数/文件内容/命令/测试结果、上下文和原生事件；私有内部推理不对外显示 |
| 持续协作 | 创作途中发送修改、停止保存、恢复检查点、新任务复用上一版工程 |
| 工程 | 文件读写、局部替换、追加、版本保存/恢复、完整源码 ZIP |
| 浏览器视频 | HTML/CSS/JavaScript、SVG、Canvas 2D、GSAP、Three.js、WebGL/GLSL；本地打包和按时间渲染 |
| Remotion | React/TypeScript 多文件工程、Composition、帧驱动动画、静帧及 MP4；预览统一使用真实渲染结果 |
| Blender | Python 建模/场景/动画脚本，真实 .blend 保存、静帧和影片渲染 |
| 素材 | 公共搜索、下载并记录来源、影像网关、SVG 转 PNG、图片裁切缩放、FFmpeg 转码/裁片/抽帧 |
| 脚本 | 工程内 Node、Python、Blender；错误与进程输出回到模型 |
| 命令 | 工程工作目录下的 PowerShell/Bash 命令与测试；公开部署在隔离容器执行 |
| 普通沟通 | 智能处理、讨论、制作三种任务意图；讨论正常结束并保留历史，制作模式要求真实成片交付 |
| 并发 | 多对话独立执行；机器渲染能力单独排队，避免一个对话阻塞其他对话 |
| 声音 | ElevenLabs、edge-tts、MiniMax、WAV 网关、Kokoro；实测时长、服务时间戳字幕、音乐合成、混音和字幕烧录 |
| 音乐分析 | 实测音轨信息和 RMS 起音候选，帮助编排节奏；不冒充精确节拍识别 |
| 交付 | 实际 MP4、分镜、音频事件表、入口与参数、素材/源代码和复现说明 |

## 本机准备与启动

依赖已锁入 `package-lock.json`，正常部署先 `npm ci`。准备 Python 和 Blender：

```text
node scripts/prepare-creative-runtime.mjs --python --blender
npm start
```

脚本需要可用 Python 创建 `.runtime/python`；可先通过 `VIDEOFORGE_PYTHON` 指定 Python 可执行文件。Windows Blender 下载校验官方 SHA-256；Linux 使用已安装的 Blender，并按需要配置 `BLENDER_PATH`。运行时和大文件不进入源码交付包。浏览器、FFmpeg 与中文字体仍需按部署手册准备。

当前工作区已准备 Python、edge-tts、Blender 和浏览器库。ElevenLabs / MiniMax 接口已实现，实际使用必须配置自己的凭证；不能把接口测试当成付费服务已在线验证。edge-tts 需要联网，依赖服务可用性。

## Skill 与参考

内置 Hyperframes 技能、创作与技术参考、固定版本 Remotion 官方技能，以及用户提供的《Opus 5.5 纯提示词生成视频教程》。DeepSeek 通过 `search_skills` / `read_skill` 自己检索和读取，按内容需要决定采用的方法。教程只是参考材料，不覆盖用户目标或宿主规则。

默认 Harness 执行创作前必须通过 `list_skills` 和 `read_skill` 连续分页读完全部 Skill 入口、教程原文与工程 Markdown 参考；宿主门禁阻止漏读或跳页后执行创作。技能中的其他引用案例仍按需读取，互相冲突的风格规范按需求取舍。工作室新请求和修改先由独立 AI 结合教程及相关技能润色；界面、消息历史和制作输入使用润色结果。默认由 AI 按需求规划规格，手动指定模式保留用户选项，润色用量纳入任务。详细流程见 [项目导览](project-guide-zh.md)。

新增技能有三个入口：

1. 放入 `vendor/creative-skills/名称/SKILL.md`，供所有工程读取。
2. 用 `VIDEOFORGE_EXTRA_SKILLS_ROOTS` 指向其他技能目录；多个目录用分号分隔。
3. 上传并选中 Markdown 参考，任务启动时复制到工程 `skills/`；已有工程也可直接放入此目录。

阅读 Skill 不等于获得其中提到的服务或工具。执行能力由真实工具适配器提供；Skill 不能自动安装任意依赖、获取凭证或增加权限。Remotion 来源与固定提交记录在 `vendor/remotion-skills/source.json`，更新可单独执行 `node scripts/prepare-creative-runtime.mjs --skills`。

## 自动修复与交付证据

真实渲染失败、素材缺失、脚本异常、配音超时长等会以工具结果回到模型，它可以读取文件并调整策略。具体视觉/需求错误由评审返回，模型修复后重新渲染和评审；风格建议可以权衡。连续重复相同操作会得到停滞诊断。任务不因累计 Token、调用次数、素材生成次数或整任务运行时长自动停止。

导出后抽取真实视频帧，使用配置好的视觉模型评审；无视觉服务时只标记代码评审。交付还核对音视频流、时长、画幅、连续黑帧、分镜及最新用户消息。配音长度来自 FFprobe，不能靠填写较短时长裁掉旁白。

评审凭据由宿主持有，绑定影片哈希、源码及最新用户要求。写一个假的 `review.json` 无法绕过。修改源码、成片或用户需求后需要重新评审。评审不能保证审美水平；新架构提供更强的行动和纠错能力，模型选择、参考和创作要求仍影响成片质量。

Harness 持续执行直到通过交付校验或用户停止，没有累计 Token、调用次数、素材生成次数或整任务时限上限；旧的 `VIDEOFORGE_AGENT_MAX_CALLS`、`VIDEOFORGE_AGENT_TOKEN_BUDGET` 和 `VIDEOFORGE_AGENT_TIMEOUT_MS` 已移除，不再生效。Token 仍如实记账，模型服务报错和单个工具运行失败仍返回真实诊断。单次输出窗口 `VIDEOFORGE_MAX_OUTPUT_TOKENS` 独立配置，超出时继续分段写文件。`VIDEOFORGE_MAX_REPAIRS` 只作用于旧 pipeline。原生消息、工具日志、读过的技能哈希和收件记录保存在私有 `.harness/`。恢复不会自动重放结果不确定的付费操作。

## 原生插件接入

管理员安装匹配的 rc.6 DSH 插件包后，可通过 `VIDEOFORGE_DSH_PLUGINS` 配置可信插件组合。按配置顺序在每个 agent 的作用域内挂载，`{{workspace}}` 替换为本轮工程路径；插件工具自动进入原生工具注册表和执行记录。支持原生 `@deepseek-ai/dsh-mcp-client` 的 Streamable HTTP 接入，已有本地 MCP 回归检查。stdio MCP 需要另配置其执行器依赖。缺少依赖会明确报错，不能显示成已启用。该配置只由部署管理员提供，不从模型生成文件中加载。

```text
VIDEOFORGE_DSH_PLUGINS=[{"name":"@deepseek-ai/dsh-mcp-client","config":{"transport":"streamable-http","serverName":"assets","url":"http://your-private-mcp/mcp"}}]
```

## 源码复现

下载可编辑工程并解压，在 VideoForge 安装目录执行：

```text
node scripts/run-typescript.mjs scripts/render-project.ts "工程绝对路径"
```

影片输出到该工程 `exports/final.mp4`。所需素材、浏览器库、`project.json` 和 `audio-plan.json` 随源码保存；不需要再次请求模型。可继续编辑并重渲染。

## 执行环境边界

本机默认 `local` 是桌面主人可信工作区：Node 文件权限限制在工程和安装依赖，子进程不继承模型服务凭证；Python/Blender 能执行代码，不适合直接作为多租户隔离方案。

提供 `runtime/Dockerfile` 与 `VIDEOFORGE_EXECUTION_MODE=container`，脚本容器只绑定一个工程，关闭网络并限制内存、CPU、进程和能力。公开部署禁止本地生成脚本执行。当前机器 Docker daemon 未运行，因此容器路径未实测；浏览器/Remotion 渲染仍在宿主调度，公开多租户上线还需把完整渲染 worker 纳入隔离部署及审计，不能仅凭这个开关声称已完成生产隔离。

## 验证记录

`test:creative` 使用真实浏览器、Python、FFmpeg、Remotion 与 Blender，覆盖 SVG 图片处理、Canvas/GSAP/Three.js/GLSL、确定时间重现和实际 MP4；edge-tts 的联网结果单独记录。

`test:harness` 使用模拟 DeepSeek 原生协议服务驱动真实工具和渲染：公开流式文本、中途修改、技能读取、独立 SVG、故意渲染错误的诊断和修复、音视频交付、前端作品卡片和工程下载。该检查不消费真实 DeepSeek 额度，也不证明真实模型的艺术质量。ElevenLabs/MiniMax 测试使用协议样例和实际音频解码，不消费付费服务额度。
