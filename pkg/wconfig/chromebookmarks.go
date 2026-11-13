// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const ChromeImportBookmarksFile = "bookmarks/chrome-import.json"

type chromeBookmarkNode struct {
	Type     string               `json:"type"`
	Name     string               `json:"name"`
	Url      string               `json:"url"`
	Id       string               `json:"id"`
	Children []chromeBookmarkNode `json:"children"`
}

func chromeBookmarksPath() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "User Data", "Default", "Bookmarks")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Bookmarks")
	default:
		return filepath.Join(home, ".config", "google-chrome", "Default", "Bookmarks")
	}
}

func flattenChromeBookmarks(node chromeBookmarkNode, folder string, out waveobj.MetaMapType, order *float64) {
	if node.Type == "url" {
		if !strings.HasPrefix(node.Url, "http://") && !strings.HasPrefix(node.Url, "https://") {
			return
		}
		title := node.Name
		if folder != "" {
			title = folder + " / " + node.Name
		}
		*order++
		out["bookmark@chrome-"+node.Id] = map[string]any{"url": node.Url, "title": title, "display:order": *order}
		return
	}
	sub := folder
	if node.Type == "folder" && node.Name != "" && folder != "" {
		sub = folder + " / " + node.Name
	} else if node.Type == "folder" && node.Name != "" {
		sub = node.Name
	}
	for _, child := range node.Children {
		flattenChromeBookmarks(child, sub, out, order)
	}
}

// ImportChromeBookmarks copies the default Chrome profile's bookmarks into a separate config file
// (re-importing overwrites only that file, the user's own bookmarks.json is never touched).
func ImportChromeBookmarks() (int, error) {
	barr, err := os.ReadFile(chromeBookmarksPath())
	if err != nil {
		return 0, fmt.Errorf("cannot read Chrome bookmarks (is Chrome installed?): %w", err)
	}
	var data struct {
		Roots map[string]chromeBookmarkNode `json:"roots"`
	}
	if err := json.Unmarshal(barr, &data); err != nil {
		return 0, fmt.Errorf("cannot parse Chrome bookmarks: %w", err)
	}
	out := make(waveobj.MetaMapType)
	order := 1000.0
	for _, root := range []string{"bookmark_bar", "other", "synced"} {
		if node, ok := data.Roots[root]; ok {
			flattenChromeBookmarks(node, "", out, &order)
		}
	}
	if err := os.MkdirAll(filepath.Join(wavebase.GetWaveConfigDir(), "bookmarks"), 0755); err != nil {
		return 0, err
	}
	if err := WriteWaveHomeConfigFile(ChromeImportBookmarksFile, out); err != nil {
		return 0, err
	}
	return len(out), nil
}
