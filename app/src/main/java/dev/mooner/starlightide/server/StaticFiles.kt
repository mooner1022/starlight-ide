package dev.mooner.starlightide.server

import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.defaultForFilePath
import io.ktor.http.withCharset
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.GZIPInputStream

/**
 * The web page, packaged as Java resources under [root] (see the web build in app/build.gradle) and kept in memory
 * once read. Large files are packaged only as `.gz`, which is sent as is to browsers that accept gzip and decompressed
 * for the others.
 */
class StaticFiles(
    private val classLoader: ClassLoader,
    private val root: String = "web/",
) {

    private class Resource(val bytes: ByteArray?)

    private val cache: MutableMap<String, Resource> = ConcurrentHashMap()

    /** Responds with the file at [path], or `index.html` for page routes; false if there is no such file. */
    suspend fun respond(call: ApplicationCall, path: String): Boolean {
        val segments = path.split('/').filter(String::isNotEmpty)
        if (segments.any { it == ".." || it.contains('\\') })
            return false
        val name = segments.joinToString("/").ifEmpty { INDEX }
        val file = when {
            exists(name) -> name
            // Routes of the page itself, such as /projects/bot, get the page.
            !segments.last().contains('.') -> INDEX
            else -> return false
        }
        val gzip = read("$file.gz")
        val acceptsGzip = call.request.headers[HttpHeaders.AcceptEncoding]?.contains("gzip") == true
        val bytes = read(file)
            ?: if (gzip != null && !acceptsGzip) GZIPInputStream(gzip.inputStream()).use { it.readBytes() } else null
        if (bytes == null && gzip == null)
            return false
        call.response.header(HttpHeaders.Vary, HttpHeaders.AcceptEncoding)
        // Built files carry a content hash in their name; the page itself must be fetched again to find new ones.
        call.response.header(HttpHeaders.CacheControl, if (file == INDEX) "no-cache" else "public, max-age=$ONE_YEAR_SECONDS, immutable")
        val contentType = ContentType.defaultForFilePath(file).let {
            if (it.contentType == "text" || it.contentSubtype == "javascript") it.withCharset(Charsets.UTF_8) else it
        }
        if (gzip != null && acceptsGzip) {
            call.response.header(HttpHeaders.ContentEncoding, "gzip")
            call.respondBytes(gzip, contentType, HttpStatusCode.OK)
        } else {
            call.respondBytes(bytes!!, contentType, HttpStatusCode.OK)
        }
        return true
    }

    private fun exists(name: String): Boolean =
        read(name) != null || read("$name.gz") != null

    private fun read(name: String): ByteArray? =
        cache.getOrPut(name) { Resource(classLoader.getResourceAsStream(root + name)?.use { it.readBytes() }) }.bytes

    private companion object {
        const val INDEX = "index.html"
        const val ONE_YEAR_SECONDS = 365 * 24 * 60 * 60
    }
}
