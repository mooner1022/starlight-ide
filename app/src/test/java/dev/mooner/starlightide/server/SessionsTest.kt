package dev.mooner.starlightide.server

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionsTest {

    @Test
    fun countsOnlyLiveSessions() {
        var now = 0L
        val sessions = Sessions(ttlMillis = 1_000, now = { now })
        sessions.create()
        now = 600
        val recent = sessions.create()
        assertEquals(2, sessions.count())

        now = 1_200
        assertEquals("the first session expired", 1, sessions.count())

        sessions.remove(recent)
        assertEquals(0, sessions.count())
    }
}
