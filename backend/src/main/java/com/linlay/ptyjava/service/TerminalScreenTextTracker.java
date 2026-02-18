package com.linlay.ptyjava.service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;

public class TerminalScreenTextTracker {

    private static final char ESC = '\u001b';
    private static final int TAB_WIDTH = 8;
    private static final int MAX_SEQUENCE_LENGTH = 256;

    public record Snapshot(long lastSeq, int cols, int rows, String text) {
    }

    private enum ParserState {
        NORMAL,
        ESCAPE,
        CSI,
        OSC,
        DCS
    }

    private final ReentrantLock lock = new ReentrantLock();
    private final ScreenBuffer mainBuffer;
    private final ScreenBuffer alternateBuffer;
    private final StringBuilder csiBuffer = new StringBuilder();

    private ParserState parserState = ParserState.NORMAL;
    private boolean oscEscPending;
    private boolean dcsEscPending;
    private ScreenBuffer activeBuffer;
    private int cols;
    private int rows;
    private long lastSeq;

    public TerminalScreenTextTracker(int cols, int rows) {
        this.cols = Math.max(1, cols);
        this.rows = Math.max(1, rows);
        this.mainBuffer = new ScreenBuffer(this.rows, this.cols);
        this.alternateBuffer = new ScreenBuffer(this.rows, this.cols);
        this.activeBuffer = mainBuffer;
    }

    public void onOutput(long seq, String chunk) {
        lock.lock();
        try {
            lastSeq = Math.max(lastSeq, seq);
            if (chunk == null || chunk.isEmpty()) {
                return;
            }

            for (int i = 0; i < chunk.length(); i++) {
                processChar(chunk.charAt(i));
            }
        } finally {
            lock.unlock();
        }
    }

    public void onResize(int cols, int rows) {
        lock.lock();
        try {
            int normalizedCols = Math.max(1, cols);
            int normalizedRows = Math.max(1, rows);
            if (this.cols == normalizedCols && this.rows == normalizedRows) {
                return;
            }

            mainBuffer.resize(normalizedRows, normalizedCols);
            alternateBuffer.resize(normalizedRows, normalizedCols);
            this.cols = normalizedCols;
            this.rows = normalizedRows;
        } finally {
            lock.unlock();
        }
    }

    public Snapshot snapshot() {
        lock.lock();
        try {
            return new Snapshot(lastSeq, cols, rows, snapshotCompactText(activeBuffer));
        } finally {
            lock.unlock();
        }
    }

    private void processChar(char ch) {
        switch (parserState) {
            case NORMAL -> processNormalChar(ch);
            case ESCAPE -> processEscapeChar(ch);
            case CSI -> processCsiChar(ch);
            case OSC -> processOscChar(ch);
            case DCS -> processDcsChar(ch);
            default -> parserState = ParserState.NORMAL;
        }
    }

    private void processNormalChar(char ch) {
        if (ch == ESC) {
            parserState = ParserState.ESCAPE;
            return;
        }

        switch (ch) {
            case '\r' -> activeBuffer.cursorCol = 0;
            case '\n' -> lineFeed();
            case '\b', 127 -> activeBuffer.cursorCol = Math.max(0, activeBuffer.cursorCol - 1);
            case '\t' -> tabForward();
            default -> {
                if (!Character.isISOControl(ch)) {
                    putChar(ch);
                }
            }
        }
    }

    private void processEscapeChar(char ch) {
        parserState = ParserState.NORMAL;
        switch (ch) {
            case '[' -> {
                parserState = ParserState.CSI;
                csiBuffer.setLength(0);
            }
            case ']' -> {
                parserState = ParserState.OSC;
                oscEscPending = false;
            }
            case 'P' -> {
                parserState = ParserState.DCS;
                dcsEscPending = false;
            }
            case '7' -> saveCursor();
            case '8' -> restoreCursor();
            default -> {
                // Ignore unsupported escape sequence.
            }
        }
    }

    private void processCsiChar(char ch) {
        if (ch == ESC) {
            csiBuffer.setLength(0);
            parserState = ParserState.ESCAPE;
            return;
        }

        csiBuffer.append(ch);
        if (csiBuffer.length() > MAX_SEQUENCE_LENGTH) {
            csiBuffer.setLength(0);
            parserState = ParserState.NORMAL;
            return;
        }

        if (ch >= '@' && ch <= '~') {
            handleCsi(csiBuffer.toString());
            csiBuffer.setLength(0);
            parserState = ParserState.NORMAL;
        }
    }

    private void processOscChar(char ch) {
        if (oscEscPending) {
            oscEscPending = false;
            if (ch == '\\') {
                parserState = ParserState.NORMAL;
                return;
            }
        }
        if (ch == '\u0007') {
            parserState = ParserState.NORMAL;
            return;
        }
        if (ch == ESC) {
            oscEscPending = true;
        }
    }

    private void processDcsChar(char ch) {
        if (dcsEscPending) {
            dcsEscPending = false;
            if (ch == '\\') {
                parserState = ParserState.NORMAL;
                return;
            }
        }
        if (ch == '\u0007') {
            parserState = ParserState.NORMAL;
            return;
        }
        if (ch == ESC) {
            dcsEscPending = true;
        }
    }

    private void handleCsi(String sequence) {
        if (sequence.isEmpty()) {
            return;
        }

        char command = sequence.charAt(sequence.length() - 1);
        String body = sequence.substring(0, sequence.length() - 1);
        boolean privateMode = body.startsWith("?");
        String paramsBody = privateMode ? body.substring(1) : body;
        int[] params = parseParams(paramsBody);

        switch (command) {
            case 'A' -> moveCursorRelative(-positiveParam(params, 0, 1), 0);
            case 'B' -> moveCursorRelative(positiveParam(params, 0, 1), 0);
            case 'C' -> moveCursorRelative(0, positiveParam(params, 0, 1));
            case 'D' -> moveCursorRelative(0, -positiveParam(params, 0, 1));
            case 'G' -> setCursor(activeBuffer.cursorRow, positiveParam(params, 0, 1) - 1);
            case 'H', 'f' -> {
                int targetRow = positiveParam(params, 0, 1) - 1;
                int targetCol = positiveParam(params, 1, 1) - 1;
                setCursor(targetRow, targetCol);
            }
            case 'J' -> eraseDisplay(paramOrDefault(params, 0, 0));
            case 'K' -> eraseLine(paramOrDefault(params, 0, 0));
            case '@' -> insertChars(positiveParam(params, 0, 1));
            case 'P' -> deleteChars(positiveParam(params, 0, 1));
            case 'X' -> eraseChars(positiveParam(params, 0, 1));
            case 'm' -> {
                // Ignore style only.
            }
            case 's' -> saveCursor();
            case 'u' -> restoreCursor();
            case 'h', 'l' -> {
                if (privateMode) {
                    boolean set = command == 'h';
                    handlePrivateMode(params, set);
                }
            }
            default -> {
                // Ignore unsupported CSI sequence.
            }
        }
    }

    private void handlePrivateMode(int[] params, boolean setMode) {
        for (int mode : params) {
            if (mode != 1049 && mode != 1047 && mode != 47) {
                continue;
            }

            if (setMode) {
                if (mode == 1049) {
                    mainBuffer.savedCursorRow = mainBuffer.cursorRow;
                    mainBuffer.savedCursorCol = mainBuffer.cursorCol;
                }
                activeBuffer = alternateBuffer;
                clearBuffer(alternateBuffer);
                setCursor(0, 0);
                continue;
            }

            activeBuffer = mainBuffer;
            if (mode == 1049) {
                setCursor(mainBuffer.savedCursorRow, mainBuffer.savedCursorCol);
            }
        }
    }

    private int[] parseParams(String body) {
        if (body == null || body.isEmpty()) {
            return new int[0];
        }

        String[] raw = body.split(";", -1);
        int[] params = new int[raw.length];
        for (int i = 0; i < raw.length; i++) {
            String value = raw[i];
            if (value == null || value.isEmpty()) {
                params[i] = 0;
                continue;
            }
            try {
                params[i] = Integer.parseInt(value);
            } catch (NumberFormatException ex) {
                params[i] = 0;
            }
        }
        return params;
    }

    private int paramOrDefault(int[] params, int index, int defaultValue) {
        if (params == null || index < 0 || index >= params.length) {
            return defaultValue;
        }
        return params[index];
    }

    private int positiveParam(int[] params, int index, int defaultValue) {
        int value = paramOrDefault(params, index, defaultValue);
        return value <= 0 ? defaultValue : value;
    }

    private void lineFeed() {
        if (activeBuffer.cursorRow >= rows - 1) {
            scrollUp(activeBuffer);
            return;
        }
        activeBuffer.cursorRow += 1;
    }

    private void tabForward() {
        int nextStop = ((activeBuffer.cursorCol / TAB_WIDTH) + 1) * TAB_WIDTH;
        activeBuffer.cursorCol = Math.min(cols - 1, nextStop);
    }

    private void putChar(char ch) {
        if (activeBuffer.cursorRow < 0 || activeBuffer.cursorRow >= rows
            || activeBuffer.cursorCol < 0 || activeBuffer.cursorCol >= cols) {
            setCursor(activeBuffer.cursorRow, activeBuffer.cursorCol);
        }

        activeBuffer.cells[activeBuffer.cursorRow][activeBuffer.cursorCol] = ch;

        if (activeBuffer.cursorCol >= cols - 1) {
            activeBuffer.cursorCol = 0;
            if (activeBuffer.cursorRow >= rows - 1) {
                scrollUp(activeBuffer);
            } else {
                activeBuffer.cursorRow += 1;
            }
            return;
        }

        activeBuffer.cursorCol += 1;
    }

    private void moveCursorRelative(int dRow, int dCol) {
        setCursor(activeBuffer.cursorRow + dRow, activeBuffer.cursorCol + dCol);
    }

    private void setCursor(int row, int col) {
        activeBuffer.cursorRow = clamp(row, 0, rows - 1);
        activeBuffer.cursorCol = clamp(col, 0, cols - 1);
    }

    private void saveCursor() {
        activeBuffer.savedCursorRow = activeBuffer.cursorRow;
        activeBuffer.savedCursorCol = activeBuffer.cursorCol;
    }

    private void restoreCursor() {
        setCursor(activeBuffer.savedCursorRow, activeBuffer.savedCursorCol);
    }

    private void eraseDisplay(int mode) {
        switch (mode) {
            case 1 -> {
                for (int row = 0; row < activeBuffer.cursorRow; row++) {
                    fillRow(activeBuffer.cells[row], ' ');
                }
                clearRange(activeBuffer.cells[activeBuffer.cursorRow], 0, activeBuffer.cursorCol);
            }
            case 2, 3 -> clearBuffer(activeBuffer);
            case 0 -> {
                clearRange(activeBuffer.cells[activeBuffer.cursorRow], activeBuffer.cursorCol, cols - 1);
                for (int row = activeBuffer.cursorRow + 1; row < rows; row++) {
                    fillRow(activeBuffer.cells[row], ' ');
                }
            }
            default -> {
                // Ignore unsupported mode.
            }
        }
    }

    private void eraseLine(int mode) {
        switch (mode) {
            case 1 -> clearRange(activeBuffer.cells[activeBuffer.cursorRow], 0, activeBuffer.cursorCol);
            case 2 -> fillRow(activeBuffer.cells[activeBuffer.cursorRow], ' ');
            case 0 -> clearRange(activeBuffer.cells[activeBuffer.cursorRow], activeBuffer.cursorCol, cols - 1);
            default -> {
                // Ignore unsupported mode.
            }
        }
    }

    private void insertChars(int count) {
        int normalized = Math.max(1, count);
        int start = activeBuffer.cursorCol;
        if (start >= cols) {
            return;
        }
        int width = Math.min(normalized, cols - start);
        char[] row = activeBuffer.cells[activeBuffer.cursorRow];
        System.arraycopy(row, start, row, start + width, cols - start - width);
        clearRange(row, start, start + width - 1);
    }

    private void deleteChars(int count) {
        int normalized = Math.max(1, count);
        int start = activeBuffer.cursorCol;
        if (start >= cols) {
            return;
        }
        int width = Math.min(normalized, cols - start);
        char[] row = activeBuffer.cells[activeBuffer.cursorRow];
        System.arraycopy(row, start + width, row, start, cols - start - width);
        clearRange(row, cols - width, cols - 1);
    }

    private void eraseChars(int count) {
        int normalized = Math.max(1, count);
        int start = activeBuffer.cursorCol;
        if (start >= cols) {
            return;
        }
        int width = Math.min(normalized, cols - start);
        clearRange(activeBuffer.cells[activeBuffer.cursorRow], start, start + width - 1);
    }

    private void scrollUp(ScreenBuffer buffer) {
        char[] first = buffer.cells[0];
        for (int i = 1; i < rows; i++) {
            buffer.cells[i - 1] = buffer.cells[i];
        }
        buffer.cells[rows - 1] = first;
        fillRow(buffer.cells[rows - 1], ' ');
    }

    private void clearBuffer(ScreenBuffer buffer) {
        for (int row = 0; row < rows; row++) {
            fillRow(buffer.cells[row], ' ');
        }
    }

    private void clearRange(char[] row, int startInclusive, int endInclusive) {
        int start = clamp(startInclusive, 0, cols - 1);
        int end = clamp(endInclusive, 0, cols - 1);
        if (start > end) {
            return;
        }
        for (int i = start; i <= end; i++) {
            row[i] = ' ';
        }
    }

    private void fillRow(char[] row, char value) {
        for (int i = 0; i < row.length; i++) {
            row[i] = value;
        }
    }

    private int clamp(int value, int min, int max) {
        if (value < min) {
            return min;
        }
        return Math.min(value, max);
    }

    private String snapshotCompactText(ScreenBuffer buffer) {
        List<String> lines = new ArrayList<>(rows);
        for (int row = 0; row < rows; row++) {
            char[] cells = buffer.cells[row];
            int end = cells.length;
            while (end > 0 && cells[end - 1] == ' ') {
                end--;
            }
            lines.add(end == 0 ? "" : new String(cells, 0, end));
        }

        int lastNonBlank = lines.size() - 1;
        while (lastNonBlank >= 0 && lines.get(lastNonBlank).isEmpty()) {
            lastNonBlank--;
        }
        if (lastNonBlank < 0) {
            return "";
        }

        return String.join("\n", lines.subList(0, lastNonBlank + 1));
    }

    private static final class ScreenBuffer {
        private char[][] cells;
        private int cursorRow;
        private int cursorCol;
        private int savedCursorRow;
        private int savedCursorCol;

        private ScreenBuffer(int rows, int cols) {
            cells = new char[rows][cols];
            for (int row = 0; row < rows; row++) {
                for (int col = 0; col < cols; col++) {
                    cells[row][col] = ' ';
                }
            }
            cursorRow = 0;
            cursorCol = 0;
            savedCursorRow = 0;
            savedCursorCol = 0;
        }

        private void resize(int newRows, int newCols) {
            char[][] resized = new char[newRows][newCols];
            for (int row = 0; row < newRows; row++) {
                for (int col = 0; col < newCols; col++) {
                    resized[row][col] = ' ';
                }
            }

            int copyRows = Math.min(cells.length, newRows);
            int copyCols = Math.min(cells[0].length, newCols);
            for (int row = 0; row < copyRows; row++) {
                System.arraycopy(cells[row], 0, resized[row], 0, copyCols);
            }

            cells = resized;
            cursorRow = Math.min(Math.max(cursorRow, 0), newRows - 1);
            cursorCol = Math.min(Math.max(cursorCol, 0), newCols - 1);
            savedCursorRow = Math.min(Math.max(savedCursorRow, 0), newRows - 1);
            savedCursorCol = Math.min(Math.max(savedCursorCol, 0), newCols - 1);
        }
    }
}
