// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { InputSender } from "./inputsender";

function deferredSender() {
    const sent: string[] = [];
    const resolvers: (() => void)[] = [];
    const sender = new InputSender((data) => {
        sent.push(data);
        return new Promise<void>((resolve) => resolvers.push(resolve));
    });
    return { sender, sent, resolvers };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("InputSender", () => {
    it("keeps one request in flight and merges keys typed meanwhile, in order", async () => {
        const { sender, sent, resolvers } = deferredSender();
        sender.push("a");
        sender.push("b");
        sender.push("c");
        expect(sent).toEqual(["a"]);
        resolvers[0]();
        await tick();
        expect(sent).toEqual(["a", "bc"]);
    });

    it("keeps going after a send fails", async () => {
        const sent: string[] = [];
        const sender = new InputSender((data) => {
            sent.push(data);
            return Promise.reject(new Error("EC-TIME"));
        });
        sender.push("x");
        sender.push("y");
        await tick();
        expect(sent).toEqual(["x", "y"]);
    });

    it("reset releases input stuck behind a response that will never come", async () => {
        const { sender, sent, resolvers } = deferredSender();
        sender.push("a");
        sender.push("b");
        expect(sent).toEqual(["a"]);
        sender.reset();
        expect(sent).toEqual(["a", "b"]);
        resolvers[0]();
        await tick();
        sender.push("c");
        expect(sent).toEqual(["a", "b"]);
        resolvers[1]();
        await tick();
        expect(sent).toEqual(["a", "b", "c"]);
    });
});
