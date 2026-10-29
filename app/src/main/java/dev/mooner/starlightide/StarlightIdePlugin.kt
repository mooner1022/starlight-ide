package dev.mooner.starlightide

import android.text.InputType
import dev.mooner.configdsl.ConfigStructure
import dev.mooner.configdsl.Icon
import dev.mooner.configdsl.config
import dev.mooner.configdsl.options.button
import dev.mooner.configdsl.options.password
import dev.mooner.configdsl.options.spinner
import dev.mooner.configdsl.options.string
import dev.mooner.configdsl.options.toggle
import dev.mooner.starlight.plugincore.config.data.ConfigData
import dev.mooner.starlight.plugincore.logger.LogData
import dev.mooner.starlight.plugincore.logger.LoggerFactory
import dev.mooner.starlight.plugincore.plugin.StarlightPlugin
import dev.mooner.starlightide.server.HttpServerEngine
import dev.mooner.starlightide.server.IdeHandler
import dev.mooner.starlightide.server.IdeSettings
import dev.mooner.starlightide.server.ServerState
import dev.mooner.starlightide.server.Sessions
import dev.mooner.starlightide.server.StaticFiles
import dev.mooner.starlightide.types.TypeDefinitions
import dev.mooner.starlightide.utils.ANY_HOST
import dev.mooner.starlightide.utils.LOCALHOST
import dev.mooner.starlightide.utils.copyServerUrl
import dev.mooner.starlightide.utils.sha256Hex
import dev.mooner.starlightide.utils.tr
import dev.mooner.starlightworkspace.Workspaces
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private val LOG = LoggerFactory.logger("IdePlugin")

@Suppress("unused")
class StarlightIdePlugin : StarlightPlugin() {

    // The server is started and stopped on this thread only: binding is network I/O, which Android forbids on the
    // main thread (config buttons are clicked there).
    private val serverExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "StarlightIde-Server").apply {
            isDaemon = true
            contextClassLoader = StarlightIdePlugin::class.java.classLoader
        }
    }

    /** Accessed on [serverExecutor] only. */
    private var engine: HttpServerEngine? = null

    private val sessions = Sessions()

    @Volatile
    private var settings = IdeSettings()
    @Volatile
    private var host: String = ANY_HOST
    @Volatile
    private var port: Int = IdeRuntime.DEFAULT_PORT
    private var autoStart = true
    /** False when the installed workspace plugin is too old. */
    @Volatile
    private var isUsable = false

    private val isRunning: Boolean
        get() = IdeRuntime.state.value is ServerState.Running

    override fun onEnable() {
        // StarLight checks only the major and minor version of the workspace plugin, not the patch this was built for.
        if (Workspaces.apiLevel < Workspaces.API_LEVEL) {
            LOG.error(LogData.FLAG_NOTIFY) {
                tr(
                    "Update the Workspace plugin: Web IDE needs its API level ${Workspaces.API_LEVEL} or later.",
                    "Workspace 플러그인을 업데이트하세요: 웹 IDE에는 API 레벨 ${Workspaces.API_LEVEL} 이상이 필요해요.",
                )
            }
            return
        }
        isUsable = true
        updateConfig(getPluginConfig())
        if (autoStart)
            serverExecutor.execute(::startServer)
    }

    override fun onDisable() {
        isUsable = false
        serverExecutor.execute(::stopServer)
    }

    override fun onConfigUpdated(config: ConfigData, updated: Map<String, Set<String>>) {
        super.onConfigUpdated(config, updated)
        val oldHost = host
        val oldPort = port
        val oldTokenHash = settings.tokenHash
        updateConfig(config)
        // A new token logs everyone out.
        if (settings.tokenHash != oldTokenHash)
            sessions.clear()
        if ((host != oldHost || port != oldPort) && isRunning) {
            LOG.info { tr("Restarting the IDE on $host:$port", "$host:$port 에서 IDE를 다시 시작해요.") }
            serverExecutor.execute(::restartServer)
        }
    }

    private fun updateConfig(config: ConfigData) {
        with(config.category(CATEGORY_GENERAL)) {
            port = getString(CONF_PORT)?.toIntOrNull()?.takeIf(::isValidPort) ?: IdeRuntime.DEFAULT_PORT
            host = if (getInt(CONF_BIND, BIND_ALL) == BIND_LOCAL) LOCALHOST else ANY_HOST
            autoStart = getBoolean(CONF_AUTO_START, true)
        }
        val security = config.category(CATEGORY_SECURITY)
        settings = IdeSettings(
            tokenHash = security.getString(CONF_TOKEN)?.takeUnless { it.isBlank() || it == EMPTY_TOKEN_HASH },
            requireToken = security.getBoolean(CONF_REQUIRE_TOKEN, true),
        )
    }

    // ------------------------------------------------------------------ server

    /** Runs on [serverExecutor]. */
    private fun startServer() {
        if (engine != null || !isUsable)
            return
        if (settings.requireToken && settings.tokenHash == null)
            LOG.warn {
                tr(
                    "Web IDE access token is not set: nobody can log in. Set one in the plugin settings.",
                    "웹 IDE 접근 토큰이 설정되지 않아 로그인할 수 없어요. 플러그인 설정에서 토큰을 지정하세요.",
                )
            }
        val host = host
        val port = port
        IdeRuntime.setState(ServerState.Starting)
        val classLoader = StarlightIdePlugin::class.java.classLoader!!
        val handler = IdeHandler(
            workspace = { Workspaces.current },
            settings = { settings },
            sessions = sessions,
            staticFiles = StaticFiles(classLoader),
            types = TypeDefinitions(classLoader),
            version = info.version.toString(),
            log = { message -> LOG.info { message } },
        )
        val engine = HttpServerEngine(handler)
        try {
            engine.start(host, port)
        } catch (e: Throwable) {
            IdeRuntime.setState(ServerState.Failed(e.message ?: e.toString()))
            LOG.error { tr("Failed to start the Web IDE on $host:$port: $e", "$host:$port 에서 웹 IDE를 시작하지 못했어요: $e") }
            return
        }
        this.engine = engine
        IdeRuntime.setState(ServerState.Running(host, port, System.currentTimeMillis()))
        val urls = IdeRuntime.serverInfo().urls.joinToString()
        LOG.info { tr("Web IDE started: $urls", "웹 IDE 시작됨: $urls") }
    }

    /** Runs on [serverExecutor]. */
    private fun stopServer() {
        val engine = engine ?: return
        this.engine = null
        try {
            engine.stop()
        } catch (e: Exception) {
            LOG.error { tr("Error while stopping the Web IDE: $e", "웹 IDE 종료 중 오류 발생: $e") }
        }
        IdeRuntime.setState(ServerState.Stopped)
        LOG.info { tr("Web IDE stopped", "웹 IDE가 종료되었어요.") }
    }

    private fun restartServer() {
        stopServer()
        startServer()
    }

    // ------------------------------------------------------------------ config

    override fun getConfigStructure(): ConfigStructure = config {
        category {
            id = CATEGORY_GENERAL
            title = tr("General", "일반")
            textColor = color { COLOR_TITLE }
            items {
                string {
                    id = CONF_PORT
                    title = tr("Port", "포트")
                    hint = IdeRuntime.DEFAULT_PORT.toString()
                    defaultValue = IdeRuntime.DEFAULT_PORT.toString()
                    inputType = InputType.TYPE_CLASS_NUMBER
                    require = { value ->
                        if (value.toIntOrNull()?.let(::isValidPort) == true) null
                        else tr("Enter a port between $MIN_PORT and $MAX_PORT", "$MIN_PORT~$MAX_PORT 사이의 포트를 입력하세요")
                    }
                    icon = Icon.LINK
                    iconTintColor = color { COLOR_ICON }
                }
                spinner {
                    id = CONF_BIND
                    title = tr("Accept connections from", "접속 허용 범위")
                    items = listOf(
                        tr("All networks ($ANY_HOST)", "모든 네트워크 ($ANY_HOST)"),
                        tr("This device only ($LOCALHOST)", "이 기기에서만 ($LOCALHOST)"),
                    )
                    defaultIndex = BIND_ALL
                    icon = Icon.CLOUD
                    iconTintColor = color { COLOR_ICON }
                }
                toggle {
                    id = CONF_AUTO_START
                    title = tr("Start automatically", "자동 시작")
                    description = tr("Starts the IDE when StarLight starts.", "StarLight 시작 시 IDE를 함께 시작합니다.")
                    defaultValue = true
                    icon = Icon.POWER
                    iconTintColor = color { COLOR_ICON }
                }
            }
        }
        category {
            id = CATEGORY_CONTROL
            title = tr("Control", "제어")
            textColor = color { COLOR_SUB_TITLE }
            items {
                button {
                    val state = IdeRuntime.state.value
                    id = "state_indicator"
                    title = when (state) {
                        is ServerState.Running -> tr("Open ${IdeRuntime.serverInfo().urls.joinToString()} on your PC", "PC에서 ${IdeRuntime.serverInfo().urls.joinToString()} 접속")
                        ServerState.Starting   -> tr("Starting...", "시작 중...")
                        ServerState.Stopped    -> tr("Stopped", "중지됨")
                        is ServerState.Failed  -> tr("Failed: ${state.reason}", "오류: ${state.reason}")
                    }
                    description = if (state is ServerState.Running) tr("Tap to copy the address.", "눌러서 주소를 복사합니다.") else null
                    icon = Icon.POWER
                    iconTintColor = color {
                        when (state) {
                            is ServerState.Running -> "#4ADE80"
                            ServerState.Starting   -> "#F2B05E"
                            else                   -> "#FF6188"
                        }
                    }
                    setOnClickListener { view -> copyServerUrl(view.context) }
                }
                button {
                    val action = if (isRunning) tr("Stop", "중지") else tr("Start", "시작")
                    id = "toggle_server"
                    title = tr("$action IDE", "IDE $action")
                    icon = Icon.POWER
                    iconTintColor = color { "#FF6188" }
                    setOnClickListener { _ ->
                        LOG.info(LogData.FLAG_NOTIFY) { tr("$action IDE...", "IDE $action 중...") }
                        serverExecutor.execute {
                            if (engine != null) stopServer() else startServer()
                        }
                    }
                }
                button {
                    id = "logout_all"
                    title = tr("Log out every browser", "모든 브라우저 로그아웃")
                    icon = Icon.EXIT_TO_APP
                    iconTintColor = color { "#FF6188" }
                    setOnClickListener { _ ->
                        sessions.clear()
                        LOG.info(LogData.FLAG_NOTIFY) { tr("Logged out every browser", "모든 브라우저를 로그아웃했어요.") }
                    }
                }
            }
        }
        category {
            id = CATEGORY_SECURITY
            title = tr("Security", "보안")
            textColor = color { COLOR_SUB_TITLE }
            items {
                toggle {
                    id = CONF_REQUIRE_TOKEN
                    title = tr("Require access token", "접근 토큰 필수")
                    description = tr(
                        "Browsers log in with the token. Without it, anyone on the network can edit and run your scripts.",
                        "브라우저에서 토큰으로 로그인합니다. 끄면 같은 네트워크의 누구나 스크립트를 수정하고 실행할 수 있습니다.",
                    )
                    defaultValue = true
                    icon = Icon.LOCK
                    iconTintColor = color { COLOR_ICON }
                }
                password {
                    id = CONF_TOKEN
                    title = tr("Access token", "접근 토큰")
                    description = tr("Only a hash of the token is stored. Changing it logs everyone out.", "토큰은 해시로만 저장됩니다. 바꾸면 모두 로그아웃됩니다.")
                    hashCode = ::sha256Hex
                    require = { value -> if (value.length >= MIN_TOKEN_LENGTH) null else tr("At least $MIN_TOKEN_LENGTH characters", "${MIN_TOKEN_LENGTH}자 이상 입력하세요") }
                    icon = Icon.KEY
                    iconTintColor = color { COLOR_ICON }
                    dependency = CONF_REQUIRE_TOKEN
                }
            }
        }
    }

    private companion object {
        const val CATEGORY_GENERAL  = "general"
        const val CATEGORY_CONTROL  = "control"
        const val CATEGORY_SECURITY = "security"

        const val CONF_PORT          = "port"
        const val CONF_BIND          = "bind_address"
        const val CONF_AUTO_START    = "auto_start"
        const val CONF_REQUIRE_TOKEN = "require_token"
        const val CONF_TOKEN         = "access_token"

        const val BIND_ALL   = 0
        const val BIND_LOCAL = 1

        // Ports below 1024 need root on Android.
        const val MIN_PORT = 1024
        const val MAX_PORT = 65535
        const val MIN_TOKEN_LENGTH = 8

        val EMPTY_TOKEN_HASH = sha256Hex("")

        const val COLOR_TITLE     = "#7AA2F7"
        const val COLOR_SUB_TITLE = "#6A8FD8"
        const val COLOR_ICON      = "#7AA2F7"

        fun isValidPort(port: Int): Boolean =
            port in MIN_PORT..MAX_PORT
    }
}
