package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func loadCLIClients(cfg *Config, envBaseDir string, placeholderValues map[string]string) error {
	dirPath := resolveRuntimeConfigPath(cliClientsConfigDirPath, envBaseDir)
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg.Terminal.CliClients = []CLIClientConfig{}
			return nil
		}
		return fmt.Errorf("read %s: %w", dirPath, err)
	}

	clients := make([]CLIClientConfig, 0, len(entries))
	seenIDs := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".example.yml") {
			continue
		}

		filePath := filepath.Join(dirPath, name)
		client, ok, err := loadCLIClientFromFile(filePath, placeholderValues)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if previousPath, exists := seenIDs[client.ID]; exists {
			return fmt.Errorf("cli client id %q is duplicated in %s and %s", client.ID, previousPath, filePath)
		}
		seenIDs[client.ID] = filePath
		clients = append(clients, client)
	}

	cfg.Terminal.CliClients = clients
	return nil
}

func loadCLIClientFromFile(filePath string, placeholderValues map[string]string) (CLIClientConfig, bool, error) {
	payload, ok, err := readConfigFile(filePath, false)
	if err != nil {
		return CLIClientConfig{}, false, err
	}
	if !ok || len(strings.TrimSpace(string(payload))) == 0 {
		return CLIClientConfig{}, false, nil
	}
	if err := validateCLIClientFileShape(payload, filePath); err != nil {
		return CLIClientConfig{}, false, err
	}
	payload = []byte(expandEnvPlaceholders(string(payload), placeholderValues))

	var client CLIClientConfig
	if err := yaml.Unmarshal(payload, &client); err != nil {
		return CLIClientConfig{}, false, fmt.Errorf("parse %s: %w", filePath, err)
	}
	client.ID = strings.TrimSpace(client.ID)
	client.Label = strings.TrimSpace(client.Label)
	client.Command = strings.TrimSpace(client.Command)
	client.Workdir = strings.TrimSpace(client.Workdir)
	client.Shell = strings.TrimSpace(client.Shell)

	if client.ID == "" {
		return CLIClientConfig{}, false, fmt.Errorf("cli client id is required in %s", filePath)
	}
	if client.Command == "" {
		return CLIClientConfig{}, false, fmt.Errorf("cli client command is required in %s", filePath)
	}
	return client, true, nil
}

func validateCLIClientFileShape(payload []byte, source string) error {
	var raw map[string]any
	if err := yaml.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	if len(raw) == 0 {
		return nil
	}
	if _, ok := raw["terminal"]; ok {
		return fmt.Errorf("%s must not contain top-level terminal; define the CLI client fields directly", source)
	}
	return nil
}
