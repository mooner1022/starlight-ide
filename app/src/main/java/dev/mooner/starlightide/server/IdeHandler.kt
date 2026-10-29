package dev.mooner.starlightide.server

import dev.mooner.starlightide.api.JsonMapping
import dev.mooner.starlightide.types.TypeDefinitions
import dev.mooner.starlightide.utils.sha256Hex
import dev.mooner.starlightworkspace.ConflictException
import dev.mooner.starlightworkspace.DebugMessage
import dev.mooner.starlightworkspace.Workspace
import dev.mooner.starlightworkspace.WorkspaceException
import dev.mooner.starlightworkspace.WorkspaceProject
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.decodeURLPart
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.contentLength
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.receiveChannel
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.response.respondText
import io.ktor.util.cio.ChannelIOException
import io.ktor.utils.io.ClosedByteChannelException
import io.ktor.utils.io.readBuffer
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.io.readByteArray
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.security.MessageDigest
import kotlin.time.Duration.Companion.seconds

/** Answers the page's requests: the API of API.md under `/api`, and the page's files otherwise. */
class IdeHandler(
    private val workspace: () -> Workspace,
    private val settings: () -> IdeSettings,
    private val sessions: Sessions,
    private val staticFiles: StaticFiles,
    private val types: TypeDefinitions,
    private val version: String,
    private val log: (message: String) -> Unit,
) {

    /** An error answered with [status] and [message], plus [extra] fields. */
    private class ApiException(val status: HttpStatusCode, message: String, val extra: JsonObject? = null) : Exception(message)

    suspend fun handle(call: ApplicationCall) {
        val method = call.request.httpMethod
        val path = call.request.path()
        try {
            val segments = path.split('/').filter(String::isNotEmpty).map { it.decodeURLPart() }
            if (segments.firstOrNull() == API)
                handleApi(call, method, segments.drop(1))
            else if (method != HttpMethod.Get && method != HttpMethod.Head)
                respondError(call, HttpStatusCode.MethodNotAllowed, "Method not allowed")
            else if (!staticFiles.respond(call, path))
                respondError(call, HttpStatusCode.NotFound, "Not found")
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            respondError(call, e.status, e.message.orEmpty(), e.extra)
        } catch (e: ConflictException) {
            respondError(call, HttpStatusCode.Conflict, e.message.orEmpty(), buildJsonObject { put("currentHash", e.currentHash) })
        } catch (e: WorkspaceException) {
            respondError(call, HttpStatusCode.BadRequest, e.message.orEmpty())
        } catch (e: IllegalArgumentException) {
            respondError(call, HttpStatusCode.BadRequest, e.message ?: "Bad request")
        } catch (e: Throwable) {
            // The page went away: reloaded, closed, or switched projects, which reopens the event stream.
            if (isDisconnect(e))
                return
            log("Failed to handle ${method.value} $path: $e")
            if (!call.response.isCommitted)
                respondError(call, HttpStatusCode.InternalServerError, e.message ?: e.toString())
        }
    }

    // ------------------------------------------------------------------ sessions

    private suspend fun handleApi(call: ApplicationCall, method: HttpMethod, segments: List<String>) {
        // Keeps other sites from using a logged-in browser: their pages have another origin, and can't add a
        // custom header to a cross-site request without CORS, which this server doesn't allow.
        if (!isSameOrigin(call))
            throw ApiException(HttpStatusCode.Forbidden, "Origin not allowed")
        if (method != HttpMethod.Get && call.request.headers[HEADER_REQUESTED_WITH] != REQUESTED_WITH)
            throw ApiException(HttpStatusCode.Forbidden, "Missing $HEADER_REQUESTED_WITH header")

        val settings = settings()
        when (segments) {
            listOf("session") -> return respondJson(call, buildJsonObject {
                put("authenticated", isAuthenticated(call, settings))
                put("requireToken", settings.requireToken)
                put("version", version)
            })
            listOf("login") -> {
                expect(method, HttpMethod.Post)
                val token = body(call, settings).string("token")
                if (!settings.requireToken || isValidToken(token, settings.tokenHash)) {
                    val id = sessions.create()
                    call.response.header(HttpHeaders.SetCookie, "${Sessions.COOKIE}=$id; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Sessions.DEFAULT_TTL_MILLIS / 1000}")
                    return call.respond(HttpStatusCode.NoContent)
                }
                // Slows guessing down.
                delay(LOGIN_FAILURE_DELAY_MILLIS)
                throw ApiException(HttpStatusCode.Unauthorized, if (settings.tokenHash == null) "No access token is set in the plugin settings" else "Wrong token")
            }
            listOf("logout") -> {
                expect(method, HttpMethod.Post)
                sessions.remove(call.request.cookies[Sessions.COOKIE])
                call.response.header(HttpHeaders.SetCookie, "${Sessions.COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
                return call.respond(HttpStatusCode.NoContent)
            }
        }
        if (!isAuthenticated(call, settings))
            throw ApiException(HttpStatusCode.Unauthorized, "Log in first")
        route(call, method, segments, settings)
    }

    private fun isAuthenticated(call: ApplicationCall, settings: IdeSettings): Boolean =
        !settings.requireToken || sessions.touch(call.request.cookies[Sessions.COOKIE])

    private fun isValidToken(token: String?, tokenHash: String?): Boolean =
        token != null && tokenHash != null && MessageDigest.isEqual(sha256Hex(token).toByteArray(), tokenHash.toByteArray())

    /** No Origin, or a page of this server or of this device (as the dev server proxying to it). */
    private fun isSameOrigin(call: ApplicationCall): Boolean {
        val origin = call.request.headers[HttpHeaders.Origin] ?: return true
        val originHost = runCatching { Url(origin).host }.getOrNull() ?: return false
        if (originHost in LOCAL_HOSTS)
            return true
        val host = call.request.headers[HttpHeaders.Host]?.substringBeforeLast(':')?.removeSurrounding("[", "]")
        return originHost.removeSurrounding("[", "]") == host
    }

    // ------------------------------------------------------------------ workspace

    private suspend fun route(call: ApplicationCall, method: HttpMethod, segments: List<String>, settings: IdeSettings) {
        val workspace = workspace()
        when {
            segments == listOf("projects") && method == HttpMethod.Get ->
                respondJson(call, JsonArray(workspace.projects().map { JsonMapping.project(it) }))
            segments == listOf("projects") && method == HttpMethod.Post -> {
                val body = body(call, settings)
                val project = workspace.createProject(
                    name = body.requireString("name"),
                    languageId = body.requireString("language"),
                    eventIds = body.stringSet("events").ifEmpty { setOf(MESSAGE_EVENT) },
                    actor = ACTOR,
                )
                respondJson(call, JsonMapping.project(project.summary, project.allowedEvents()), HttpStatusCode.Created)
            }
            segments == listOf("languages") -> respondJson(call, buildJsonArray {
                for (language in workspace.languages())
                    add(buildJsonObject {
                        put("id", language.id)
                        put("name", language.name)
                        put("fileExtension", language.fileExtension)
                    })
            })
            segments == listOf("events") -> {
                val events = workspace.eventCatalog()
                val types = types.generate(workspace.apiCatalog(), events)
                respondJson(call, buildJsonArray {
                    for (event in events)
                        add(buildJsonObject {
                            put("id", event.id)
                            put("name", event.name)
                            put("functionName", event.functionName)
                            event.comment?.let { put("comment", it) }
                            putJsonArray("args") {
                                for (arg in event.args)
                                    add(buildJsonObject {
                                        put("name", arg.name)
                                        put("type", arg.type)
                                        put("tsType", types.typeOf(arg.type))
                                    })
                            }
                        })
                })
            }
            segments == listOf("types") ->
                call.respondText(types.generate(workspace.apiCatalog(), workspace.eventCatalog()).declarations, ContentType.Text.Plain)
            segments == listOf("stream") -> stream(call, workspace)
            segments == listOf("logs") -> {
                val since = call.request.queryParameters["since"]?.toLongOrNull() ?: 0
                respondJson(call, JsonArray(workspace.appLogs(since).map(JsonMapping::log)))
            }
            segments.size >= 2 && segments[0] == "projects" ->
                routeProject(call, method, projectOf(workspace, segments[1]), segments.drop(2), settings)
            else -> throw ApiException(HttpStatusCode.NotFound, "No such API: /${segments.joinToString("/")}")
        }
    }

    private suspend fun routeProject(call: ApplicationCall, method: HttpMethod, project: WorkspaceProject, rest: List<String>, settings: IdeSettings) {
        val query = call.request.queryParameters
        when (rest.firstOrNull()) {
            null -> respondJson(call, JsonMapping.project(project.summary, project.allowedEvents()))
            "files" -> {
                val files = project.listFiles(query["path"] ?: ".", MAX_LISTED_FILES)
                respondJson(call, buildJsonObject {
                    putJsonArray("entries") {
                        for (entry in files.entries)
                            add(buildJsonObject {
                                put("path", entry.path)
                                put("isDirectory", entry.isDirectory)
                                put("size", entry.size)
                                put("modifiedMillis", entry.modifiedMillis)
                            })
                    }
                    put("truncated", files.isTruncated)
                })
            }
            "file" -> when (method) {
                HttpMethod.Get -> respondJson(call, JsonMapping.file(project.readFile(requireQuery(query["path"], "path")), withText = true))
                HttpMethod.Put -> {
                    val body = body(call, settings)
                    val expectedHash = body["expectedHash"]?.let { (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content }
                    val file = project.writeFile(body.requireString("path"), body.requireString("text"), expectedHash, ACTOR)
                    respondJson(call, JsonMapping.file(file, withText = false))
                }
                HttpMethod.Delete -> {
                    project.deleteFile(requireQuery(query["path"], "path"), ACTOR)
                    call.respond(HttpStatusCode.NoContent)
                }
                else -> throw methodNotAllowed()
            }
            "rename" -> {
                expect(method, HttpMethod.Post)
                val body = body(call, settings)
                project.renameFile(body.requireString("from"), body.requireString("to"), ACTOR)
                call.respond(HttpStatusCode.NoContent)
            }
            "search" -> {
                val hits = project.search(
                    query = requireQuery(query["q"], "q"),
                    isRegex = query["regex"].toBoolean(),
                    ignoreCase = query["ignoreCase"]?.toBoolean() ?: true,
                    limit = MAX_SEARCH_HITS,
                )
                respondJson(call, buildJsonArray {
                    for (hit in hits)
                        add(buildJsonObject {
                            put("path", hit.path)
                            put("line", hit.line)
                            put("text", hit.text)
                        })
                })
            }
            "compile" -> {
                expect(method, HttpMethod.Post)
                respondJson(call, JsonMapping.compileResult(project.compile(ACTOR)))
            }
            "enabled" -> {
                expect(method, HttpMethod.Put)
                val enabled = (body(call, settings)["enabled"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull()
                    ?: throw IllegalArgumentException("Missing enabled")
                project.setEnabled(enabled, ACTOR)
                respondJson(call, JsonMapping.project(project.summary))
            }
            "events" -> {
                expect(method, HttpMethod.Put)
                val body = body(call, settings)
                val allowed = project.updateEvents(body.stringSet("allow"), body.stringSet("disallow"), ACTOR)
                respondJson(call, buildJsonObject { putJsonArray("allowed") { allowed.sorted().forEach { add(it) } } })
            }
            "logs" -> {
                val since = query["since"]?.toLongOrNull() ?: 0
                respondJson(call, JsonArray(project.logs(since).map(JsonMapping::log)))
            }
            "debug" -> {
                expect(method, HttpMethod.Post)
                val body = body(call, settings)
                val message = DebugMessage(
                    text = body.requireString("text"),
                    sender = body.string("sender")?.takeIf(String::isNotBlank),
                    room = body.string("room")?.takeIf(String::isNotBlank),
                    isGroupChat = (body["isGroupChat"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull(),
                )
                val wait = ((body["waitSeconds"] as? JsonPrimitive)?.content?.toIntOrNull() ?: DEFAULT_REPLY_WAIT_SECONDS)
                    .coerceIn(1, MAX_REPLY_WAIT_SECONDS).seconds
                val reply = project.sendDebugMessage(message, wait, ACTOR)
                respondJson(call, buildJsonObject {
                    putJsonArray("replies") { reply.replies.forEach { add(it) } }
                    reply.error?.let { put("error", it) }
                    putJsonArray("logs") { reply.logs.forEach { add(JsonMapping.log(it)) } }
                })
            }
            else -> throw ApiException(HttpStatusCode.NotFound, "No such API: ${rest.joinToString("/")}")
        }
    }

    /** Server-sent events: workspace changes, the app's logs, and the logs of the project the page shows. */
    private suspend fun stream(call: ApplicationCall, workspace: Workspace) {
        val project = call.request.queryParameters["project"]?.let { projectOf(workspace, it) }
        call.response.header(HttpHeaders.CacheControl, "no-cache")
        call.respondBytesWriter(ContentType.Text.EventStream) {
            // One writer for both sources.
            val events = Channel<String>(Channel.BUFFERED)
            coroutineScope {
                val producers = listOf(
                    launch { workspace.changes.collect { events.send(event("change", JsonMapping.change(it))) } },
                    launch { project?.logStream()?.collect { events.send(event("log", JsonMapping.log(it))) } },
                    launch { workspace.appLogStream().collect { events.send(event("appLog", JsonMapping.log(it))) } },
                )
                try {
                    writeStringUtf8(": connected\n\n")
                    flush()
                    while (true) {
                        val event = withTimeoutOrNull(STREAM_PING_MILLIS) { events.receive() } ?: ": ping\n\n"
                        writeStringUtf8(event)
                        flush()
                    }
                } finally {
                    producers.forEach { it.cancel() }
                }
            }
        }
    }

    /** Whether [e] means the connection broke while the request was read or the response written. */
    private fun isDisconnect(e: Throwable): Boolean =
        e is ChannelIOException || e is ClosedByteChannelException

    private fun event(name: String, data: JsonElement): String =
        "event: $name\ndata: $data\n\n"

    // ------------------------------------------------------------------ helpers

    private fun projectOf(workspace: Workspace, key: String): WorkspaceProject =
        try {
            workspace.project(key)
        } catch (e: WorkspaceException) {
            throw ApiException(HttpStatusCode.NotFound, e.message.orEmpty())
        }

    private suspend fun body(call: ApplicationCall, settings: IdeSettings): JsonObject {
        val length = call.request.contentLength()
        if (length != null && length > settings.maxBodyBytes)
            throw ApiException(HttpStatusCode.PayloadTooLarge, "Request is larger than ${settings.maxBodyBytes / 1024}KB")
        val bytes = call.receiveChannel().readBuffer(settings.maxBodyBytes + 1).readByteArray()
        if (bytes.size > settings.maxBodyBytes)
            throw ApiException(HttpStatusCode.PayloadTooLarge, "Request is larger than ${settings.maxBodyBytes / 1024}KB")
        return runCatching { Json.parseToJsonElement(bytes.decodeToString()) }.getOrNull() as? JsonObject
            ?: throw IllegalArgumentException("Body must be a JSON object")
    }

    private fun expect(method: HttpMethod, expected: HttpMethod) {
        if (method != expected)
            throw methodNotAllowed()
    }

    private fun methodNotAllowed(): ApiException =
        ApiException(HttpStatusCode.MethodNotAllowed, "Method not allowed")

    private fun requireQuery(value: String?, name: String): String =
        value ?: throw IllegalArgumentException("Missing query parameter: $name")

    private fun JsonObject.string(name: String): String? =
        (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.requireString(name: String): String =
        string(name) ?: throw IllegalArgumentException("Missing $name")

    private fun JsonObject.stringSet(name: String): Set<String> =
        (get(name) as? JsonArray)?.mapNotNullTo(linkedSetOf()) { (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content }.orEmpty()

    private suspend fun respondJson(call: ApplicationCall, json: JsonElement, status: HttpStatusCode = HttpStatusCode.OK) {
        call.response.header(HttpHeaders.CacheControl, "no-store")
        call.respondText(json.toString(), ContentType.Application.Json, status)
    }

    private suspend fun respondError(call: ApplicationCall, status: HttpStatusCode, message: String, extra: JsonObject? = null) {
        respondJson(call, buildJsonObject {
            put("status", status.value)
            put("error", message)
            extra?.forEach { (key, value) -> put(key, value ?: JsonNull) }
        }, status)
    }

    private companion object {
        const val API = "api"
        /** The actor of the workspace changes made through the IDE. */
        const val ACTOR = "ide"
        /** StarLight's message event, which new projects receive by default as in its new project dialog. */
        const val MESSAGE_EVENT = "starlight.message.create"

        const val HEADER_REQUESTED_WITH = "X-Requested-With"
        const val REQUESTED_WITH = "starlight-ide"
        const val LOGIN_FAILURE_DELAY_MILLIS = 1_000L
        const val STREAM_PING_MILLIS = 15_000L

        const val MAX_LISTED_FILES = 2_000
        const val MAX_SEARCH_HITS = 500
        const val DEFAULT_REPLY_WAIT_SECONDS = 5
        const val MAX_REPLY_WAIT_SECONDS = 60

        val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "[::1]", "::1")
    }
}
