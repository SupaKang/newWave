// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package docconvert

import (
	"context"
	"fmt"
)

func runConvert(ctx context.Context, srcPath string, dstPath string) error {
	return fmt.Errorf("document preview requires Microsoft Office or Hancom Office on Windows")
}
