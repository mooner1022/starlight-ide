package dev.mooner.starlightide.server

/** Settings read for each request; changing them needs no restart. */
data class IdeSettings(
    /** SHA-256 hex of the access token, or null if none is set. */
    val tokenHash: String? = null,
    /** Without a token, nobody can log in while this is on. */
    val requireToken: Boolean = true,
    val maxBodyBytes: Long = 4L * 1024 * 1024,
)
