// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type HeldAppend = { offset: number; data: Uint8Array };

// Terminal output arrives as append events that are never retransmitted, so a dropped websocket (or the window
// while a terminal is still loading) loses bytes and corrupts the screen. Each event carries the file offset it
// starts at; this applies events strictly in offset order, drops what was already written, and on a gap
// refetches the missing range from the block file.
export class OutputSequencer {
    nextOffset = 0;
    resyncing = false;
    held: HeldAppend[] = [];
    write: (data: Uint8Array) => void;
    // returns everything from offset to the current end of file, and that end offset
    fetchFrom: (offset: number) => Promise<{ data: Uint8Array; endOffset: number }>;

    constructor(
        write: (data: Uint8Array) => void,
        fetchFrom: (offset: number) => Promise<{ data: Uint8Array; endOffset: number }>
    ) {
        this.write = write;
        this.fetchFrom = fetchFrom;
    }

    reset(offset: number) {
        this.nextOffset = offset;
        this.held = [];
    }

    append(offset: number, data: Uint8Array) {
        if (this.resyncing) {
            this.held.push({ offset, data });
            return;
        }
        const end = offset + data.length;
        if (end <= this.nextOffset) {
            return;
        }
        if (offset > this.nextOffset) {
            this.held.push({ offset, data });
            this.resync();
            return;
        }
        if (offset < this.nextOffset) {
            data = data.subarray(this.nextOffset - offset);
        }
        this.nextOffset = end;
        this.write(data);
    }

    resync() {
        if (this.resyncing) {
            return;
        }
        this.resyncing = true;
        this.fetchFrom(this.nextOffset)
            .then(({ data, endOffset }) => {
                if (data != null && data.length > 0 && endOffset > this.nextOffset) {
                    // the file is circular: if the gap is older than what it still holds, data starts later than asked
                    this.nextOffset = endOffset;
                    this.write(data);
                }
            })
            .catch((e) => console.warn("terminal output resync failed", e))
            .finally(() => {
                this.resyncing = false;
                const held = this.held;
                this.held = [];
                for (const h of held) {
                    if (h.offset > this.nextOffset) {
                        // still ahead after a failed fetch: accept the hole rather than stall the terminal
                        this.nextOffset = h.offset;
                    }
                    this.append(h.offset, h.data);
                }
            });
    }
}
