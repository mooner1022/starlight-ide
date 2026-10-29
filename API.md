# Web IDE API

The contract between the IDE's backend (`app/`, Kotlin on the device) and its web page (`web/`, served by the backend).
Everything is JSON (UTF-8) unless noted. Paths of files are relative to the project directory, with `/` separators.

## Sessions and security

- The page and the API share one origin: `http://<device>:8766`.
- `GET /api/session` → `{ "authenticated": bool, "requireToken": bool, "version": "0.1.0" }`. Never fails.
- `POST /api/login` `{ "token": "..." }` → `204` and an `HttpOnly; SameSite=Strict` session cookie, or `401`.
  When the token isn't required, every request is authenticated and login is not needed.
- `POST /api/logout` → `204`.
- Every other `/api/*` request without a valid session gets `401`.
- Requests other than `GET` must send `X-Requested-With: starlight-ide`, or get `403`.
  Requests with an `Origin` other than this server's get `403`.
- Errors: `{ "status": 404, "error": "message" }`. `400` for bad input, including a missing file (the message says
  what to fix), `404` for a missing project or API, `409` for a conflict (see writes), `500` otherwise.

## Workspace

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/projects` | | `[Project]` |
| POST | `/api/projects` | `{ name, language, events?: [id] }` | `Project` (`201`) |
| GET | `/api/languages` | | `[{ id, name, fileExtension }]` |
| GET | `/api/events` | | `[{ id, name, functionName, comment?, args: [{ name, type }] }]` |
| GET | `/api/types` | | `text/plain`: TypeScript declarations of StarLight's globals and event argument types |
| GET | `/api/logs` | `?since=<millis>` | `[Log]` of StarLight and its plugins (kept since the workspace plugin started) |
| GET | `/api/projects/{p}` | | `Project` with `allowedEvents: [id]` |
| GET | `/api/projects/{p}/files` | `?path=.` | `{ entries: [{ path, isDirectory, size, modifiedMillis }], truncated }` |
| GET | `/api/projects/{p}/file` | `?path=` | `File` |
| PUT | `/api/projects/{p}/file` | `{ path, text, expectedHash? }` | `File` without `text` |
| DELETE | `/api/projects/{p}/file` | `?path=` | `204` |
| POST | `/api/projects/{p}/rename` | `{ from, to }` | `204` |
| GET | `/api/projects/{p}/search` | `?q=&regex=false&ignoreCase=true` | `[{ path, line, text }]` |
| POST | `/api/projects/{p}/compile` | | `CompileResult` |
| PUT | `/api/projects/{p}/enabled` | `{ enabled }` | `Project` |
| PUT | `/api/projects/{p}/events` | `{ allow?: [id], disallow?: [id] }` | `{ allowed: [id] }` |
| GET | `/api/projects/{p}/logs` | `?since=<millis>` | `[Log]` |
| POST | `/api/projects/{p}/debug` | `{ text, sender?, room?, isGroupChat?, waitSeconds? }` | `{ replies: [string], error?, logs: [Log] }` |

`{p}` is the project's id (names work too), URL-encoded.

- `Project`: `{ id, name, languageId, mainScript, enabled, compiled, activeJobs }`
- `File`: `{ path, text, hash, modifiedMillis }`. `hash` is the SHA-256 of the file's bytes.
- `CompileResult`: `{ success, error?, errorPath?, errorLine?, errorColumn?, logs: [Log] }` (line and column are 1-based)
- `Log`: `{ type, tag, message, millis }`, `type` one of `VERBOSE DEBUG INFO WARN ERROR CRITICAL`

### Writes

`PUT .../file` with `expectedHash` writes only if the file still has that hash (`""`: only if it doesn't exist);
otherwise `409` with `{ "status": 409, "error": "...", "currentHash": "..." | null }`. Without `expectedHash` the
file is overwritten.

## Live updates: `GET /api/stream?project={id}`

Server-sent events (`text/event-stream`). The page reconnects with `EventSource`, which sends the cookie.

- `event: change` — something changed, by any tool (the IDE, MCP) or by StarLight:
  `{ type, projectId, actor, path?, from?, to?, hash?, success?, enabled?, message?, replies? }` where `type` is one of `fileWritten`,
  `fileDeleted`, `fileRenamed`, `compiled`, `enabledChanged`, `eventsChanged`, `projectCreated`, `projectDeleted`,
  `debugMessageSent`. `actor` is `"ide"` for the IDE's own changes.
- `event: log` — a new log of the project given by `?project=`: `Log`.
- `event: appLog` — a new log of StarLight or a plugin: `Log`.
- A comment line (`: ping`) every 15 seconds keeps the connection open.

## Static files

`GET /` serves `index.html`; other paths serve the files of the web build. Files with a content hash in their name are
cached for a year; `index.html` is not cached. Pre-compressed `.gz` copies are sent when the browser accepts gzip.
