// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { atom } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getWebPreviewDisplayUrl, WebViewModel, WebViewPreviewFallback } from "./webview";

describe("webview preview fallback", () => {
    it("shows the requested URL", () => {
        const markup = renderToStaticMarkup(<WebViewPreviewFallback url="https://waveterm.dev/docs" />);

        expect(markup).toContain("electron webview unavailable");
        expect(markup).toContain("https://waveterm.dev/docs");
    });

    it("falls back to about:blank when no URL is available", () => {
        expect(getWebPreviewDisplayUrl("")).toBe("about:blank");
        expect(getWebPreviewDisplayUrl(null)).toBe("about:blank");
    });

    it("uses the supplied env for homepage atoms and config updates", async () => {
        const blockId = "webview-env-block";
        const env = makeMockWaveEnv({
            settings: {
                "web:defaulturl": "https://default.example",
            },
            mockWaveObjs: {
                [`block:${blockId}`]: {
                    otype: "block",
                    oid: blockId,
                    version: 1,
                    meta: {
                        pinnedurl: "https://block.example",
                    },
                } as Block,
            },
        });
        const model = new WebViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(true),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        expect(globalStore.get(model.homepageUrl)).toBe("https://block.example");

        await model.setHomepageUrl("https://global.example", "global");

        expect(globalStore.get(model.homepageUrl)).toBe("https://global.example");
        expect(globalStore.get(env.getSettingsKeyAtom("web:defaulturl"))).toBe("https://global.example");
        expect(globalStore.get(env.wos.getWaveObjectAtom<Block>(`block:${blockId}`))?.meta?.pinnedurl).toBeUndefined();
    });
});

describe("ensureUrlScheme", () => {
    const ensure = (url: string) => WebViewModel.prototype.ensureUrlScheme(url, "https://search.example?q={query}");

    it("keeps known schemes as-is", () => {
        expect(ensure("https://waveterm.dev/x")).toBe("https://waveterm.dev/x");
        expect(ensure("http://localhost:3000")).toBe("http://localhost:3000");
        expect(ensure("file:///tmp/a.html")).toBe("file:///tmp/a.html");
        expect(ensure("about:blank")).toBe("about:blank");
        expect(ensure("view-source:https://example.com")).toBe("view-source:https://example.com");
    });

    it("uses http for local hosts, IPs and single-label hosts with a port", () => {
        expect(ensure("localhost")).toBe("http://localhost");
        expect(ensure("localhost:3000")).toBe("http://localhost:3000");
        expect(ensure("localhost:3000/api?x=1")).toBe("http://localhost:3000/api?x=1");
        expect(ensure("host.local:3000")).toBe("http://host.local:3000");
        expect(ensure("192.168.0.10:8080/x")).toBe("http://192.168.0.10:8080/x");
        expect(ensure("[::1]:8080")).toBe("http://[::1]:8080");
        expect(ensure("devbox:5173")).toBe("http://devbox:5173");
    });

    it("uses https for domains, with or without port and path", () => {
        expect(ensure("example.com")).toBe("https://example.com");
        expect(ensure("example.com:8080/x")).toBe("https://example.com:8080/x");
        expect(ensure("sub.example.co.kr/path#frag")).toBe("https://sub.example.co.kr/path#frag");
    });

    it("sends plain words and phrases to search", () => {
        expect(ensure("wave")).toBe("https://search.example?q=wave");
        expect(ensure("wave terminal")).toBe("https://search.example?q=wave%20terminal");
        expect(ensure("what is example.com")).toBe("https://search.example?q=what%20is%20example.com");
        expect(WebViewModel.prototype.ensureUrlScheme("wave", null)).toBe("https://www.google.com/search?q=wave");
    });
});
