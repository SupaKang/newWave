// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestFlattenChromeBookmarks(t *testing.T) {
	root := chromeBookmarkNode{Type: "folder", Name: "Bookmarks bar", Children: []chromeBookmarkNode{
		{Type: "url", Id: "1", Name: "Go", Url: "https://go.dev"},
		{Type: "url", Id: "2", Name: "JS", Url: "javascript:alert(1)"},
		{Type: "folder", Name: "Dev", Children: []chromeBookmarkNode{{Type: "url", Id: "3", Name: "GH", Url: "https://github.com"}}},
	}}
	out := make(waveobj.MetaMapType)
	order := 0.0
	flattenChromeBookmarks(root, "", out, &order)
	if len(out) != 2 {
		t.Fatalf("want 2 bookmarks (non-http skipped), got %d: %v", len(out), out)
	}
	gh := out["bookmark@chrome-3"].(map[string]any)
	if gh["title"] != "Bookmarks bar / Dev / GH" || gh["url"] != "https://github.com" {
		t.Fatalf("bad nested bookmark: %v", gh)
	}
}
