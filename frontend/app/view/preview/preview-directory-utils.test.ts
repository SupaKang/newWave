// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vitest";
import { putDotDotFirst, splitPathSegments } from "./preview-directory-utils";

test("splitPathSegments handles posix, home, and windows paths", () => {
    expect(splitPathSegments("/usr/local/bin")).toEqual([
        { label: "/", path: "/" },
        { label: "usr/", path: "/usr" },
        { label: "local/", path: "/usr/local" },
        { label: "bin", path: "/usr/local/bin" },
    ]);
    expect(splitPathSegments("/")).toEqual([{ label: "/", path: "/" }]);
    expect(splitPathSegments("~/Documents/a.txt")).toEqual([
        { label: "~/", path: "~" },
        { label: "Documents/", path: "~/Documents" },
        { label: "a.txt", path: "~/Documents/a.txt" },
    ]);
    expect(splitPathSegments("C:\\Users\\me")).toEqual([
        { label: "C:\\", path: "C:\\" },
        { label: "Users\\", path: "C:\\Users" },
        { label: "me", path: "C:\\Users\\me" },
    ]);
    expect(splitPathSegments("C:/Users")).toEqual([
        { label: "C:/", path: "C:/" },
        { label: "Users", path: "C:/Users" },
    ]);
    expect(splitPathSegments("")).toEqual([]);
});

test("putDotDotFirst moves .. to the front and keeps the rest ordered", () => {
    const name = (s: string) => s;
    expect(putDotDotFirst(["b", "..", "a"], name)).toEqual(["..", "b", "a"]);
    expect(putDotDotFirst(["b", "a"], name)).toEqual(["b", "a"]);
});
