由 **cocode 酷码工作室** 整理，用于 **Cocode Studio VideoForge** 源码交付。

# 随包 DSH 源码

DSH 版权归其原作者，保留官方 MIT 许可证与第三方声明。此目录不改变、重命名或重新授予上游源码版权。

| 文件 | 内容 |
| --- | --- |
| `deepseek-harness-0.1.0-rc.6-source.tar.gz` | 完整官方仓库发布提交归档，含 TypeScript 源码及上游构建配置 |
| `dsh-0.1.0-rc.6.tgz` | 官方 npm CLI 发布包；其依赖通过根 lock 安装 |
| `LICENSE.deepseek-harness` | 对应提交的官方许可证 |
| `THIRD_PARTY_NOTICES.deepseek-harness.md` | 对应提交的第三方声明 |
| `provenance.json` | 来源、版本、字节数、SHA-256、npm SHA-512 校验信息 |

上游仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。本包使用官方 [`release(dsh): 0.1.0-rc.6` 提交](https://github.com/deepseek-ai/deepseek-harness/commit/15148dbd9a1d1f1ef1a26e5749b32af0cd663935)，已核对该提交 `apps/cli/package.json` 中版本为 `0.1.0-rc.6`。npm 元数据未提供 gitHead，因此不声称已证明 npm 产物与源码可逐字节重复构建；npm 原包单独按官方发布的 SHA-512 验证。

在一个空目录解开源码归档即可查看上游完整仓库：

```bash
tar -xzf deepseek-harness-0.1.0-rc.6-source.tar.gz
```

这个归档无需参与 VideoForge 的正常构建。正常部署在 VideoForge 根目录执行 `npm ci --include=dev` 和 `npm start`，不需要全局安装 DSH，也无需启动上游默认 UI。没有更改 DSH 核心，全部产品逻辑在三个 cocode 插件中。

维护者可在安装了 curl 的联网环境执行 `node scripts/vendor-dsh.mjs` 重新下载并验证上游归档，然后执行 `python scripts/package-source.py` 重新生成应用源码 ZIP 和 SHA-256 文件。curl 随 Windows 系统提供，Linux 可通过包管理器安装。Python 3 仅用于源码打包，不是应用运行依赖。
