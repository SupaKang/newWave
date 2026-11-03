// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package craftapps

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"golang.org/x/sys/windows/registry"
)

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000
)

// claude/codex are npm .cmd shims, which would flash a console window when started from the GUI
func hideConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// The MSIs are per-machine and register an App Paths entry plus the extensions they handle
// under HKLM\Software\Classes\Applications\<app>.exe\SupportedTypes, so the registry is the source of truth.
func fillInstallInfo(info *wshrpc.CraftAppInfo) {
	exeName := info.AppId + ".exe"
	exePath, err := readRegString(`SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\`+exeName, "")
	if err != nil || exePath == "" {
		return
	}
	exePath = strings.Trim(exePath, `"`)
	if _, err := os.Stat(exePath); err != nil {
		return
	}
	info.Installed = true
	info.ExePath = exePath
	cliPath := filepath.Join(filepath.Dir(exePath), info.AppId+"-cli.exe")
	if _, err := os.Stat(cliPath); err == nil {
		info.CliPath = cliPath
	}
	info.Exts = readSupportedTypes(`Software\Classes\Applications\` + exeName + `\SupportedTypes`)
}

func readRegString(keyPath string, valueName string) (string, error) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, keyPath, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer key.Close()
	val, _, err := key.GetStringValue(valueName)
	return val, err
}

func readSupportedTypes(keyPath string) []string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, keyPath, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer key.Close()
	names, err := key.ReadValueNames(-1)
	if err != nil {
		return nil
	}
	var exts []string
	for _, name := range names {
		ext := strings.ToLower(strings.TrimPrefix(name, "."))
		if ext != "" {
			exts = append(exts, ext)
		}
	}
	sort.Strings(exts)
	return exts
}

func launchExe(exePath string, filePath string) error {
	var cmd *exec.Cmd
	if filePath != "" {
		cmd = exec.Command(exePath, filePath)
	} else {
		cmd = exec.Command(exePath)
	}
	cmd.Dir = filepath.Dir(exePath)
	// detached so the app outlives (and doesn't share a console with) wavesrv
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("error launching %s: %w", filepath.Base(exePath), err)
	}
	return cmd.Process.Release()
}

// msiexec raises its own UAC prompt for these per-machine packages; /passive shows progress without questions
func runMsiInstall(ctx context.Context, msiPath string) error {
	cmd := exec.CommandContext(ctx, "msiexec.exe", "/i", msiPath, "/passive", "/norestart", "ALLUSERS=1")
	err := cmd.Run()
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return fmt.Errorf("error running msiexec: %w", err)
	}
	switch exitErr.ExitCode() {
	case 3010:
		return nil
	case 1602:
		return fmt.Errorf("installation was canceled")
	case 1618:
		return fmt.Errorf("another installation is already in progress")
	case 1925, 1730:
		return fmt.Errorf("administrator rights are required to install")
	default:
		return fmt.Errorf("msiexec failed with exit code %d", exitErr.ExitCode())
	}
}
