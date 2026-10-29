package dev.mooner.starlightide.types

import dev.mooner.starlightworkspace.ApiFunctionInfo
import dev.mooner.starlightworkspace.ApiInfo
import dev.mooner.starlightworkspace.ArgInfo
import dev.mooner.starlightworkspace.EventInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TypeDefinitionsTest {

    @Suppress("unused")
    class Sender(val name: String, val isBot: Boolean)

    @Suppress("unused")
    class Room(val name: String) {
        fun send(message: String): Boolean = true
    }

    @Suppress("unused")
    class ChatMessage(val message: String, val sender: Sender, val room: Room, val tags: List<String>, val count: Int)

    @Suppress("unused")
    class BotApi {
        fun reply(room: String, text: String) {}
        val version: Long = 1
    }

    @Test
    fun describesGlobalsAndEventTypes() {
        val result = TypeDefinitions(javaClass.classLoader!!).generate(
            apis = listOf(ApiInfo("Bot", BotApi::class.java.name, "OBJECT", listOf(ApiFunctionInfo("reply", emptyList(), "void")), emptyList())),
            events = listOf(EventInfo("starlight.message.create", "Message", "onMessage", null, listOf(ArgInfo("event", ChatMessage::class.java.name)))),
        )
        val dts = result.declarations
        assertTrue(dts, dts.contains("declare const Bot: StarLight.BotApi;"))
        assertTrue(dts, dts.contains("reply(p0: string, p1: string): void;"))
        assertTrue(dts, dts.contains("readonly version: number;"))
        assertTrue(dts, dts.contains("readonly sender: StarLight.Sender;"))
        assertTrue(dts, dts.contains("readonly tags: any[];"))
        // isBot() is a property, as script engines expose it.
        assertTrue(dts, dts.contains("readonly bot: boolean;"))
        assertTrue(dts, dts.contains("send(p0: string): boolean;"))
        assertEquals("StarLight.ChatMessage", result.typeOf(ChatMessage::class.java.name))
        assertEquals("any", result.typeOf("no.such.Class"))
    }
}
