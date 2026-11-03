// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getKeypressInput } from "./termutil";

function keyEvent(type: string, charCode: number, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return { type, charCode, ctrlKey: false, altKey: false, metaKey: false, ...mods } as KeyboardEvent;
}

describe("getKeypressInput", () => {
    it("returns space and enter from a keypress", () => {
        expect(getKeypressInput(keyEvent("keypress", 32))).toBe(" ");
        expect(getKeypressInput(keyEvent("keypress", 13))).toBe("\r");
    });

    it("ignores other events and modified keys", () => {
        expect(getKeypressInput(keyEvent("keydown", 13))).toBeNull();
        expect(getKeypressInput(keyEvent("keypress", 0))).toBeNull();
        expect(getKeypressInput(keyEvent("keypress", 13, { ctrlKey: true }))).toBeNull();
    });
});
