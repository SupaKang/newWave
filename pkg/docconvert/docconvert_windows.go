// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package docconvert

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unicode/utf16"
)

const createNoWindow = 0x08000000

// Paths are passed through env vars and the script through -EncodedCommand (UTF-16) because
// Windows PowerShell 5.1 reads BOM-less script text as ANSI and mangles non-ASCII (e.g. Korean) paths.
// PowerPoint is single-instance, so the app is only quit when no other (user-opened) documents remain.
const convertScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $src = $env:WAVE_DOC_SRC
    $dst = $env:WAVE_DOC_DST
    $ext = [IO.Path]::GetExtension($src).ToLower()
    if ($ext -match '^\.(doc|docx|docm|dot|dotx|rtf|odt)$') {
        $app = New-Object -ComObject Word.Application
        try {
            $app.DisplayAlerts = 0
            $doc = $app.Documents.Open($src, $false, $true, $false)
            $doc.ExportAsFixedFormat($dst, 17)
            $doc.Close($false)
        } finally {
            if ($app.Documents.Count -eq 0) { $app.Quit() }
        }
    } elseif ($ext -match '^\.(ppt|pptx|pptm|pps|ppsx|pot|potx|odp)$') {
        $app = New-Object -ComObject PowerPoint.Application
        try {
            $pres = $app.Presentations.Open($src, -1, 0, 0)
            $pres.SaveAs($dst, 32)
            $pres.Close()
        } finally {
            if ($app.Presentations.Count -eq 0) { $app.Quit() }
        }
    } elseif ($ext -match '^\.(xls|xlsx|xlsm|xlsb|ods)$') {
        $app = New-Object -ComObject Excel.Application
        try {
            $app.DisplayAlerts = $false
            $wb = $app.Workbooks.Open($src, 0, $true)
            $wb.ExportAsFixedFormat(0, $dst)
            $wb.Close($false)
        } finally {
            if ($app.Workbooks.Count -eq 0) { $app.Quit() }
        }
    } elseif ($ext -match '^\.(hwp|hwpx)$') {
        $app = New-Object -ComObject HWPFrame.HwpObject
        try {
            $null = $app.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
            if (-not $app.Open($src, '', 'forceopen:true;versionwarning:false')) { throw 'Hancom could not open the file' }
            if (-not $app.SaveAs($dst, 'PDF', '')) { throw 'Hancom PDF export failed' }
        } finally {
            $app.Quit()
        }
    } else {
        throw "unsupported document type: $ext"
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`

func encodePowerShellCommand(script string) string {
	u16 := utf16.Encode([]rune(script))
	buf := make([]byte, len(u16)*2)
	for i, c := range u16 {
		binary.LittleEndian.PutUint16(buf[i*2:], c)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

func runConvert(ctx context.Context, srcPath string, dstPath string) error {
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(convertScript))
	cmd.Env = append(os.Environ(), "WAVE_DOC_SRC="+srcPath, "WAVE_DOC_DST="+dstPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	output, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(output))
		if ctx.Err() != nil {
			return fmt.Errorf("document conversion timed out")
		}
		if msg == "" {
			return fmt.Errorf("document conversion failed: %w (is Microsoft Office or Hancom Office installed?)", err)
		}
		return fmt.Errorf("document conversion failed: %s", msg)
	}
	return nil
}
