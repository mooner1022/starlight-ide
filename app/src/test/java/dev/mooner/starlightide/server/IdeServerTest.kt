package dev.mooner.starlightide.server

import dev.mooner.starlightide.types.TypeDefinitions
import dev.mooner.starlightide.utils.sha256Hex
import dev.mooner.starlightworkspace.DefaultWorkspace
import dev.mooner.starlightworkspace.testing.FakeHost
import dev.mooner.starlightworkspace.testing.FakeProject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.util.zip.GZIPInputStream

/** The IDE's HTTP API over a fake StarLight. */
class IdeServerTest {

    @get:Rule
    val folder = TemporaryFolder()

    private val port = ServerSocket(0).use { it.localPort }
    private lateinit var host: FakeHost
    private lateinit var bot: FakeProject
    private lateinit var engine: HttpServerEngine
    private lateinit var workspace: DefaultWorkspace
    private val sessions = Sessions()

    @Volatile
    private var settings = IdeSettings(tokenHash = sha256Hex(TOKEN), requireToken = true)

    private var cookie: String? = null

    @Before
    fun setUp() {
        host = FakeHost(folder.newFolder("projects"))
        bot = host.addProject("bot")
        bot.directory.resolve("bot.js").writeText("// main")
        workspace = DefaultWorkspace(host)
        val classLoader = javaClass.classLoader!!
        engine = HttpServerEngine(IdeHandler(
            workspace = { workspace },
            settings = { settings },
            sessions = sessions,
            staticFiles = StaticFiles(classLoader, "testweb/"),
            types = TypeDefinitions(classLoader),
            version = "0.1.0",
            log = {},
        ))
        engine.start("127.0.0.1", port)
    }

    @After
    fun tearDown() {
        engine.stop()
    }

    @Test
    fun logsIn() {
        assertEquals(false, get("/api/session").json().jsonObject["authenticated"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(401, get("/api/projects").status)
        assertEquals(401, send("POST", "/api/login", """{"token":"wrong"}""").status)

        login()
        assertNotNull(cookie)
        assertEquals(200, get("/api/projects").status)
        assertEquals("true", get("/api/session").json().jsonObject["authenticated"]!!.jsonPrimitive.content)

        send("POST", "/api/logout", "{}")
        assertEquals(401, get("/api/projects").status)
    }

    @Test
    fun withoutTokenEveryoneIsIn() {
        settings = settings.copy(requireToken = false)
        assertEquals(200, get("/api/projects").status)
    }

    @Test
    fun refusesOtherSites() {
        login()
        // Writes need the custom header, which other sites can't add without CORS.
        assertEquals(403, send("PUT", "/api/projects/bot/file", """{"path":"a.js","text":"x"}""", requestedWith = null).status)
        assertEquals(403, get("/api/projects", headers = mapOf("Origin" to "https://evil.example")).status)
        assertEquals(200, get("/api/projects", headers = mapOf("Origin" to "http://localhost:5173")).status)
        assertFalse(bot.directory.resolve("a.js").exists())
    }

    @Test
    fun editsFilesWithConflicts() {
        login()
        val file = get("/api/projects/id-bot/file?path=bot.js").json().jsonObject
        assertEquals("// main", file["text"]!!.jsonPrimitive.content)
        val hash = file["hash"]!!.jsonPrimitive.content

        val saved = send("PUT", "/api/projects/bot/file", """{"path":"bot.js","text":"// v2","expectedHash":"$hash"}""")
        assertEquals(200, saved.status)
        assertEquals("// v2", bot.directory.resolve("bot.js").readText())

        val conflict = send("PUT", "/api/projects/bot/file", """{"path":"bot.js","text":"// v3","expectedHash":"$hash"}""")
        assertEquals(409, conflict.status)
        assertEquals(saved.json().jsonObject["hash"], conflict.json().jsonObject["currentHash"])

        assertEquals(400, get("/api/projects/bot/file?path=../../secret").status)
        assertEquals(404, get("/api/projects/nope/files").status)
        val files = get("/api/projects/bot/files").json().jsonObject["entries"]!!.jsonArray
        assertEquals(listOf("bot.js"), files.map { it.jsonObject["path"]!!.jsonPrimitive.content })
    }

    @Test
    fun compilesAndTalksToTheBot() {
        login()
        val compiled = send("POST", "/api/projects/bot/compile", "").json().jsonObject
        assertEquals("true", compiled["success"]!!.jsonPrimitive.content)

        bot.onMessage = { message, reply -> reply("echo: ${message.text}") }
        val debug = send("POST", "/api/projects/bot/debug", """{"text":"hi","waitSeconds":2}""").json().jsonObject
        assertEquals(listOf("echo: hi"), debug["replies"]!!.jsonArray.map { it.jsonPrimitive.content })
    }

    @Test
    fun createsProjectsAndListsEvents() {
        login()
        val created = send("POST", "/api/projects", """{"name":"echo","language":"JS_NEON"}""")
        assertEquals(201, created.status)
        assertEquals(listOf(FakeHost.MESSAGE_EVENT), created.json().jsonObject["allowedEvents"]!!.jsonArray.map { it.jsonPrimitive.content })

        val events = get("/api/events").json().jsonArray
        assertEquals("onMessage", events.first().jsonObject["functionName"]!!.jsonPrimitive.content)
        assertTrue(get("/api/types").body.contains("declare namespace StarLight"))
    }

    @Test
    fun streamsChanges() {
        login()
        val connection = open("GET", "/api/stream?project=bot")
        connection.readTimeout = 5_000
        val reader = connection.inputStream.bufferedReader()
        assertEquals(": connected", reader.readLine())
        reader.readLine()

        // Another tool writes, and the project logs.
        Thread {
            Thread.sleep(200)
            workspace.project("bot").writeFile("from-mcp.js", "x", null, "mcp")
            bot.log("hello")
        }.start()
        val events = readEvents(reader, 2)
        connection.disconnect()
        val change = events.single { it.first == "change" }.second.jsonObject
        assertEquals("fileWritten", change["type"]!!.jsonPrimitive.content)
        assertEquals("from-mcp.js", change["path"]!!.jsonPrimitive.content)
        assertEquals("mcp", change["actor"]!!.jsonPrimitive.content)
        assertEquals("hello", events.single { it.first == "log" }.second.jsonObject["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun servesThePage() {
        val page = get("/")
        assertEquals(200, page.status)
        assertTrue(page.body.contains("<title>IDE</title>"))
        assertEquals("no-cache", page.header("Cache-Control"))
        // Routes of the page get the page.
        assertEquals(200, get("/projects/bot").status)

        val gzipped = open("GET", "/assets/app-abc123.js", mapOf("Accept-Encoding" to "gzip"))
        assertEquals("gzip", gzipped.getHeaderField("Content-Encoding"))
        assertTrue(gzipped.getHeaderField("Cache-Control").contains("immutable"))
        val text = GZIPInputStream(gzipped.inputStream).bufferedReader().readText()
        assertTrue(text.startsWith("console.log(\"app\");"))

        assertEquals(404, get("/assets/missing.js").status)
        assertEquals(404, get("/../secret.txt").status)
    }

    // ------------------------------------------------------------------ client

    private fun readEvents(reader: BufferedReader, count: Int): List<Pair<String, JsonElement>> {
        val events = arrayListOf<Pair<String, JsonElement>>()
        var name: String? = null
        while (events.size < count) {
            val line = reader.readLine() ?: break
            when {
                line.startsWith("event: ") -> name = line.removePrefix("event: ")
                line.startsWith("data: ") -> events += name!! to Json.parseToJsonElement(line.removePrefix("data: "))
            }
        }
        return events
    }

    private class Response(val status: Int, private val headers: Map<String, List<String>>, val body: String) {
        fun header(name: String): String? =
            headers.entries.firstOrNull { (key, _) -> key.equals(name, ignoreCase = true) }?.value?.firstOrNull()

        fun json(): JsonElement = Json.parseToJsonElement(body)
    }

    private fun login() {
        val response = send("POST", "/api/login", """{"token":"$TOKEN"}""")
        assertEquals(204, response.status)
        cookie = response.header("Set-Cookie")!!.substringBefore(';')
    }

    private fun get(path: String, headers: Map<String, String> = emptyMap()): Response =
        send("GET", path, null, headers = headers)

    private fun send(method: String, path: String, body: String?, requestedWith: String? = "starlight-ide", headers: Map<String, String> = emptyMap()): Response {
        val all = headers + (requestedWith?.let { mapOf("X-Requested-With" to it) } ?: emptyMap())
        val connection = open(method, path, all, body)
        try {
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.use { String(it.readBytes()) }.orEmpty()
            return Response(status, connection.headerFields.filterKeys { it != null }, text)
        } finally {
            connection.disconnect()
        }
    }

    private fun open(method: String, path: String, headers: Map<String, String> = emptyMap(), body: String? = null): HttpURLConnection {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5_000
        connection.readTimeout = 10_000
        cookie?.let { connection.setRequestProperty("Cookie", it) }
        headers.forEach(connection::setRequestProperty)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        return connection
    }

    private companion object {
        const val TOKEN = "s3cret-token"
    }
}
