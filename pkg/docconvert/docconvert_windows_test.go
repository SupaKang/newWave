// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package docconvert

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Needs Office/Hancom installed, so it only runs when pointed at a real document:
// WAVE_DOC_TEST_SRC=C:\path\to\문서.pptx go test ./pkg/docconvert/
func TestConvertToPdf(t *testing.T) {
	src := os.Getenv("WAVE_DOC_TEST_SRC")
	if src == "" {
		t.Skip("WAVE_DOC_TEST_SRC not set")
	}
	pdfPath, err := ConvertToPdf(context.Background(), src)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	data, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatalf("reading pdf: %v", err)
	}
	if !strings.HasPrefix(string(data), "%PDF") {
		t.Fatalf("output is not a pdf: %s", pdfPath)
	}
	cachedPath, err := ConvertToPdf(context.Background(), src)
	if err != nil || cachedPath != pdfPath {
		t.Fatalf("second call should hit the cache: %q %v", cachedPath, err)
	}
}
