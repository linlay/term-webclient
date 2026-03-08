package session

import (
	"strings"
	"sync"
)

const (
	escChar           = '\u001b'
	tabWidth          = 8
	maxSequenceLength = 256
)

type ScreenSnapshot struct {
	LastSeq int64
	Cols    int
	Rows    int
	Text    string
}

type parserState int

const (
	parserStateNormal parserState = iota
	parserStateEscape
	parserStateCSI
	parserStateOSC
	parserStateDCS
)

type ScreenTextTracker struct {
	mu            sync.Mutex
	mainBuffer    *screenBuffer
	altBuffer     *screenBuffer
	activeBuffer  *screenBuffer
	csiBuffer     strings.Builder
	state         parserState
	oscEscPending bool
	dcsEscPending bool
	cols          int
	rows          int
	lastSeq       int64
}

func NewScreenTextTracker(cols, rows int) *ScreenTextTracker {
	if cols <= 0 {
		cols = 1
	}
	if rows <= 0 {
		rows = 1
	}
	mainBuf := newScreenBuffer(rows, cols)
	altBuf := newScreenBuffer(rows, cols)
	return &ScreenTextTracker{
		mainBuffer:   mainBuf,
		altBuffer:    altBuf,
		activeBuffer: mainBuf,
		cols:         cols,
		rows:         rows,
	}
}

func (t *ScreenTextTracker) OnOutput(seq int64, chunk string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if seq > t.lastSeq {
		t.lastSeq = seq
	}
	for _, ch := range chunk {
		t.processChar(ch)
	}
}

func (t *ScreenTextTracker) OnResize(cols, rows int) {
	if cols <= 0 {
		cols = 1
	}
	if rows <= 0 {
		rows = 1
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cols == cols && t.rows == rows {
		return
	}
	t.cols = cols
	t.rows = rows
	t.mainBuffer.resize(rows, cols)
	t.altBuffer.resize(rows, cols)
}

func (t *ScreenTextTracker) Snapshot() ScreenSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()

	return ScreenSnapshot{
		LastSeq: t.lastSeq,
		Cols:    t.cols,
		Rows:    t.rows,
		Text:    t.snapshotCompactText(t.activeBuffer),
	}
}

func (t *ScreenTextTracker) processChar(ch rune) {
	switch t.state {
	case parserStateNormal:
		t.processNormalChar(ch)
	case parserStateEscape:
		t.processEscapeChar(ch)
	case parserStateCSI:
		t.processCSIChar(ch)
	case parserStateOSC:
		t.processOSCChar(ch)
	case parserStateDCS:
		t.processDCSChar(ch)
	default:
		t.state = parserStateNormal
	}
}

func (t *ScreenTextTracker) processNormalChar(ch rune) {
	if ch == escChar {
		t.state = parserStateEscape
		return
	}

	switch ch {
	case '\r':
		t.activeBuffer.cursorCol = 0
	case '\n':
		t.lineFeed()
	case '\b', 127:
		if t.activeBuffer.cursorCol > 0 {
			t.activeBuffer.cursorCol--
		}
	case '\t':
		nextStop := ((t.activeBuffer.cursorCol / tabWidth) + 1) * tabWidth
		t.activeBuffer.cursorCol = min(t.cols-1, nextStop)
	default:
		if ch >= 32 && ch != 127 {
			t.putChar(ch)
		}
	}
}

func (t *ScreenTextTracker) processEscapeChar(ch rune) {
	t.state = parserStateNormal
	switch ch {
	case '[':
		t.state = parserStateCSI
		t.csiBuffer.Reset()
	case ']':
		t.state = parserStateOSC
		t.oscEscPending = false
	case 'P':
		t.state = parserStateDCS
		t.dcsEscPending = false
	case '7':
		t.saveCursor()
	case '8':
		t.restoreCursor()
	}
}

func (t *ScreenTextTracker) processCSIChar(ch rune) {
	if ch == escChar {
		t.csiBuffer.Reset()
		t.state = parserStateEscape
		return
	}

	t.csiBuffer.WriteRune(ch)
	if t.csiBuffer.Len() > maxSequenceLength {
		t.csiBuffer.Reset()
		t.state = parserStateNormal
		return
	}

	if ch >= '@' && ch <= '~' {
		t.handleCSI(t.csiBuffer.String())
		t.csiBuffer.Reset()
		t.state = parserStateNormal
	}
}

func (t *ScreenTextTracker) processOSCChar(ch rune) {
	if t.oscEscPending {
		t.oscEscPending = false
		if ch == '\\' {
			t.state = parserStateNormal
			return
		}
	}
	if ch == '\u0007' {
		t.state = parserStateNormal
		return
	}
	if ch == escChar {
		t.oscEscPending = true
	}
}

func (t *ScreenTextTracker) processDCSChar(ch rune) {
	if t.dcsEscPending {
		t.dcsEscPending = false
		if ch == '\\' {
			t.state = parserStateNormal
			return
		}
	}
	if ch == '\u0007' {
		t.state = parserStateNormal
		return
	}
	if ch == escChar {
		t.dcsEscPending = true
	}
}

func (t *ScreenTextTracker) handleCSI(sequence string) {
	if sequence == "" {
		return
	}
	command := rune(sequence[len(sequence)-1])
	body := sequence[:len(sequence)-1]
	privateMode := strings.HasPrefix(body, "?")
	paramsBody := body
	if privateMode {
		paramsBody = body[1:]
	}
	params := parseCSIParams(paramsBody)

	switch command {
	case 'A':
		t.moveCursorRelative(-positiveParam(params, 0, 1), 0)
	case 'B':
		t.moveCursorRelative(positiveParam(params, 0, 1), 0)
	case 'C':
		t.moveCursorRelative(0, positiveParam(params, 0, 1))
	case 'D':
		t.moveCursorRelative(0, -positiveParam(params, 0, 1))
	case 'G':
		t.setCursor(t.activeBuffer.cursorRow, positiveParam(params, 0, 1)-1)
	case 'H', 'f':
		t.setCursor(positiveParam(params, 0, 1)-1, positiveParam(params, 1, 1)-1)
	case 'J':
		t.eraseDisplay(paramOrDefault(params, 0, 0))
	case 'K':
		t.eraseLine(paramOrDefault(params, 0, 0))
	case '@':
		t.insertChars(positiveParam(params, 0, 1))
	case 'P':
		t.deleteChars(positiveParam(params, 0, 1))
	case 'X':
		t.eraseChars(positiveParam(params, 0, 1))
	case 's':
		t.saveCursor()
	case 'u':
		t.restoreCursor()
	case 'h', 'l':
		if privateMode {
			t.handlePrivateMode(params, command == 'h')
		}
	}
}

func (t *ScreenTextTracker) handlePrivateMode(params []int, setMode bool) {
	for _, mode := range params {
		if mode != 1049 && mode != 1047 && mode != 47 {
			continue
		}
		if setMode {
			if mode == 1049 {
				t.mainBuffer.savedCursorRow = t.mainBuffer.cursorRow
				t.mainBuffer.savedCursorCol = t.mainBuffer.cursorCol
			}
			t.activeBuffer = t.altBuffer
			t.clearBuffer(t.altBuffer)
			t.setCursor(0, 0)
			continue
		}

		t.activeBuffer = t.mainBuffer
		if mode == 1049 {
			t.setCursor(t.mainBuffer.savedCursorRow, t.mainBuffer.savedCursorCol)
		}
	}
}

func (t *ScreenTextTracker) lineFeed() {
	if t.activeBuffer.cursorRow >= t.rows-1 {
		t.scrollUp(t.activeBuffer)
		return
	}
	t.activeBuffer.cursorRow++
}

func (t *ScreenTextTracker) putChar(ch rune) {
	if t.activeBuffer.cursorRow < 0 || t.activeBuffer.cursorRow >= t.rows || t.activeBuffer.cursorCol < 0 || t.activeBuffer.cursorCol >= t.cols {
		t.setCursor(t.activeBuffer.cursorRow, t.activeBuffer.cursorCol)
	}
	t.activeBuffer.cells[t.activeBuffer.cursorRow][t.activeBuffer.cursorCol] = ch

	if t.activeBuffer.cursorCol >= t.cols-1 {
		t.activeBuffer.cursorCol = 0
		if t.activeBuffer.cursorRow >= t.rows-1 {
			t.scrollUp(t.activeBuffer)
		} else {
			t.activeBuffer.cursorRow++
		}
		return
	}
	t.activeBuffer.cursorCol++
}

func (t *ScreenTextTracker) moveCursorRelative(dRow, dCol int) {
	t.setCursor(t.activeBuffer.cursorRow+dRow, t.activeBuffer.cursorCol+dCol)
}

func (t *ScreenTextTracker) setCursor(row, col int) {
	t.activeBuffer.cursorRow = clamp(row, 0, t.rows-1)
	t.activeBuffer.cursorCol = clamp(col, 0, t.cols-1)
}

func (t *ScreenTextTracker) saveCursor() {
	t.activeBuffer.savedCursorRow = t.activeBuffer.cursorRow
	t.activeBuffer.savedCursorCol = t.activeBuffer.cursorCol
}

func (t *ScreenTextTracker) restoreCursor() {
	t.setCursor(t.activeBuffer.savedCursorRow, t.activeBuffer.savedCursorCol)
}

func (t *ScreenTextTracker) eraseDisplay(mode int) {
	switch mode {
	case 1:
		for row := 0; row < t.activeBuffer.cursorRow; row++ {
			fillRow(t.activeBuffer.cells[row], ' ')
		}
		t.clearRange(t.activeBuffer.cells[t.activeBuffer.cursorRow], 0, t.activeBuffer.cursorCol)
	case 2, 3:
		t.clearBuffer(t.activeBuffer)
	case 0:
		t.clearRange(t.activeBuffer.cells[t.activeBuffer.cursorRow], t.activeBuffer.cursorCol, t.cols-1)
		for row := t.activeBuffer.cursorRow + 1; row < t.rows; row++ {
			fillRow(t.activeBuffer.cells[row], ' ')
		}
	}
}

func (t *ScreenTextTracker) eraseLine(mode int) {
	switch mode {
	case 1:
		t.clearRange(t.activeBuffer.cells[t.activeBuffer.cursorRow], 0, t.activeBuffer.cursorCol)
	case 2:
		fillRow(t.activeBuffer.cells[t.activeBuffer.cursorRow], ' ')
	case 0:
		t.clearRange(t.activeBuffer.cells[t.activeBuffer.cursorRow], t.activeBuffer.cursorCol, t.cols-1)
	}
}

func (t *ScreenTextTracker) insertChars(count int) {
	normalized := max(1, count)
	start := t.activeBuffer.cursorCol
	if start >= t.cols {
		return
	}
	width := min(normalized, t.cols-start)
	row := t.activeBuffer.cells[t.activeBuffer.cursorRow]
	copy(row[start+width:], row[start:t.cols-width])
	for idx := start; idx < start+width; idx++ {
		row[idx] = ' '
	}
}

func (t *ScreenTextTracker) deleteChars(count int) {
	normalized := max(1, count)
	start := t.activeBuffer.cursorCol
	if start >= t.cols {
		return
	}
	width := min(normalized, t.cols-start)
	row := t.activeBuffer.cells[t.activeBuffer.cursorRow]
	copy(row[start:], row[start+width:])
	for idx := t.cols - width; idx < t.cols; idx++ {
		row[idx] = ' '
	}
}

func (t *ScreenTextTracker) eraseChars(count int) {
	normalized := max(1, count)
	start := t.activeBuffer.cursorCol
	if start >= t.cols {
		return
	}
	width := min(normalized, t.cols-start)
	t.clearRange(t.activeBuffer.cells[t.activeBuffer.cursorRow], start, start+width-1)
}

func (t *ScreenTextTracker) scrollUp(buf *screenBuffer) {
	first := buf.cells[0]
	copy(buf.cells, buf.cells[1:])
	buf.cells[t.rows-1] = first
	fillRow(buf.cells[t.rows-1], ' ')
}

func (t *ScreenTextTracker) clearBuffer(buf *screenBuffer) {
	for row := 0; row < t.rows; row++ {
		fillRow(buf.cells[row], ' ')
	}
}

func (t *ScreenTextTracker) clearRange(row []rune, startInclusive, endInclusive int) {
	start := clamp(startInclusive, 0, t.cols-1)
	end := clamp(endInclusive, 0, t.cols-1)
	if start > end {
		return
	}
	for idx := start; idx <= end; idx++ {
		row[idx] = ' '
	}
}

func (t *ScreenTextTracker) snapshotCompactText(buf *screenBuffer) string {
	lines := make([]string, 0, t.rows)
	for row := 0; row < t.rows; row++ {
		cells := buf.cells[row]
		end := len(cells)
		for end > 0 && cells[end-1] == ' ' {
			end--
		}
		if end == 0 {
			lines = append(lines, "")
			continue
		}
		lines = append(lines, string(cells[:end]))
	}

	lastNonBlank := len(lines) - 1
	for lastNonBlank >= 0 && lines[lastNonBlank] == "" {
		lastNonBlank--
	}
	if lastNonBlank < 0 {
		return ""
	}
	return strings.Join(lines[:lastNonBlank+1], "\n")
}

type screenBuffer struct {
	cells          [][]rune
	cursorRow      int
	cursorCol      int
	savedCursorRow int
	savedCursorCol int
}

func newScreenBuffer(rows, cols int) *screenBuffer {
	cells := make([][]rune, rows)
	for row := 0; row < rows; row++ {
		cells[row] = make([]rune, cols)
		fillRow(cells[row], ' ')
	}
	return &screenBuffer{cells: cells}
}

func (b *screenBuffer) resize(newRows, newCols int) {
	resized := make([][]rune, newRows)
	for row := 0; row < newRows; row++ {
		resized[row] = make([]rune, newCols)
		fillRow(resized[row], ' ')
	}

	copyRows := min(len(b.cells), newRows)
	copyCols := min(len(b.cells[0]), newCols)
	for row := 0; row < copyRows; row++ {
		copy(resized[row][:copyCols], b.cells[row][:copyCols])
	}
	b.cells = resized
	b.cursorRow = clamp(b.cursorRow, 0, newRows-1)
	b.cursorCol = clamp(b.cursorCol, 0, newCols-1)
	b.savedCursorRow = clamp(b.savedCursorRow, 0, newRows-1)
	b.savedCursorCol = clamp(b.savedCursorCol, 0, newCols-1)
}

func parseCSIParams(body string) []int {
	if body == "" {
		return []int{}
	}
	raw := strings.Split(body, ";")
	params := make([]int, len(raw))
	for idx, value := range raw {
		if value == "" {
			continue
		}
		var parsed int
		for _, ch := range value {
			if ch < '0' || ch > '9' {
				parsed = 0
				break
			}
			parsed = parsed*10 + int(ch-'0')
		}
		params[idx] = parsed
	}
	return params
}

func paramOrDefault(params []int, index, fallback int) int {
	if index < 0 || index >= len(params) {
		return fallback
	}
	return params[index]
}

func positiveParam(params []int, index, fallback int) int {
	value := paramOrDefault(params, index, fallback)
	if value <= 0 {
		return fallback
	}
	return value
}

func fillRow(row []rune, value rune) {
	for idx := range row {
		row[idx] = value
	}
}

func clamp(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
