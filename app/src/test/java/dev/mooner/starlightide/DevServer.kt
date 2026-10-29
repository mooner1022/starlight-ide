package dev.mooner.starlightide

import dev.mooner.starlightide.server.HttpServerEngine
import dev.mooner.starlightide.server.IdeHandler
import dev.mooner.starlightide.server.IdeSettings
import dev.mooner.starlightide.server.Sessions
import dev.mooner.starlightide.server.StaticFiles
import dev.mooner.starlightide.types.TypeDefinitions
import dev.mooner.starlightide.utils.sha256Hex
import dev.mooner.starlightworkspace.ApiFunctionInfo
import dev.mooner.starlightworkspace.ApiInfo
import dev.mooner.starlightworkspace.ArgInfo
import dev.mooner.starlightworkspace.DefaultWorkspace
import dev.mooner.starlightworkspace.EventInfo
import dev.mooner.starlightworkspace.testing.FakeHost
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URLClassLoader
import java.nio.file.Files

/**
 * The IDE over a fake StarLight with sample projects, for working on the page:
 *
 * ```sh
 * IDE_DEV_SERVER=8799 ./gradlew :app:testReleaseUnitTest --tests '*DevServer*'
 * ```
 *
 * then open http://127.0.0.1:8799 (token: dev-token). Skipped unless IDE_DEV_SERVER is set.
 */
class DevServer {

    @Suppress("unused")
    class Sender(val name: String, val isBot: Boolean)

    @Suppress("unused")
    class Room(val name: String, val isGroupChat: Boolean) {
        fun send(message: String): Boolean = true
        fun markAsRead(): Boolean = true
    }

    @Suppress("unused")
    class Message(val message: String, val sender: Sender, val room: Room, val packageName: String, val hasMention: Boolean)

    @Suppress("unused")
    class BotApi {
        fun reply(room: String, message: String): Boolean = true
        fun getRooms(): List<String> = emptyList()
        val version: String = "1.0"
    }

    @Test
    fun serve() {
        val port = System.getenv("IDE_DEV_SERVER")?.toIntOrNull()
        assumeTrue("Set IDE_DEV_SERVER=<port> to run the dev server", port != null)

        val root = Files.createTempDirectory("ide-dev").toFile()
        val host = FakeHost(root)
        host.events.clear()
        host.events += EventInfo(FakeHost.MESSAGE_EVENT, "메시지 수신", "onMessage", "메시지를 받았을 때 호출됩니다.", listOf(ArgInfo("event", Message::class.java.name)))
        host.events += EventInfo("starlight.project.compile", "컴파일 시작", "onStartCompile", null, emptyList())
        host.events += EventInfo("webserver.server.setup", "웹 서버 설정", "onWebServerSetup", null, listOf(ArgInfo("server", "java.lang.Object")))
        host.events += EventInfo("mcp.tools.setup", "MCP 도구 설정", "onMcpSetup", null, listOf(ArgInfo("server", "java.lang.Object")))
        host.apis += ApiInfo("Bot", BotApi::class.java.name, "OBJECT", listOf(ApiFunctionInfo("reply", listOf("java.lang.String"), "boolean")), emptyList())

        val bot = host.addProject("hello-bot")
        bot.directory.resolve("hello-bot.js").writeText(SAMPLE_MAIN)
        bot.directory.resolve("lib").mkdirs()
        bot.directory.resolve("lib/commands.js").writeText(SAMPLE_COMMANDS)
        bot.directory.resolve("README.md").writeText("# hello-bot\n\n간단한 명령어 봇이에요.\n")
        bot.compile()
        bot.onMessage = { message, send ->
            when {
                message.text == "!핑" -> send("퐁!")
                message.text.startsWith("!따라해 ") -> send(message.text.removePrefix("!따라해 "))
                message.text == "!오류" -> throw IllegalStateException("TypeError: Cannot read properties of undefined (reading 'name')")
                else -> bot.log("unknown command: ${message.text}", "DEBUG")
            }
        }
        repeat(6) { bot.log("message handled in ${12 + it * 3}ms", if (it == 4) "WARN" else "INFO") }
        // Compiled but off; notice-board below isn't compiled, which in StarLight means off.
        host.addProject("weather").also { it.compile(); it.setEnabled(false) }
        host.addProject("notice-board")

        val webDir = File("build/generated/webResources")
        val workspace = DefaultWorkspace(host)
        val engine = HttpServerEngine(IdeHandler(
            workspace = { workspace },
            settings = { IdeSettings(tokenHash = sha256Hex("dev-token"), requireToken = true) },
            sessions = Sessions(),
            staticFiles = StaticFiles(URLClassLoader(arrayOf(webDir.toURI().toURL()), null)),
            types = TypeDefinitions(javaClass.classLoader!!),
            version = "0.1.0-dev",
            log = ::println,
        ))
        engine.start("127.0.0.1", port!!)
        println("IDE dev server on http://127.0.0.1:$port (token: dev-token)")
        Thread.sleep((System.getenv("IDE_DEV_SERVER_MINUTES")?.toLongOrNull() ?: 30) * 60_000)
        engine.stop()
    }

    private companion object {
        val SAMPLE_MAIN = """
            import { commands } from "./lib/commands.js";

            const PREFIX = "!";

            /**
             * @param {StarLight.Message} event
             */
            export function onMessage(event) {
                const text = event.message;
                if (!text.startsWith(PREFIX)) return;

                const [name, ...args] = text.slice(PREFIX.length).split(" ");
                const command = commands[name];
                if (command) {
                    event.room.send(command(args, event));
                }
            }
        """.trimIndent() + "\n"

        val SAMPLE_COMMANDS = """
            // Commands of the bot: name -> (args, event) => reply
            export const commands = {
                핑: () => "퐁!",
                따라해: (args) => args.join(" "),
                시간: () => new Date().toLocaleTimeString("ko-KR"),
            };
        """.trimIndent() + "\n"
    }
}
