package dev.mooner.starlightide

import dev.mooner.starlightide.server.ServerState
import dev.mooner.starlightide.utils.serverUrls
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** State shared by the plugin and its config screen. */
object IdeRuntime {

    private val mState = MutableStateFlow<ServerState>(ServerState.Stopped)
    val state: StateFlow<ServerState> = mState.asStateFlow()

    internal fun setState(state: ServerState) {
        mState.value = state
    }

    class Info(val isRunning: Boolean, val urls: List<String>)

    fun serverInfo(): Info =
        when (val state = state.value) {
            is ServerState.Running -> Info(true, serverUrls(state.host, state.port))
            else                   -> Info(false, emptyList())
        }

    const val DEFAULT_PORT = 8766
}
