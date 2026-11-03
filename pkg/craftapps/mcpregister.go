// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package craftapps

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const McpRegisterTimeout = 60 * time.Second

type mcpAgent struct {
	Name       string
	Bin        string
	RemoveArgs func(appId string) []string
	AddArgs    func(appId string, cliPath string) []string
}

// Registration goes through each agent's own CLI rather than editing its config file:
// ~/.claude.json is rewritten constantly by running Claude Code sessions, and the CLIs know their own formats.
// No --root/automation roots are passed, so the agent can edit files anywhere it is asked to (same reach as its own file tools).
var mcpAgents = []mcpAgent{
	{
		Name:       "Claude Code",
		Bin:        "claude",
		RemoveArgs: func(appId string) []string { return []string{"mcp", "remove", "--scope", "user", appId} },
		AddArgs: func(appId string, cliPath string) []string {
			return []string{"mcp", "add", "--scope", "user", appId, "--", cliPath, "mcp"}
		},
	},
	{
		Name:       "Codex",
		Bin:        "codex",
		RemoveArgs: func(appId string) []string { return []string{"mcp", "remove", appId} },
		AddArgs: func(appId string, cliPath string) []string {
			return []string{"mcp", "add", appId, "--", cliPath, "mcp"}
		},
	},
}

// RegisterMcp (re)registers the app's "<app>-cli mcp" server with every agent CLI found on PATH.
// Removing first makes it idempotent and picks up a moved install path after an update.
func RegisterMcp(ctx context.Context, appId string) (string, error) {
	if _, ok := findDef(appId); !ok {
		return "", fmt.Errorf("unknown craft app: %s", appId)
	}
	info := wshrpc.CraftAppInfo{AppId: appId}
	fillInstallInfo(&info)
	if !info.Installed || info.CliPath == "" {
		return "", fmt.Errorf("%s-cli.exe was not found next to the installed app", appId)
	}
	var lines []string
	registered := 0
	for _, agent := range mcpAgents {
		binPath, err := exec.LookPath(agent.Bin)
		if err != nil {
			lines = append(lines, fmt.Sprintf("%s: not installed, skipped", agent.Name))
			continue
		}
		runAgentCli(ctx, binPath, agent.RemoveArgs(appId))
		if output, err := runAgentCli(ctx, binPath, agent.AddArgs(appId, info.CliPath)); err != nil {
			lines = append(lines, fmt.Sprintf("%s: failed (%v) %s", agent.Name, err, output))
			continue
		}
		registered++
		lines = append(lines, fmt.Sprintf("%s: registered MCP server %q", agent.Name, appId))
	}
	summary := strings.Join(lines, "\n")
	if registered == 0 {
		return summary, fmt.Errorf("no agent registration succeeded:\n%s", summary)
	}
	return summary, nil
}

func runAgentCli(ctx context.Context, binPath string, args []string) (string, error) {
	ctx, cancelFn := context.WithTimeout(ctx, McpRegisterTimeout)
	defer cancelFn()
	cmd := exec.CommandContext(ctx, binPath, args...)
	hideConsoleWindow(cmd)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}
