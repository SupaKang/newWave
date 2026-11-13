// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { OutputSequencer } from "./outputsequencer";

const enc = (s: string) => new TextEncoder().encode(s);
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeSeq(file: () => string) {
    let out = "";
    const fetches: number[] = [];
    const seq = new OutputSequencer(
        (data) => (out += new TextDecoder().decode(data)),
        async (offset) => {
            fetches.push(offset);
            const full = file();
            return { data: enc(full.substring(offset)), endOffset: full.length };
        }
    );
    return { seq, fetches, out: () => out };
}

describe("OutputSequencer", () => {
    it("writes in-order appends and drops duplicates and overlaps", () => {
        const { seq, out, fetches } = makeSeq(() => "");
        seq.append(0, enc("abc"));
        seq.append(0, enc("abc"));
        seq.append(2, enc("cde"));
        seq.append(5, enc("f"));
        expect(out()).toBe("abcdef");
        expect(fetches).toEqual([]);
    });

    it("refetches a gap and does not duplicate events that arrive meanwhile", async () => {
        let file = "abcdefgh";
        const { seq, out, fetches } = makeSeq(() => file);
        seq.append(0, enc("ab"));
        seq.append(6, enc("gh")); // "cdef" was lost
        file = "abcdefghij";
        seq.append(8, enc("ij")); // arrives during the refetch, which already returns it
        await tick();
        expect(fetches).toEqual([2]);
        expect(out()).toBe("abcdefghij");
        seq.append(10, enc("k"));
        expect(out()).toBe("abcdefghijk");
    });

    it("keeps flowing when the refetch fails", async () => {
        let out = "";
        const seq = new OutputSequencer(
            (data) => (out += new TextDecoder().decode(data)),
            () => Promise.reject(new Error("offline"))
        );
        seq.append(0, enc("ab"));
        seq.append(5, enc("fg"));
        await tick();
        seq.append(7, enc("h"));
        expect(out).toBe("abfgh");
    });
});
