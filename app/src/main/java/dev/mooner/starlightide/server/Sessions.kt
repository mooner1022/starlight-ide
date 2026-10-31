package dev.mooner.starlightide.server

import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/** Logged-in browsers, in memory: restarting StarLight logs everyone out. */
class Sessions(
    private val ttlMillis: Long = DEFAULT_TTL_MILLIS,
    private val now: () -> Long = System::currentTimeMillis,
) {

    /** Session id to the time it was last used. */
    private val sessions: MutableMap<String, Long> = ConcurrentHashMap()
    private val random = SecureRandom()

    fun create(): String {
        sessions.entries.removeIf { (_, lastUsed) -> now() - lastUsed > ttlMillis }
        val id = ByteArray(ID_BYTES).also(random::nextBytes).joinToString("") { "%02x".format(it) }
        sessions[id] = now()
        return id
    }

    /** Whether [id] is a live session; using it extends it. */
    fun touch(id: String?): Boolean {
        val lastUsed = id?.let(sessions::get) ?: return false
        if (now() - lastUsed > ttlMillis) {
            sessions -= id
            return false
        }
        sessions[id] = now()
        return true
    }

    fun remove(id: String?) {
        if (id != null)
            sessions -= id
    }

    /** How many browsers are logged in. */
    fun count(): Int =
        sessions.values.count { lastUsed -> now() - lastUsed <= ttlMillis }

    /** Logs everyone out, as when the token changes. */
    fun clear() {
        sessions.clear()
    }

    companion object {
        const val COOKIE = "starlight_ide_session"
        const val DEFAULT_TTL_MILLIS = 7L * 24 * 60 * 60 * 1000
        private const val ID_BYTES = 32
    }
}
