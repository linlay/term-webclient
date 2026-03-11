package httpstream

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type openAIErrorEnvelope struct {
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type runnerEnvelope struct {
	Msg string `json:"msg"`
}

type stringErrorEnvelope struct {
	Error string `json:"error"`
}

func ReadSSEEvents(reader io.Reader, onEvent func(payload string) error) error {
	buffered := bufio.NewReader(reader)
	dataLines := make([]string, 0, 2)

	flush := func() error {
		if len(dataLines) == 0 {
			return nil
		}
		payload := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		return onEvent(payload)
	}

	for {
		line, err := buffered.ReadString('\n')
		if err != nil && err != io.EOF {
			return err
		}

		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if flushErr := flush(); flushErr != nil {
				return flushErr
			}
		} else if strings.HasPrefix(line, "data:") {
			payload := strings.TrimPrefix(line, "data:")
			payload = strings.TrimPrefix(payload, " ")
			dataLines = append(dataLines, payload)
		}

		if err == io.EOF {
			if flushErr := flush(); flushErr != nil {
				return flushErr
			}
			return nil
		}
	}
}

func WriteSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
}

func ProxySSEStream(w http.ResponseWriter, upstream io.Reader) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		_, err := io.Copy(w, upstream)
		return err
	}

	buffer := make([]byte, 2048)
	for {
		read, readErr := upstream.Read(buffer)
		if read > 0 {
			if _, err := w.Write(buffer[:read]); err != nil {
				return err
			}
			flusher.Flush()
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			return nil
		}
		return readErr
	}
}

func ExtractErrorMessage(statusCode int, body []byte) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return fmt.Sprintf("request failed with status %d", statusCode)
	}

	var openAIError openAIErrorEnvelope
	if err := json.Unmarshal(trimmed, &openAIError); err == nil && openAIError.Error != nil {
		message := strings.TrimSpace(openAIError.Error.Message)
		if message != "" {
			return message
		}
	}

	var runner runnerEnvelope
	if err := json.Unmarshal(trimmed, &runner); err == nil {
		message := strings.TrimSpace(runner.Msg)
		if message != "" {
			return message
		}
	}

	var stringError stringErrorEnvelope
	if err := json.Unmarshal(trimmed, &stringError); err == nil {
		message := strings.TrimSpace(stringError.Error)
		if message != "" {
			return message
		}
	}

	return string(trimmed)
}
