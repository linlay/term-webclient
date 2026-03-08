package util

import (
	"errors"
	"net/http"
)

type StatusError struct {
	Status  int
	Message string
	Err     error
}

func (e *StatusError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return http.StatusText(e.Status)
}

func (e *StatusError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func NewStatusError(status int, message string, err error) error {
	return &StatusError{
		Status:  status,
		Message: message,
		Err:     err,
	}
}

func ErrorStatus(err error) int {
	var statusErr *StatusError
	if errors.As(err, &statusErr) && statusErr.Status > 0 {
		return statusErr.Status
	}
	return http.StatusInternalServerError
}

func ErrorMessage(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	var statusErr *StatusError
	if errors.As(err, &statusErr) && statusErr.Message != "" {
		return statusErr.Message
	}
	if err.Error() != "" {
		return err.Error()
	}
	return fallback
}
