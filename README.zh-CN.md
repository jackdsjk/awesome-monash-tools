<div align="center">

# Awesome Monash Tools

**为 Monash 学生做的 Agent 原生 MCP 工具集：把 Ed、Moodle、Gmail、OnTrack 和 Attendance 门户变成 25 个工具，交给你的 Agent 调用。**

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)
[![CI](https://github.com/jackdsjk/awesome-monash-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/jackdsjk/awesome-monash-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/awesome-monash-tools.svg)](https://www.npmjs.com/package/awesome-monash-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-6B4FBB)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/tools-25-blue)](#-工具目录)
[![Agent-first](https://img.shields.io/badge/built%20for-agents-0A66C2)](#-这是给-agent-用的不是给人用的)

[English](README.md) · **中文**

</div>

> Monash 学生的日常横跨五个互不相通的系统：**Ed** 讨论区、**Moodle** 截止日期与课件、**Gmail** 官方邮件、**OnTrack** FIT 任务反馈，以及 **Attendance 门户**的课堂签到。它们都没有面向学生的 API。本仓库把它们统一成一组小而明确的 MCP 工具，让 Agent 能基于真实数据回答「这周要交什么、tutor 说了什么、我漏了什么、我签到了吗」。

> **非官方项目。** 与 Monash University、Ed、Moodle、Google、Doubtfire 均无隶属关系。请使用自己的账号，自担风险，并遵守各服务条款。

---

## 🤖 这是给 Agent 用的，不是给人用的

本仓库**没有 App、没有仪表盘、没有聊天界面**。唯一的接口就是一组 MCP 工具。每个设计决定都服务于协议另一端的那个模型：

| 设计 | 为什么 |
|---|---|
| **给工具，不给页面** | Agent 没法「浏览」Moodle；它能调用 `moodle_deadlines` 拿到 JSON。 |
| **工具描述按模型来写** | 每个工具都说明：什么时候用、返回什么、下一步做什么。 |
| **报错即指令** | 会话过期时返回的是「Moodle 会话已失效，请运行 `awesome-monash login moodle`」，不是堆栈。 |
| **输出确定** | 字段名稳定、时间统一 ISO、默认按时间排序，模型不需要二次推导。 |
| **只有一处写入** | 除签到外全部只读；`attendance_checkin` 只填 code，传 `submit: true` 才会真正提交。 |
| **一次登录，多次调用** | 登录是 CLI 的一步；Agent 永远看不到、也不需要密码。 |
| **纯本地 stdio** | 没有服务端、没有埋点、不用注册账号；宿主拉起一个进程即可。 |

兼容任何 MCP 宿主：**Claude Code**、**Claude Desktop**、**Cursor**、**Codex**、**DeepSeek Harness**，或你自己的 agent loop。

## 📋 目录

- [为什么做这个](#-为什么做这个)
- [里面有什么](#-里面有什么)
- [Agent 能做什么](#-agent-能做什么)
- [快速开始](#-快速开始)
- [MCP 配置](#-mcp-配置)
- [工具目录](#-工具目录)
- [设计原则](#-设计原则)
- [安全与隐私](#-安全与隐私)
- [仓库结构](#-仓库结构)
- [开发](#-开发)
- [参与贡献](#-参与贡献)
- [相关项目](#-相关项目)
- [许可证](#-许可证)

---

## 💡 为什么做这个

问一个 Monash 学生「这周要交什么」，真实答案需要四次登录、四个界面，再在脑子里做一次 join。信息一直存在，但它优化的是「人点着看」，不是「Agent 直接回答」。

现有工具只解决了一半：

- `moodle-cli`、`edstem-cli`、`ontrack-cli` 都是优秀的**终端**工具，但它们默认使用者是人：输出表格、命令行交互、一次一问。
- 网页抓取库返回的是 HTML，模型得花大量上下文重新理解 Moodle 的主题结构。
- 四个系统的认证方式完全不同：API token、SSO cookie、OAuth、refresh cookie。每问一个问题都重新认证一次，不可行。

这个项目把最枯燥的部分一次做完——**认证、归一化、错误恢复**——然后把结果暴露成 25 个形状一致的 MCP 工具。思考交给 Agent，管道交给仓库。

**它不是什么：** 不是 Monash 客户端，不是通知应用，不是可以随便指向任意 URL 的爬虫，也不是自动交作业的捷径。**唯一的写入是签到，而且必须由调用方显式确认。**

## 📦 里面有什么

| 组成 | 内容 |
|---|---|
| **5 个 MCP server** | `ed`、`moodle`、`gmail`、`ontrack`、`attendance`，各自独立运行 |
| **1 个聚合 server** | `all`，25 个工具在同一个进程里 |
| **1 个 CLI** | `awesome-monash login / logout / status / serve` |
| **25 个工具** | 类型化入参、JSON 输出、可执行的报错 |
| **文档** | [认证指南](docs/auth.zh-CN.md) · [工具参考](docs/tools.zh-CN.md) · [llms.txt](llms.txt) |

| Server | 可执行名 | 工具数 | `awesome-monash login` 抓取的凭据 |
|---|---|---:|---|
| Ed | `awesome-monash-ed` | 7 | <https://edstem.org/settings/api-tokens> 生成的 API token |
| Moodle | `awesome-monash-moodle` | 5 | Monash SSO cookie（Chrome 里登录一次） |
| Gmail | `awesome-monash-gmail` | 5 | Google OAuth，仅 `gmail.readonly` |
| OnTrack | `awesome-monash-ontrack` | 5 | Monash SSO refresh cookie |
| Attendance | `awesome-monash-attendance` | 3 | `attendance.monash.edu.my` 的 Monash SSO cookie |
| All | `awesome-monash-all` | 25 | 你已连接的所有来源 |

## 🎯 Agent 能做什么

真实问题，以及回答它们要调用的工具：

| 你可以这样问 Agent | 它会调用 |
|---|---|
| 「未来 14 天有什么要交？哪些我已经交了？」 | `moodle_deadlines`（`checkSubmitted: true`） |
| 「总结 FIT1045 这周的 Ed 帖子，已经被回答的跳过。」 | `ed_list_threads` → `ed_get_thread` |
| 「Tutor 对 P1 留反馈了吗？把讲数据模型的那段原话给我。」 | `ontrack_list_projects` → `ontrack_list_tasks` → `ontrack_task_comments` |
| 「我在 FIT1045 Workshop 3，code 是 ABC123，帮我签到。」 | `attendance_sessions` → `attendance_checkin` |
| 「找出 Monash 发的选课邮件，告诉我缴费截止日。」 | `gmail_search_messages` → `gmail_get_message` |
| 「FIT1047 第 8 周有什么？有 lab sheet 吗？」 | `moodle_list_courses` → `moodle_course_content` |
| 「帮我排这周：先截止日期，再未读 Ed 帖，最后 tutor 反馈。」 | 五个 server 全用上 |

因为一切都限定在**你自己的账号**内，答案也是你自己的：你的提交、你的反馈、你的收件箱。不会共享，也不会在远端缓存。

## 🚀 快速开始

需要 **Node.js 20.11+** 和 **Google Chrome**（只有三个 SSO 登录会用到）。

```bash
# 不用安装：npx 直接从 npm 拉取
npx -y awesome-monash-tools@latest login ed
npx -y awesome-monash-tools@latest login moodle
npx -y awesome-monash-tools@latest login ontrack
npx -y awesome-monash-tools@latest login attendance
npx -y awesome-monash-tools@latest login gmail --client-id <id> --client-secret <secret>

npx -y awesome-monash-tools@latest status
npx -y awesome-monash-tools@latest serve all
```

嫌命令长？装一次，之后就能用短命令：

```bash
npm install -g awesome-monash-tools

awesome-monash login ed
awesome-monash status
awesome-monash serve all
```

`login moodle` / `login ontrack` / `login attendance` 会打开 Chrome 窗口：正常完成 Monash SSO 登录、等仪表盘加载出来，会话就自动保存了。**这个工具不会让你输入密码。**

> 想改代码？`git clone` 仓库后 `npm install && npm run build && npm link`。

## 🔌 MCP 配置

**Claude Code**

```bash
claude mcp add monash -- npx -y awesome-monash-tools@latest serve all
```

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "monash": {
      "command": "npx",
      "args": ["-y", "awesome-monash-tools@latest", "serve", "all"]
    }
  }
}
```

也可以按来源拆开（工具列表更小、权限更清晰）：

```json
{
  "mcpServers": {
    "ed":       { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ed"] },
    "moodle":   { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "moodle"] },
    "gmail":    { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "gmail"] },
    "ontrack":  { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ontrack"] },
    "attendance": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "attendance"] }
  }
}
```

**Cursor** 在 `.cursor/mcp.json` 用同样的 JSON。

**Codex**（`~/.codex/config.toml`）：

```toml
[mcp_servers.monash]
command = "npx"
args = ["-y", "awesome-monash-tools@latest", "serve", "all"]
```

## 🧰 工具目录

完整参数与返回结构见 [docs/tools.zh-CN.md](docs/tools.zh-CN.md)。

### Ed — 讨论帖与课件

| 工具 | 作用 |
|---|---|
| `ed_whoami` | token 背后的账号与课程 |
| `ed_list_courses` | 课程 id 与课程代码 |
| `ed_list_threads` | 某门课的帖子，可按最新/最热/未回答 |
| `ed_search_threads` | 跨课程搜索标题与正文 |
| `ed_get_thread` | 完整帖子，含嵌套回复与 staff 回答 |
| `ed_list_lessons` | 按周的 lesson 模块 |
| `ed_get_lesson` | 每页 slide 的文本/Markdown、附件与视频地址 |

### Moodle — 截止日期与课件

| 工具 | 作用 |
|---|---|
| `moodle_whoami` | 会话健康检查 |
| `moodle_list_courses` | 已选课程 |
| `moodle_deadlines` | 按到期时间排序，可选检查是否已提交 |
| `moodle_course_content` | 章节、活动、label 文本、文件链接 |
| `moodle_submission_status` | 单个作业的 submitted / graded / none |

### Gmail — 官方邮箱

| 工具 | 作用 |
|---|---|
| `gmail_profile` | 邮箱地址与邮件计数 |
| `gmail_list_labels` | 标签与 id |
| `gmail_search_messages` | Gmail 查询语法，返回元数据 |
| `gmail_get_message` | 纯文本正文、收件人、附件列表 |
| `gmail_get_thread` | 整个会话的所有邮件 |

### OnTrack — FIT 任务反馈

| 工具 | 作用 |
|---|---|
| `ontrack_whoami` | refresh cookie 背后的账号 |
| `ontrack_list_projects` | 单元与项目 id |
| `ontrack_list_tasks` | 状态、权重、截止日期 |
| `ontrack_task_comments` | tutor 评论与评分理由 |
| `ontrack_download` | 把任务书或提交 PDF 存到本地 |

### Attendance — 课堂签到

| 工具 | 作用 |
|---|---|
| `attendance_status` | 保存的签到会话是否仍有效 |
| `attendance_sessions` | 门户里列出的 workshop / tutorial 及其日期 |
| `attendance_checkin` | 给某门课某个班次填 code；只有 `submit: true` 才提交 |

## 🧱 设计原则

1. **在边缘做归一化。** Moodle 在内部被解析，对外只返回结构化章节——模型永远看不到 HTML。
2. **一个工具只做一件事。** `moodle_deadlines` 只管截止日期，查单个提交状态用 `moodle_submission_status`。不做大杂烩。
3. **动词 + 名词，带来源前缀。** 在 25 个工具里，`ed_get_thread` 没有歧义。
4. **报错要给解法。** 每个 `AmtError` 都带 `hint`，工具结果里直接给出该跑的命令。
5. **默认只读。** 唯一的写入是 `attendance_checkin`：只填 code，传 `submit: true` 才提交；`ontrack_download` 只写本地文件。两者都有明确标注。
6. **形状稳定。** 字段名、ISO 时间、确定的排序——Agent 可以在多次调用之间依赖它们。
7. **本地、安静。** stdio 传输，没有服务端组件、没有分析、没有远端缓存。

## 🔒 安全与隐私

- 凭据存放在 `~/.config/awesome-monash-tools/credentials.json`，权限 `0600`；可用 `AMT_CONFIG_DIR` 改位置。
- 本工具从不要求输入密码。Moodle 与 OnTrack 的登录发生在真实的 Chrome 窗口里。
- Gmail 只申请 `gmail.readonly`；可随时在 <https://myaccount.google.com/permissions> 撤销。
- 没有埋点、没有远端日志、中间没有第三方服务。
- 输出本身就是敏感信息（成绩、反馈、邮件、考勤），转述时请自行判断。
- 签到是唯一的写入：需要 `attendance_checkin` 且 `submit: true`，记录会落到你的学生账号上。
- 高级用户可用环境变量覆盖：`ED_API_TOKEN`、`MOODLE_COOKIE`、`ONTRACK_REFRESH_TOKEN`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。

## 🗂 仓库结构

```
src/core/      配置、凭据存储、HTTP 重试、MCP 辅助
src/ed/        Ed 客户端、工具、server 入口
src/moodle/    Moodle 客户端（AJAX + 抓取）、工具、入口
src/gmail/     Gmail 客户端 + OAuth 回环、工具、入口
src/ontrack/   OnTrack 客户端（refresh cookie）、工具、入口
src/all.ts     聚合 server
src/cli.ts     login / logout / status / serve
docs/          认证指南与工具参考（中英双语）
scripts/       协议级 smoke 测试
```

## 🛠 开发

```bash
npm install
npm run check     # tsc --noEmit + vitest
npm run build     # 产出 dist/
npm run smoke     # 真的拉起每个 server 并通过 stdio 调用一个工具
npm run dev -- status
```

测试使用假的 `fetch`，开发不需要真实账号。代码约定见 [AGENTS.md](AGENTS.md)。

## 🤝 参与贡献

- **加工具：** 优先只读；任何写入必须显式、带标注，并且中英双语文档同步。
- **加数据源：** 照 `src/ed/` 的结构（client → tools → server），并在 [docs/auth.md](docs/auth.md) 与中文版里补认证说明。
- **改文档：** `README.md` 与 `README.zh-CN.md`、`docs/` 的中英两版要同步。
- 提交 PR 前先跑 `npm run check && npm run smoke`。

## 🌏 相关项目

Monash × Agent 生态里的其他社区工作。其中一些帮本项目摸清了这些 API 的行为；没有一个被打包进这里。

| 项目 | 作用 | 许可 |
|---|---|---|
| [bunizao/edstem-cli](https://github.com/bunizao/edstem-cli) | Ed CLI + MCP server，最接近的先行实现 | MIT |
| [bunizao/moodle-cli](https://github.com/bunizao/moodle-cli) | Moodle CLI，覆盖截止日期、成绩、论坛 | MIT |
| [bunizao/ontrack-cli](https://github.com/bunizao/ontrack-cli) | 终端里的 OnTrack 任务与提交 | MIT |
| [MarkChu-git/Always-Ontrack](https://github.com/MarkChu-git/Always-Ontrack) | OnTrack 实时反馈监听 | Apache-2.0 |
| [TuuHub/unicorn](https://github.com/TuuHub/unicorn) | 自托管的校园记忆层（Cove） | Apache-2.0 |

如果你也为 Monash 学生做了东西，欢迎提 PR 加进这张表。

## 📄 许可证

[MIT](LICENSE) © 2026 jackdsjk

---

*为那些需要知道「这周要交什么」的 Agent 而建。*
