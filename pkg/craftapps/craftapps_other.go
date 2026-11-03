// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package craftapps

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func fillInstallInfo(info *wshrpc.CraftAppInfo) {}

func hideConsoleWindow(cmd *exec.Cmd) {}

func launchExe(exePath string, filePath string) error {
	return fmt.Errorf("craft apps are only integrated on Windows")
}

func runMsiInstall(ctx context.Context, msiPath string) error {
	return fmt.Errorf("craft apps are only integrated on Windows")
}
