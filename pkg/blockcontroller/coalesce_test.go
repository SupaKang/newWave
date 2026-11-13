// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"io"
	"testing"
	"time"
)

func TestReadCoalescedMergesBurstsInOrder(t *testing.T) {
	pr, pw := io.Pipe()
	go func() {
		for i := 0; i < 50; i++ {
			pw.Write([]byte{byte('a' + i%26)})
		}
		time.Sleep(100 * time.Millisecond)
		pw.Write([]byte("tail"))
		pw.Close()
	}()
	var got bytes.Buffer
	flushes := 0
	err := readCoalesced(pr, 4096, 20*time.Millisecond, 1024, func(data []byte) {
		flushes++
		got.Write(data)
	})
	if err != io.EOF {
		t.Fatalf("want io.EOF, got %v", err)
	}
	var want bytes.Buffer
	for i := 0; i < 50; i++ {
		want.WriteByte(byte('a' + i%26))
	}
	want.WriteString("tail")
	if got.String() != want.String() {
		t.Fatalf("data lost or reordered:\n got %q\nwant %q", got.String(), want.String())
	}
	if flushes >= 25 {
		t.Fatalf("50 back-to-back writes should be merged, got %d flushes", flushes)
	}
	if flushes < 2 {
		t.Fatalf("data after a pause must be flushed separately, got %d flushes", flushes)
	}
}

func TestReadCoalescedRespectsMaxSize(t *testing.T) {
	r := bytes.NewReader(bytes.Repeat([]byte("x"), 10000))
	total := 0
	err := readCoalesced(r, 1000, time.Second, 3000, func(data []byte) {
		if len(data) > 3000+1000 {
			t.Fatalf("flush of %d bytes exceeds max size", len(data))
		}
		total += len(data)
	})
	if err != io.EOF || total != 10000 {
		t.Fatalf("err=%v total=%d", err, total)
	}
}
