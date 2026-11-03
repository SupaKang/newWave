// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package docconvert renders office documents (Word, PowerPoint, Excel, Hancom) to PDF
// so the preview view can show them with Chromium's built-in PDF viewer.
package docconvert

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const ConvertTimeout = 2 * time.Minute

// ponytail: one global lock serializes all conversions (PowerPoint is single-instance anyway); cache is never pruned, add an LRU sweep if the docpdf dir grows too large
var convertLock sync.Mutex

// ConvertToPdf returns the path of a cached PDF rendering of srcPath, converting it first if needed.
// The cache key includes size and mtime so edits to the source produce a fresh PDF.
func ConvertToPdf(ctx context.Context, srcPath string) (string, error) {
	srcPath, err := wavebase.ExpandHomeDir(srcPath)
	if err != nil {
		return "", err
	}
	srcPath = filepath.Clean(srcPath)
	finfo, err := os.Stat(srcPath)
	if err != nil {
		return "", err
	}
	if finfo.IsDir() {
		return "", fmt.Errorf("cannot convert a directory: %s", srcPath)
	}
	key := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d", srcPath, finfo.Size(), finfo.ModTime().UnixNano())))
	cacheDir := filepath.Join(wavebase.GetWaveCachesDir(), "docpdf")
	if err := os.MkdirAll(cacheDir, 0700); err != nil {
		return "", fmt.Errorf("error creating pdf cache dir: %w", err)
	}
	pdfPath := filepath.Join(cacheDir, hex.EncodeToString(key[:16])+".pdf")
	if err := convertIfMissing(ctx, srcPath, pdfPath); err != nil {
		return "", err
	}
	return pdfPath, nil
}

func convertIfMissing(ctx context.Context, srcPath string, pdfPath string) error {
	convertLock.Lock()
	defer convertLock.Unlock()
	if _, err := os.Stat(pdfPath); err == nil {
		return nil
	}
	// Office insists on a .pdf extension, and converting to a temp name keeps half-written files out of the cache
	tmpPath := pdfPath + ".tmp.pdf"
	os.Remove(tmpPath)
	ctx, cancelFn := context.WithTimeout(ctx, ConvertTimeout)
	defer cancelFn()
	if err := runConvert(ctx, srcPath, tmpPath); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if _, err := os.Stat(tmpPath); err != nil {
		return fmt.Errorf("document conversion produced no output")
	}
	return os.Rename(tmpPath, pdfPath)
}
