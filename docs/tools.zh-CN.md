# 工具参考

所有工具返回一个 JSON 文本块。出错时 `isError: true`，并附带下一步该做什么，例如：

```
Ed is not connected.

Run `npx awesome-monash-tools login ed` to connect it.
```

**语言：** [English](tools.md) · **中文**

## Ed

### `ed_whoami`

无参数。返回 `{ id, name, email, courses }`，同时验证 token。

### `ed_list_courses`

无参数。返回 `[{ id, code, name, status, role }]`。

### `ed_list_threads`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `course` | number \| string | 必填 | 课程 id，或课程代码如 `FIT1045` |
| `limit` | 1–100 | 30 | |
| `offset` | ≥ 0 | 0 | |
| `sort` | `new` \| `top` \| `unanswered` | `new` | |

返回帖子摘要：`id`、`number`、`courseId`、`courseCode`、`title`、`excerpt`、`authorName`、`authorRole`、`createdAt`、`replyCount`、`viewCount`、`isAnswered`、`isPinned`、`url`。

### `ed_search_threads`

| 参数 | 类型 | 默认 |
|---|---|---|
| `query` | string | 必填 |
| `course` | number \| string | 所有活跃课程 |
| `limit` | 1–50 | 20 |

在标题和正文里做客户端过滤，所以 Ed 自己的搜索不可用时也能用。

### `ed_get_thread`

| 参数 | 类型 | |
|---|---|---|
| `threadId` | number | 必填 |

返回帖子正文（纯文本）以及拉平后的回复列表（`authorName`、`authorRole`、`text`、`createdAt`、`depth`、`endorsed`）。通过 `authorRole` 可以区分 staff 回答。

### `ed_list_lessons`

| 参数 | 类型 | |
|---|---|---|
| `course` | number \| string | 必填 |

返回 `[{ id, title, slideCount, url }]`。

### `ed_get_lesson`

| 参数 | 类型 | |
|---|---|---|
| `lessonId` | number | 必填 |

返回每页 slide 的 `title`、`type`（`video` / `text` / `slides` / `quiz` / `file`）、`text`、`markdown`、`videoUrls` 和 `files`（`name`、`url`、`kind`）。Ed 的 slide 是类 XML 标记，服务端会转成纯文本与 Markdown。

## Moodle

### `moodle_whoami`

无参数。用保存的 cookie 探测 `/my/`，报告会话是否仍然有效。

### `moodle_list_courses`

无参数。通过选课 web service 返回 `[{ id, shortname, fullname }]`。

### `moodle_deadlines`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `days` | 1–180 | 30 | 往后看多少天 |
| `fromDaysAgo` | 0–180 | 0 | 把最近错过的也带上 |
| `checkSubmitted` | boolean | false | 每个作业额外一次请求 |

返回 `[{ id, title, courseId, course, module, dueAt, url, submitted }]`，按到期时间从近到远。`submitted` 只有在 `checkSubmitted` 为 true 时才有值，否则是 `null`。

### `moodle_course_content`

| 参数 | 类型 | 说明 |
|---|---|---|
| `courseId` | number | 必填 |
| `section` | number | 可选；不传则抓取所有章节，每节一次请求 |

返回 `{ courseId, course, sections: [{ number, title, items }] }`。每个 item 有 `module`（resource、assign、url、label 等）、`title`、`url`、`text`（label 文本）、`campus`（`malaysia` / `australia` / `indonesia` / `shared`，从标题推断）以及 `images`（label 里的考勤码图片）。

### `moodle_submission_status`

| 参数 | 类型 | |
|---|---|---|
| `url` | URL | 必须属于同一个 Moodle 站点 |

返回 `{ url, status }`，status 为 `submitted`、`graded`、`none` 或 `unknown`。

## Gmail

### `gmail_profile`

无参数。返回 `{ emailAddress, messagesTotal, threadsTotal, historyId }`。

### `gmail_list_labels`

无参数。返回 `[{ id, name, type }]`。

### `gmail_search_messages`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | `""` | [Gmail 搜索语法](https://support.google.com/mail/answer/7190) |
| `maxResults` | 1–25 | 10 | 每封邮件一次元数据请求 |
| `labelIds` | string[] | — | |
| `includeSpamTrash` | boolean | false | |

返回 `{ messages: [{ id, threadId, subject, from, date, snippet, labelIds, url }], nextPageToken }`。

### `gmail_get_message`

| 参数 | 类型 | |
|---|---|---|
| `id` | string | 必填 |

返回纯文本正文、收件人，以及附件列表（`filename`、`mimeType`、`size`、`attachmentId`）。只有 HTML 的邮件会转成文本。

### `gmail_get_thread`

| 参数 | 类型 | |
|---|---|---|
| `threadId` | string | 必填 |

按顺序返回整个会话的每封邮件，结构与 `gmail_get_message` 相同。

## OnTrack

### `ontrack_whoami`

无参数。换取 token 后返回 `{ userId, username, firstName, lastName, email }`。

### `ontrack_list_projects`

无参数。返回 `[{ id, unitId, unitCode, unitName }]`。

### `ontrack_list_tasks`

| 参数 | 类型 | |
|---|---|---|
| `projectId` | number | 必填 |

返回任务与单元任务定义合并后的结果：`id`、`taskDefinitionId`、`abbreviation`、`name`、`description`、`status`、`dueDate`、`targetDueDate`、`submissionDate`、`completionDate`、`weighting`、`timesAssessed`、`numNewComments`，外加网页 `url`。

### `ontrack_task_comments`

| 参数 | 类型 | |
|---|---|---|
| `projectId` | number | 必填 |
| `taskDefinitionId` | number | 必填 |

返回 tutor 评论：`id`、`type`、`comment`、`createdAt`、`authorId`、`authorName`。

### `ontrack_download`

| 参数 | 类型 | |
|---|---|---|
| `path` | string | API 路径，例如 `/projects/123/task_def_id/456/task_pdf` |
| `filename` | string | 可选，覆盖文件名 |

把文件写到 `~/.config/awesome-monash-tools/downloads/`，返回 `{ path, bytes, contentType }`。文件名会做安全处理，路径必须是 API 相对路径。

## Attendance

### `attendance_status`

无参数。探测保存的签到 cookie，返回 `{ connected, hint }`。

### `attendance_sessions`

无参数。返回 `[{ course, session, days }]`：门户里这个账号的 workshop、tutorial、lab，以及它们出现在哪些日期。

### `attendance_checkin`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `course` | string | 必填 | 单元代码，如 `FIT1045` |
| `session` | string | 必填 | 班次标签，如 `Workshop 3` |
| `code` | string | 必填 | 课上老师给出的签到码 |
| `submit` | boolean | false | `false` 只填入；`true` 才真正提交并记录考勤 |

返回 `{ status, course, session, message, entryUrl?, pageText? }`，status 为 `filled`、`submitted`、`inactive`（签到窗口未开）或 `not_found`（没有匹配的 Entry 链接）。

`attendance_checkin` 是本包唯一会写远端服务的工具。传 `submit: true` 之前，请先和用户确认课程、班次和签到码。

## 工具标注

每个工具都带 MCP 提示：

| 工具 | `readOnlyHint` | `openWorldHint` |
|---|---|---|
| `attendance_checkin`、`ontrack_download` | false | true |
| 其余所有工具 | true | true |

没有破坏性工具。`attendance_checkin` 会写入考勤、`ontrack_download` 会写本地文件，宿主仍可能根据这些提示要求确认。
