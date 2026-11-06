# 认证

每个数据源的认证方式都不同，因为 Monash 的每个服务本来就不同。这一页说明每次登录到底拿到了什么、存在哪里、过期了怎么恢复。

**语言：** [English](auth.md) · **中文**

## 凭据存放位置

| 内容 | 路径 |
|---|---|
| 凭据 | `~/.config/awesome-monash-tools/credentials.json`（权限 `0600`） |
| Chrome 配置目录 | `~/.config/awesome-monash-tools/profiles/<source>/` |
| OnTrack 下载 | `~/.config/awesome-monash-tools/downloads/` |

`AMT_CONFIG_DIR` 可以整体移动这个目录（测试或分开的学校账号很有用）。

文件是纯 JSON，原子写入。环境变量优先于文件：

| 来源 | 环境变量覆盖 |
|---|---|
| Ed | `ED_API_TOKEN`、`ED_REGION` |
| Moodle | `MOODLE_COOKIE`、`MOODLE_BASE_URL` |
| Gmail | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI` |
| OnTrack | `ONTRACK_USERNAME`、`ONTRACK_REFRESH_TOKEN`、`ONTRACK_BASE_URL` |

环境变量里的内容不会被这个工具写到磁盘（例外：用 `--client-secret` 传 Gmail 密钥时会存下来；在意的话请改用环境变量）。

---

## Ed

Ed API 使用 `Authorization: Bearer <token>`。

1. 登录 <https://edstem.org>。
2. 打开 <https://edstem.org/settings/api-tokens> 创建 token。
3. `awesome-monash login ed`（或 `--token`，或 `ED_API_TOKEN`）。

Token 按账号签发，长期有效；可在同一个页面撤销。登录时会调用 `/api/user` 验证，所以打错字会立刻失败，而不是等到第一次工具调用。

区域：Monash 使用 `au`。区域只影响工具返回的网页链接；API 域名始终是 `edstem.org/api`。

排障：

| 现象 | 原因 |
|---|---|
| `Ed rejected the saved session (HTTP 401)` | token 被撤销，或复制时带了空白；重新登录 |
| `No Ed course matches "..."` | token 属于别的账号，或课程已归档 |

---

## Moodle

Moodle 没有给学生可用的个人 API token，所以登录抓的是浏览器会话。

`login moodle` 的过程：

1. 打开一个持久的 Chrome 配置（`profiles/moodle`）。
2. 导航到 `https://learning.monash.edu/my/`。
3. 等你在窗口里完成 Monash SSO 登录。
4. 收集所有 `*.monash.edu` cookie（包括 `MoodleSession` 和 `MDL_SSP_SessID`——两个都要，只发前者可能被弹回 Okta）。
5. 用这份 cookie 探测仪表盘，只有真的能打开才会保存。

这意味着：

- 会话和你浏览器里的是同一个，几小时后会过期（Moodle 也会把浏览器登出）。
- 从不保存密码，这个工具也不会替你输入任何凭据。
- Chrome 配置目录会留在磁盘上，所以下次重新登录通常只需要点几下。

工具提示会话过期时，重跑 `login moodle`。想要自动续期，可以用定时任务跑同一条命令；本工具不会自己安装后台代理。

排障：

| 现象 | 原因 |
|---|---|
| 登录超时 | 仪表盘没加载出来，或 SSO 开在了另一个窗口 |
| `Moodle dashboard did not contain a sesskey` | 保存的 cookie 到了登录页；重新登录 |
| `Moodle AJAX returned an error` | 站点对你的角色禁用了该 web service |

---

## Gmail

Gmail 使用标准 Google OAuth + PKCE + 回环重定向；客户端密钥不会离开你的机器。

只需要配置一次：

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 新建（或选择一个）项目。
2. **APIs & Services → Library → Gmail API → Enable**。
3. **APIs & Services → OAuth consent screen**：External，把自己加为测试用户。
4. **Credentials → Create credentials → OAuth client ID → Desktop app**。
5. 在这个 client 下添加重定向 URI：`http://127.0.0.1:48125/oauth/google/callback`。

然后：

```bash
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
awesome-monash login gmail
```

说明：

- 作用域只有 `https://www.googleapis.com/auth/gmail.readonly`，不申请其他权限。
- 回环监听只绑定 `127.0.0.1`，拿到 code 后立刻关闭。
- refresh token 存在 `credentials.json`；access token 在过期前自动刷新。
- 48125 被占用？加 `--port 48126`，并把新的重定向 URI 也注册进去。
- 撤销授权：<https://myaccount.google.com/permissions>。

排障：

| 现象 | 原因 |
|---|---|
| `Google did not return an access token` | 重定向 URI 不匹配，或 client secret 错误 |
| 授权页报 `redirect_uri_mismatch` | 注册的 URI 端口或路径不一致 |
| `Google refused to refresh the Gmail token` | 授权被撤销，或 OAuth client 被删除 |

---

## OnTrack

OnTrack（Doubtfire）会给登录后的网页存一个 `refresh_token` cookie，并用它换取短期 access token。

`login ontrack` 的过程：

1. 打开持久 Chrome 配置（`profiles/ontrack`）。
2. 导航到 `https://ontrack.infotech.monash.edu`。
3. 等 Monash SSO 登录完成。
4. 读取 `refresh_token` 与 `username` 两个 cookie。
5. 调用 `POST /api/auth/access-token`，再调 `GET /api/projects`，确认 cookie 真的可用后才保存。

运行时客户端会换取 access token，在内存里缓存到过期前 60 秒，**不会把 token 写到磁盘**。

排障：

| 现象 | 原因 |
|---|---|
| 登录超时 | 任务列表没加载出来 |
| `OnTrack login returned HTTP 419` | refresh cookie 被撤销；重新登录 |
| `OnTrack request failed (HTTP 404)` | API base URL 不对（必须带 `/api`） |

---

## 明确不做的事

- 不弹密码框，不转发凭据，不抓密码输入框。
- 不把 token 写进日志、报错信息或 MCP 输出。
- 不安装后台进程、守护进程或 LaunchAgent。
