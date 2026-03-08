package session

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

const maxEventDataChars = 1600

type ContextTracker struct {
	mu                sync.Mutex
	sessionID         string
	sessionType       model.SessionType
	maxEvents         int
	maxCommands       int
	eventSeq          atomic.Int64
	events            []model.SessionEventView
	commands          []model.CommandFrame
	manualInputBuffer strings.Builder
	startedAt         time.Time
	lastActivityAt    time.Time
	updatedAt         time.Time
	connectionState   string
	lastSeq           int64
	attachedClients   int
	lastExitCode      *int
	truncated         bool
	lastError         string
	lastWorkdir       string
}

func NewContextTracker(sessionID string, sessionType model.SessionType, maxEvents, maxCommands int, initialWorkdir string) *ContextTracker {
	if maxEvents < 64 {
		maxEvents = 64
	}
	if maxCommands < 16 {
		maxCommands = 16
	}
	now := time.Now().UTC()
	workdir := "."
	if strings.TrimSpace(initialWorkdir) != "" {
		workdir = strings.TrimSpace(initialWorkdir)
	}
	return &ContextTracker{
		sessionID:       sessionID,
		sessionType:     sessionType,
		maxEvents:       maxEvents,
		maxCommands:     maxCommands,
		startedAt:       now,
		lastActivityAt:  now,
		updatedAt:       now,
		connectionState: "created",
		lastWorkdir:     workdir,
		events:          make([]model.SessionEventView, 0, maxEvents),
		commands:        make([]model.CommandFrame, 0, maxCommands),
	}
}

func (t *ContextTracker) OnAttachedClientsChanged(attachedClients int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if attachedClients < 0 {
		attachedClients = 0
	}
	t.attachedClients = attachedClients
	if attachedClients > 0 {
		t.connectionState = "connected"
	} else if t.connectionState != "exited" {
		t.connectionState = "detached"
	}
	t.touch()
}

func (t *ContextTracker) OnInput(data, source string) {
	if data == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "input",
		Source:    source,
		Data:      stringPtr(t.abbreviate(data)),
	})
	if source == "manual" {
		t.processManualInput(data)
	}
	t.touch()
}

func (t *ContextTracker) OnOutput(outputSeq int64, data string) {
	if data == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	if outputSeq > t.lastSeq {
		t.lastSeq = outputSeq
	}
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "output",
		Source:    "runtime",
		OutputSeq: int64Ptr(outputSeq),
		Data:      stringPtr(t.abbreviate(data)),
	})
	t.touch()
}

func (t *ContextTracker) OnResize(cols, rows int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "resize",
		Source:    "runtime",
		Cols:      intPtr(cols),
		Rows:      intPtr(rows),
		Data:      stringPtr(fmt.Sprintf("cols=%d, rows=%d", cols, rows)),
	})
	t.touch()
}

func (t *ContextTracker) OnTruncated() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.truncated = true
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "truncated",
		Source:    "runtime",
		Data:      stringPtr("output history truncated"),
	})
	t.touch()
}

func (t *ContextTracker) OnError(message string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastError = message
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "error",
		Source:    "runtime",
		Data:      stringPtr(t.abbreviate(message)),
	})
	t.touch()
}

func (t *ContextTracker) RegisterManagedCommand(commandID, command string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().UTC()
	t.pushCommand(model.CommandFrame{
		CommandID:          commandID,
		Source:             "agent",
		Command:            command,
		BoundaryConfidence: 1.0,
		StartedAt:          &now,
		EndedAt:            &now,
		DurationMs:         int64Ptr(0),
		Status:             "PENDING",
	})
	t.touch()
}

func (t *ContextTracker) OnSessionClosed(exitCode *int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.connectionState = "exited"
	t.lastExitCode = exitCode
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: time.Now().UTC(),
		Type:      "session.exit",
		Source:    "runtime",
		ExitCode:  exitCode,
		Data:      stringPtr("session exited"),
	})
	t.touch()
}

func (t *ContextTracker) Snapshot(commandLimit, eventLimit int) model.SessionContextResponse {
	t.mu.Lock()
	defer t.mu.Unlock()

	if commandLimit <= 0 {
		commandLimit = 1
	}
	if eventLimit <= 0 {
		eventLimit = 1
	}
	commands := tailCopy(t.commands, commandLimit)
	events := tailCopy(t.events, eventLimit)
	meta := model.SessionMetaState{
		SessionID:       t.sessionID,
		SessionType:     t.sessionType,
		ConnectionState: t.connectionState,
		LastSeq:         t.lastSeq,
		AttachedClients: t.attachedClients,
		LastExitCode:    t.lastExitCode,
		CommandCount:    len(t.commands),
		Truncated:       t.truncated,
		LastError:       t.lastError,
		LastWorkdir:     t.lastWorkdir,
		StartedAt:       t.startedAt,
		LastActivityAt:  t.lastActivityAt,
		UpdatedAt:       t.updatedAt,
	}
	return model.SessionContextResponse{
		SessionID: t.sessionID,
		Meta:      meta,
		Commands:  commands,
		Events:    events,
		Summary:   buildSummary(meta, commands),
	}
}

func (t *ContextTracker) processManualInput(data string) {
	for _, ch := range data {
		switch ch {
		case '\r':
			continue
		case '\b', 127:
			if t.manualInputBuffer.Len() > 0 {
				current := t.manualInputBuffer.String()
				t.manualInputBuffer.Reset()
				t.manualInputBuffer.WriteString(current[:len(current)-1])
			}
		case '\n':
			t.finalizeManualCommand()
		default:
			if ch >= 32 && ch != 127 {
				t.manualInputBuffer.WriteRune(ch)
			}
		}
	}
}

func (t *ContextTracker) finalizeManualCommand() {
	command := strings.TrimSpace(t.manualInputBuffer.String())
	t.manualInputBuffer.Reset()
	if command == "" {
		return
	}

	now := time.Now().UTC()
	commandID := "manual-" + util.NewID()
	durationMs := int64(0)
	commandFrame := model.CommandFrame{
		CommandID:          commandID,
		Source:             "manual",
		Command:            command,
		BoundaryConfidence: 0.35,
		StartedAt:          &now,
		EndedAt:            &now,
		DurationMs:         &durationMs,
		Status:             "UNKNOWN",
	}
	t.pushCommand(commandFrame)

	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: now,
		Type:      "command.start",
		Source:    "manual",
		CommandID: &commandID,
		Data:      stringPtr(t.abbreviate(command)),
	})
	t.addEvent(model.SessionEventView{
		EventSeq:  t.eventSeq.Add(1),
		Timestamp: now,
		Type:      "command.end",
		Source:    "manual",
		CommandID: &commandID,
		Data:      stringPtr("manual boundary"),
	})

	if command == "cd" {
		t.lastWorkdir = "~"
	} else if strings.HasPrefix(command, "cd ") {
		t.lastWorkdir = strings.TrimSpace(strings.TrimPrefix(command, "cd "))
	}
}

func (t *ContextTracker) pushCommand(frame model.CommandFrame) {
	t.commands = append(t.commands, frame)
	if len(t.commands) > t.maxCommands {
		t.commands = append([]model.CommandFrame(nil), t.commands[len(t.commands)-t.maxCommands:]...)
	}
}

func (t *ContextTracker) addEvent(event model.SessionEventView) {
	t.events = append(t.events, event)
	if len(t.events) > t.maxEvents {
		t.events = append([]model.SessionEventView(nil), t.events[len(t.events)-t.maxEvents:]...)
	}
}

func (t *ContextTracker) touch() {
	now := time.Now().UTC()
	t.updatedAt = now
	t.lastActivityAt = now
}

func (t *ContextTracker) abbreviate(value string) string {
	if len(value) <= maxEventDataChars {
		return value
	}
	return value[:maxEventDataChars] + "...(truncated)"
}

func buildSummary(meta model.SessionMetaState, commands []model.CommandFrame) string {
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf(
		"sessionType=%s, state=%s, attachedClients=%d, lastSeq=%d, commands=%d",
		meta.SessionType,
		meta.ConnectionState,
		meta.AttachedClients,
		meta.LastSeq,
		meta.CommandCount,
	))
	if meta.LastExitCode != nil {
		builder.WriteString(fmt.Sprintf(", lastExitCode=%d", *meta.LastExitCode))
	}
	if meta.Truncated {
		builder.WriteString(", outputTruncated=true")
	}
	if len(commands) > 0 {
		latest := commands[len(commands)-1]
		builder.WriteString(fmt.Sprintf(", latestCommand=%s [%s]", latest.Command, latest.Status))
		if latest.DurationMs != nil {
			builder.WriteString(fmt.Sprintf(", latestDurationMs=%d", *latest.DurationMs))
		}
	}
	return builder.String()
}

func stringPtr(value string) *string {
	return &value
}

func intPtr(value int) *int {
	return &value
}

func int64Ptr(value int64) *int64 {
	return &value
}

func tailCopy[T any](items []T, limit int) []T {
	if len(items) <= limit {
		return append([]T(nil), items...)
	}
	return append([]T(nil), items[len(items)-limit:]...)
}
