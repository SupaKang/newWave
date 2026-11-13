// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"io"
	"time"
)

const (
	PtyReadBufSize     = 32 * 1024
	PtyCoalesceMaxWait = 5 * time.Millisecond
	PtyCoalesceMaxSize = 64 * 1024
)

// readCoalesced reads from r until it fails and passes the data to flush in order, merging chunks that arrive
// within maxWait of each other (up to maxSize). A TUI redraw comes out of the pty as many small writes; without
// merging, each one becomes its own blockfile append + websocket event + xterm write.
// Returns the read error (io.EOF on a normal end). flush is only ever called from the calling goroutine.
func readCoalesced(r io.Reader, bufSize int, maxWait time.Duration, maxSize int, flush func([]byte)) error {
	type readResult struct {
		data []byte
		err  error
	}
	readCh := make(chan readResult, 16)
	go func() {
		defer close(readCh)
		buf := make([]byte, bufSize)
		for {
			nr, err := r.Read(buf)
			var data []byte
			if nr > 0 {
				data = append(data, buf[:nr]...)
			}
			readCh <- readResult{data: data, err: err}
			if err != nil {
				return
			}
		}
	}()
	timer := time.NewTimer(maxWait)
	defer timer.Stop()
	for res := range readCh {
		pending := res.data
		err := res.err
		if err == nil {
			timer.Reset(maxWait)
		collect:
			for len(pending) < maxSize {
				select {
				case more, ok := <-readCh:
					if !ok {
						break collect
					}
					pending = append(pending, more.data...)
					if more.err != nil {
						err = more.err
						break collect
					}
				case <-timer.C:
					break collect
				}
			}
		}
		if len(pending) > 0 {
			flush(pending)
		}
		if err != nil {
			return err
		}
	}
	return io.EOF
}
