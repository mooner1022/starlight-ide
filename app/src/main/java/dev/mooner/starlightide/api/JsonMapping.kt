package dev.mooner.starlightide.api

import dev.mooner.starlightworkspace.CompileResult
import dev.mooner.starlightworkspace.FileContent
import dev.mooner.starlightworkspace.LogEntry
import dev.mooner.starlightworkspace.ProjectSummary
import dev.mooner.starlightworkspace.WorkspaceChange
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** Workspace objects as API.md describes them. */
internal object JsonMapping {

    fun project(project: ProjectSummary, allowedEvents: Set<String>? = null): JsonObject = buildJsonObject {
        put("id", project.id)
        put("name", project.name)
        put("languageId", project.languageId)
        put("mainScript", project.mainScript)
        put("enabled", project.isEnabled)
        put("compiled", project.isCompiled)
        put("activeJobs", project.activeJobs)
        if (allowedEvents != null)
            putJsonArray("allowedEvents") { allowedEvents.sorted().forEach { add(it) } }
    }

    fun file(file: FileContent, withText: Boolean): JsonObject = buildJsonObject {
        put("path", file.path)
        if (withText)
            put("text", file.text)
        put("hash", file.hash)
        put("modifiedMillis", file.modifiedMillis)
    }

    fun log(log: LogEntry): JsonObject = buildJsonObject {
        put("type", log.type)
        put("tag", log.tag)
        put("message", log.message)
        put("millis", log.millis)
    }

    fun compileResult(result: CompileResult): JsonObject = buildJsonObject {
        put("success", result.isSuccess)
        result.error?.let { put("error", it) }
        result.errorPath?.let { put("errorPath", it) }
        result.errorLine?.let { put("errorLine", it) }
        result.errorColumn?.let { put("errorColumn", it) }
        putJsonArray("logs") { result.logs.forEach { add(log(it)) } }
    }

    fun change(change: WorkspaceChange): JsonObject = buildJsonObject {
        put("projectId", change.projectId)
        put("actor", change.actor)
        when (change) {
            is WorkspaceChange.FileWritten -> {
                type("fileWritten")
                put("path", change.path)
                put("hash", change.hash)
            }
            is WorkspaceChange.FileDeleted -> {
                type("fileDeleted")
                put("path", change.path)
            }
            is WorkspaceChange.FileRenamed -> {
                type("fileRenamed")
                put("from", change.from)
                put("to", change.to)
            }
            is WorkspaceChange.Compiled -> {
                type("compiled")
                put("success", change.isSuccess)
            }
            is WorkspaceChange.EnabledChanged -> {
                type("enabledChanged")
                put("enabled", change.isEnabled)
            }
            is WorkspaceChange.EventsChanged    -> type("eventsChanged")
            is WorkspaceChange.ProjectCreated   -> type("projectCreated")
            is WorkspaceChange.ProjectDeleted   -> type("projectDeleted")
            is WorkspaceChange.DebugMessageSent -> type("debugMessageSent")
        }
    }

    private fun JsonObjectBuilder.type(type: String) {
        put("type", type)
    }
}
