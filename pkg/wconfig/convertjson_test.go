// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"reflect"
	"testing"
)

func TestConvertViaJson(t *testing.T) {
	ctype := reflect.TypeOf(map[string]string{})
	got, err := convertViaJson(map[string]any{"pptx": "craft:deckcraft"}, ctype)
	if err != nil || got.(map[string]string)["pptx"] != "craft:deckcraft" {
		t.Fatalf("map conversion failed: %v %v", got, err)
	}
	if _, err := convertViaJson(map[string]any{"pptx": 5}, ctype); err == nil {
		t.Fatalf("expected type error for non-string map value")
	}
	if _, err := convertViaJson("x", reflect.TypeOf("")); err == nil {
		t.Fatalf("scalars must not be converted")
	}
}
