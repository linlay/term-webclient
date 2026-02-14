package com.linlay.ptyjava.service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;

public class TerminalOutputRingBuffer {

    public record OutputChunk(long seq, byte[] data) {
    }

    public record Snapshot(long requestedAfterSeq,
                           long firstAvailableSeq,
                           long latestSeq,
                           boolean truncated,
                           List<OutputChunk> chunks) {
    }

    private final int maxBytes;
    private final int maxChunks;
    private final Deque<OutputChunk> chunks = new ArrayDeque<>();
    private final ReentrantLock lock = new ReentrantLock();

    private int totalBytes = 0;
    private long latestSeq = 0L;

    public TerminalOutputRingBuffer(int maxBytes, int maxChunks) {
        this.maxBytes = Math.max(maxBytes, 1);
        this.maxChunks = Math.max(maxChunks, 1);
    }

    public void append(long seq, byte[] data) {
        if (data == null || data.length == 0) {
            return;
        }

        byte[] copy = data.clone();
        lock.lock();
        try {
            chunks.addLast(new OutputChunk(seq, copy));
            totalBytes += copy.length;
            latestSeq = Math.max(latestSeq, seq);
            trim();
        } finally {
            lock.unlock();
        }
    }

    public Snapshot snapshotAfter(long afterSeq) {
        lock.lock();
        try {
            if (chunks.isEmpty()) {
                return new Snapshot(afterSeq, afterSeq + 1, latestSeq, false, List.of());
            }

            long firstAvailableSeq = chunks.peekFirst().seq();
            boolean truncated = afterSeq < (firstAvailableSeq - 1);

            List<OutputChunk> result = new ArrayList<>();
            for (OutputChunk chunk : chunks) {
                if (chunk.seq() > afterSeq) {
                    result.add(chunk);
                }
            }

            return new Snapshot(afterSeq, firstAvailableSeq, latestSeq, truncated, result);
        } finally {
            lock.unlock();
        }
    }

    public long latestSeq() {
        lock.lock();
        try {
            return latestSeq;
        } finally {
            lock.unlock();
        }
    }

    private void trim() {
        while (!chunks.isEmpty() && (chunks.size() > maxChunks || totalBytes > maxBytes)) {
            OutputChunk removed = chunks.removeFirst();
            totalBytes -= removed.data().length;
        }
    }
}
