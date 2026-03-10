package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const copilotAgentsConfigRelativePath = "configs/agents.yml"

type copilotAgentsFile struct {
	Agents []copilotRunnerAgentFileConfig `yaml:"agents"`
}

type copilotRunnerAgentFileConfig struct {
	Key         string                 `yaml:"key"`
	Label       string                 `yaml:"label"`
	Description string                 `yaml:"description"`
	Default     bool                   `yaml:"default"`
	Icon        CopilotAgentIconConfig `yaml:"icon"`
}

func defaultBuiltinCopilotAgent() CopilotAgentConfig {
	return CopilotAgentConfig{
		Key:         "default-assist",
		Label:       "Default Assist",
		Description: "Built-in terminal suggestions powered by assist.",
		Type:        "builtin_assist",
		Default:     true,
		Icon: CopilotAgentIconConfig{
			Name:  "sparkles",
			Color: "#2563EB",
		},
	}
}

func loadCopilotAgents(cfg *Config, envBaseDir string, placeholderValues map[string]string) error {
	runnerAgents, err := loadRunnerAgentsFromFile(resolveRuntimeConfigPath(copilotAgentsConfigRelativePath, envBaseDir), placeholderValues)
	if err != nil {
		return err
	}

	builtin := defaultBuiltinCopilotAgent()
	for _, agent := range runnerAgents {
		if agent.Default {
			builtin.Default = false
			break
		}
	}

	cfg.Copilot.Agents = make([]CopilotAgentConfig, 0, 1+len(runnerAgents))
	cfg.Copilot.Agents = append(cfg.Copilot.Agents, builtin)
	cfg.Copilot.Agents = append(cfg.Copilot.Agents, runnerAgents...)
	return nil
}

func loadRunnerAgentsFromFile(filePath string, placeholderValues map[string]string) ([]CopilotAgentConfig, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat %s: %w", filePath, err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("copilot agents config path is a directory: %s", filePath)
	}

	payload, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", filePath, err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return []CopilotAgentConfig{}, nil
	}

	payload = []byte(expandEnvPlaceholders(string(payload), placeholderValues))
	if err := validateCopilotAgentsFileShape(payload, filePath); err != nil {
		return nil, err
	}

	var document copilotAgentsFile
	if err := yaml.Unmarshal(payload, &document); err != nil {
		return nil, fmt.Errorf("parse %s: %w", filePath, err)
	}

	seenKeys := map[string]struct{}{}
	defaultCount := 0
	agents := make([]CopilotAgentConfig, 0, len(document.Agents))
	for index := range document.Agents {
		item := &document.Agents[index]
		item.Key = strings.TrimSpace(item.Key)
		item.Label = strings.TrimSpace(item.Label)
		item.Description = strings.TrimSpace(item.Description)
		item.Icon.Name = strings.TrimSpace(item.Icon.Name)
		item.Icon.Color = strings.TrimSpace(item.Icon.Color)

		if item.Key == "" {
			return nil, fmt.Errorf("copilot runner agent key is required in %s", filePath)
		}
		if item.Label == "" {
			return nil, fmt.Errorf("copilot runner agent %s requires label in %s", item.Key, filePath)
		}
		if _, ok := seenKeys[item.Key]; ok {
			return nil, fmt.Errorf("copilot runner agent key must be unique: %s", item.Key)
		}
		seenKeys[item.Key] = struct{}{}
		if item.Default {
			defaultCount++
			if defaultCount > 1 {
				return nil, fmt.Errorf("copilot runner agents require at most one default agent")
			}
		}

		agents = append(agents, CopilotAgentConfig{
			Key:         item.Key,
			Label:       item.Label,
			Description: item.Description,
			Type:        "runner_agent",
			Default:     item.Default,
			Icon:        item.Icon,
		})
	}

	return agents, nil
}

func validateCopilotAgentsFileShape(payload []byte, source string) error {
	var raw map[string]any
	if err := yaml.Unmarshal(payload, &raw); err != nil {
		return fmt.Errorf("parse %s: %w", source, err)
	}
	if len(raw) == 0 {
		return nil
	}
	if _, ok := raw["agents"]; !ok {
		return fmt.Errorf("%s must contain top-level agents", source)
	}
	return nil
}

func rejectLegacyCopilotAgentsConfig(payload []byte, source string) error {
	var raw map[string]any
	if err := yaml.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	copilotValue, ok := raw["copilot"]
	if !ok {
		return nil
	}
	copilotMap, ok := copilotValue.(map[string]any)
	if !ok {
		return nil
	}
	if _, ok := copilotMap["agents"]; ok {
		return fmt.Errorf("%s uses removed copilot.agents; move runner agents to %s", source, copilotAgentsConfigRelativePath)
	}
	return nil
}

func resolveRuntimeConfigPath(relativePath, envBaseDir string) string {
	baseDir := strings.TrimSpace(envBaseDir)
	if baseDir == "" {
		cwd, _ := os.Getwd()
		baseDir = cwd
	}
	return filepath.Clean(filepath.Join(baseDir, relativePath))
}
