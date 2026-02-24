package com.linlay.termjava.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class TerminalOutputRingBufferTest {

    @Test
    void snapshotReturnsChunksAfterGivenSeq() {
        TerminalOutputRingBuffer buffer = new TerminalOutputRingBuffer(1024, 16);
        buffer.append(1, bytes("one"));
        buffer.append(2, bytes("two"));
        buffer.append(3, bytes("three"));

        TerminalOutputRingBuffer.Snapshot snapshot = buffer.snapshotAfter(1);

        assertFalse(snapshot.truncated());
        assertEquals(2, snapshot.chunks().size());
        assertEquals(2, snapshot.chunks().get(0).seq());
        assertEquals(3, snapshot.chunks().get(1).seq());
    }

    @Test
    void snapshotMarksTruncatedWhenOldSeqIsEvicted() {
        TerminalOutputRingBuffer buffer = new TerminalOutputRingBuffer(1024, 2);
        buffer.append(1, bytes("1234"));
        buffer.append(2, bytes("5678"));
        buffer.append(3, bytes("90ab"));

        TerminalOutputRingBuffer.Snapshot snapshot = buffer.snapshotAfter(0);

        assertTrue(snapshot.truncated());
        assertEquals(2, snapshot.firstAvailableSeq());
        assertEquals(3, snapshot.latestSeq());
    }

    private byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
