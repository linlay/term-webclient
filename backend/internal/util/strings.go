package util

import "strings"

func FallbackString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return strings.TrimSpace(fallback)
	}
	return strings.TrimSpace(value)
}

func NormalizeToolID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
