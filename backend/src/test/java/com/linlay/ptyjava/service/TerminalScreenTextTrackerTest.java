package com.linlay.ptyjava.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class TerminalScreenTextTrackerTest {

    @Test
    void stripsAnsiStyleSequencesFromScreenText() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(20, 4);

        tracker.onOutput(1, "\u001b[31mred\u001b[0m");

        TerminalScreenTextTracker.Snapshot snapshot = tracker.snapshot();
        assertEquals("red", snapshot.text());
        assertEquals(1L, snapshot.lastSeq());
    }

    @Test
    void carriageReturnOverwritesCurrentLine() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(40, 4);

        tracker.onOutput(1, "progress 10%\rprogress 20%");

        assertEquals("progress 20%", tracker.snapshot().text());
    }

    @Test
    void clearScreenAndClearLineWork() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(20, 4);

        tracker.onOutput(1, "hello\nworld");
        tracker.onOutput(2, "\u001b[2J");
        tracker.onOutput(3, "abcde");
        tracker.onOutput(4, "\u001b[1G\u001b[2K");

        assertEquals("", tracker.snapshot().text());
    }

    @Test
    void cursorJumpCanRewriteExistingText() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(20, 4);

        tracker.onOutput(1, "abcde");
        tracker.onOutput(2, "\u001b[1;3HZ");

        assertEquals("abZde", tracker.snapshot().text());
    }

    @Test
    void alternateScreenSwitchesBackToMainScreen() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(20, 4);

        tracker.onOutput(1, "main");
        tracker.onOutput(2, "\u001b[?1049h");
        tracker.onOutput(3, "alt");
        assertEquals("alt", tracker.snapshot().text());

        tracker.onOutput(4, "\u001b[?1049l");
        assertEquals("main", tracker.snapshot().text());
    }

    @Test
    void resizeKeepsVisibleAreaWithNewDimensions() {
        TerminalScreenTextTracker tracker = new TerminalScreenTextTracker(6, 3);

        tracker.onOutput(1, "abcdef");
        tracker.onResize(4, 3);

        TerminalScreenTextTracker.Snapshot snapshot = tracker.snapshot();
        assertEquals(4, snapshot.cols());
        assertEquals(3, snapshot.rows());
        assertEquals("abcd", snapshot.text());
    }
}
