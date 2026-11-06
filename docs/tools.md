# Tool reference

All tools return one JSON text block. Errors set `isError: true` and include the next step, for example:

**Language:** **English** · [中文](tools.zh-CN.md)

```
Ed is not connected.

Run `npx awesome-monash-tools login ed` to connect it.
```

## Ed

### `ed_whoami`

No parameters. Returns `{ id, name, email, courses }` and proves the token works.

### `ed_list_courses`

No parameters. Returns `[{ id, code, name, status, role }]`.

### `ed_list_threads`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `course` | number \| string | required | Course id, or a code such as `FIT1045` |
| `limit` | 1–100 | 30 | |
| `offset` | ≥ 0 | 0 | |
| `sort` | `new` \| `top` \| `unanswered` | `new` | |

Returns thread summaries: `id`, `number`, `courseId`, `courseCode`, `title`, `excerpt`, `authorName`, `authorRole`, `createdAt`, `replyCount`, `viewCount`, `isAnswered`, `isPinned`, `url`.

### `ed_search_threads`

| Parameter | Type | Default |
|---|---|---|
| `query` | string | required |
| `course` | number \| string | all active courses |
| `limit` | 1–50 | 20 |

Filters thread titles and bodies client-side, so it works even when Ed search is unavailable.

### `ed_get_thread`

| Parameter | Type | |
|---|---|---|
| `threadId` | number | required |

Returns the thread body as plain text plus flattened replies (`authorName`, `authorRole`, `text`, `createdAt`, `depth`, `endorsed`). Staff answers are distinguishable by `authorRole`.

### `ed_list_lessons`

| Parameter | Type | |
|---|---|---|
| `course` | number \| string | required |

Returns `[{ id, title, slideCount, url }]`.

### `ed_get_lesson`

| Parameter | Type | |
|---|---|---|
| `lessonId` | number | required |

Returns every slide with `title`, `type` (`video` / `text` / `slides` / `quiz` / `file`), `text`, `markdown`, `videoUrls` and `files` (`name`, `url`, `kind`). Ed stores slides as XML-ish markup; the server converts them to plain text and Markdown.

## Moodle

### `moodle_whoami`

No parameters. Probes the saved cookie against `/my/` and reports whether the session still works.

### `moodle_list_courses`

No parameters. Returns `[{ id, shortname, fullname }]` from the enrolled-courses web service.

### `moodle_deadlines`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `days` | 1–180 | 30 | How far ahead to include |
| `fromDaysAgo` | 0–180 | 0 | Include recently missed items |
| `checkSubmitted` | boolean | false | One extra request per assignment |

Returns `[{ id, title, courseId, course, module, dueAt, url, submitted }]`, nearest first. `submitted` is `null` unless `checkSubmitted` is true.

### `moodle_course_content`

| Parameter | Type | Notes |
|---|---|---|
| `courseId` | number | required |
| `section` | number | optional; without it every section is fetched, one request each |

Returns `{ courseId, course, sections: [{ number, title, items }] }`. Each item has `module` (resource, assign, url, label, …), `title`, `url`, `text` (label text), `campus` (`malaysia` / `australia` / `indonesia` / `shared`, detected from the title) and `images` (attendance-code images inside labels).

### `moodle_submission_status`

| Parameter | Type | |
|---|---|---|
| `url` | URL | must be on the same Moodle origin |

Returns `{ url, status }` where status is `submitted`, `graded`, `none` or `unknown`.

## Gmail

### `gmail_profile`

No parameters. Returns `{ emailAddress, messagesTotal, threadsTotal, historyId }`.

### `gmail_list_labels`

No parameters. Returns `[{ id, name, type }]`.

### `gmail_search_messages`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | `""` | [Gmail search syntax](https://support.google.com/mail/answer/7190) |
| `maxResults` | 1–25 | 10 | One metadata request per message |
| `labelIds` | string[] | — | |
| `includeSpamTrash` | boolean | false | |

Returns `{ messages: [{ id, threadId, subject, from, date, snippet, labelIds, url }], nextPageToken }`.

### `gmail_get_message`

| Parameter | Type | |
|---|---|---|
| `id` | string | required |

Returns the plain-text body, recipients, and attachments (`filename`, `mimeType`, `size`, `attachmentId`). HTML-only messages are converted to text.

### `gmail_get_thread`

| Parameter | Type | |
|---|---|---|
| `threadId` | string | required |

Returns every message in the thread in order, each with the same shape as `gmail_get_message`.

## OnTrack

### `ontrack_whoami`

No parameters. Mints a token and returns `{ userId, username, firstName, lastName, email }`.

### `ontrack_list_projects`

No parameters. Returns `[{ id, unitId, unitCode, unitName }]`.

### `ontrack_list_tasks`

| Parameter | Type | |
|---|---|---|
| `projectId` | number | required |

Returns tasks joined with the unit's task definitions: `id`, `taskDefinitionId`, `abbreviation`, `name`, `description`, `status`, `dueDate`, `targetDueDate`, `submissionDate`, `completionDate`, `weighting`, `timesAssessed`, `numNewComments`, plus a web `url`.

### `ontrack_task_comments`

| Parameter | Type | |
|---|---|---|
| `projectId` | number | required |
| `taskDefinitionId` | number | required |

Returns tutor comments: `id`, `type`, `comment`, `createdAt`, `authorId`, `authorName`.

### `ontrack_download`

| Parameter | Type | |
|---|---|---|
| `path` | string | API path, e.g. `/projects/123/task_def_id/456/task_pdf` |
| `filename` | string | optional name override |

Writes the artifact under `~/.config/awesome-monash-tools/downloads/` and returns `{ path, bytes, contentType }`. Filenames are sanitised; the path must be an API-relative path.

## Tool annotations

Every tool is annotated with MCP hints:

| Tool | `readOnlyHint` | `openWorldHint` |
|---|---|---|
| All tools except `ontrack_download` | true | true |
| `ontrack_download` | false | true |

No tool is destructive; hosts may still ask for confirmation based on the hints.
