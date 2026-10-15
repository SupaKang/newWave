// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank } from "@/util/util";
import dayjs from "dayjs";
import React from "react";
import { type PreviewModel } from "./preview-model";

export const recursiveError = "recursive flag must be set for directory operations";
export const overwriteError = "set overwrite flag to delete the existing file";
export const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export const displaySuffixes = {
    B: "b",
    kB: "k",
    MB: "m",
    GB: "g",
    TB: "t",
    KiB: "k",
    MiB: "m",
    GiB: "g",
    TiB: "t",
};

export function getBestUnit(bytes: number, si = false, sigfig = 3): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes === 0) return "0B";

    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length);
    const unit = idx === 0 ? "B" : units[idx - 1];
    const value = bytes / Math.pow(divisor, idx);

    return `${parseFloat(value.toPrecision(sigfig))}${displaySuffixes[unit] ?? unit}`;
}

function padDay(day: number) {
    return String(day).padStart(2, " ");
}

export function getLastModifiedTime(unixMillis: number): string {
    const file = dayjs(unixMillis);
    const now = dayjs();

    const day = padDay(file.date());
    const time = file.format("HH:mm");

    if (now.isSame(file, "year")) {
        return `${file.format("MMM")} ${day} ${time}`;
    }

    return `${file.format("YYYY-MM-DD")}`;
}

const iconRegex = /^[a-z0-9- ]+$/;

export function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

export function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

export function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

export function handleRename(
    model: PreviewModel,
    path: string,
    newPath: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        try {
            let srcuri = await model.formatRemoteUri(path, globalStore.get);
            if (isDir) {
                srcuri += "/";
            }
            await model.env.rpc.FileMoveCommand(TabRpcClient, {
                srcuri,
                desturi: await model.formatRemoteUri(newPath, globalStore.get),
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Rename failed: ${errorText}`);
            const errorMsg: ErrorMsg = {
                status: "Rename Failed",
                text: `${e}`,
            };
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function handleFileDelete(
    model: PreviewModel,
    path: string,
    recursive: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        const formattedPath = await model.formatRemoteUri(path, globalStore.get);
        try {
            await model.env.rpc.FileDeleteCommand(TabRpcClient, {
                path: formattedPath,
                recursive,
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Delete failed: ${errorText}`);
            let errorMsg: ErrorMsg;
            if (errorText.includes(recursiveError) && !recursive) {
                errorMsg = {
                    status: "Confirm Delete Directory",
                    text: "Deleting a directory requires the recursive flag. Proceed?",
                    level: "warning",
                    buttons: [
                        {
                            text: "Delete Recursively",
                            onClick: () => handleFileDelete(model, path, true, setErrorMsg),
                        },
                    ],
                };
            } else {
                errorMsg = {
                    status: "Delete Failed",
                    text: `${e}`,
                };
            }
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function confirmFileDelete(model: PreviewModel, finfo: FileInfo, setErrorMsg: (msg: ErrorMsg) => void) {
    if (finfo == null || finfo.name == "..") {
        return;
    }
    setErrorMsg({
        status: "Confirm Delete",
        text: finfo.isdir ? `Delete folder "${finfo.name}" and all of its contents?` : `Delete "${finfo.name}"?`,
        level: "warning",
        buttons: [
            {
                text: "Delete",
                onClick: () => handleFileDelete(model, finfo.path, finfo.isdir, setErrorMsg),
            },
        ],
    });
}

export function putDotDotFirst<T>(items: T[], getName: (item: T) => string): T[] {
    const dotdot = items.find((item) => getName(item) == "..");
    if (dotdot == null) {
        return items;
    }
    return [dotdot, ...items.filter((item) => item !== dotdot)];
}

export type PathSegment = { label: string; path: string };

// supports "/" and "\" separators (windows drives like C:\ or C:/), "~" home prefix
export function splitPathSegments(path: string): PathSegment[] {
    if (isBlank(path)) {
        return [];
    }
    const sep = path.match(/[\\/]/)?.[0] ?? "/";
    const parts = path.split(/[\\/]/);
    const segs: PathSegment[] = [];
    let cur = "";
    parts.forEach((part, idx) => {
        if (part == "") {
            if (idx == 0) {
                cur = sep;
                segs.push({ label: sep, path: sep });
            }
            return;
        }
        cur = cur == "" ? part : cur.endsWith(sep) ? cur + part : cur + sep + part;
        segs.push({ label: part, path: /^[a-zA-Z]:$/.test(cur) ? cur + sep : cur });
    });
    for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i].label != sep) {
            segs[i].label += sep;
        }
    }
    return segs;
}

export function makeDirectoryDefaultMenuItems(model: PreviewModel): ContextMenuItem[] {
    const defaultSort = globalStore.get(model.env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const showHiddenFiles = globalStore.get(model.showHiddenFiles) ?? true;
    return [
        {
            label: "Directory Sort Order",
            submenu: [
                {
                    label: "Name",
                    type: "checkbox",
                    checked: defaultSort === "name",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "name" })
                        ),
                },
                {
                    label: "Last Modified",
                    type: "checkbox",
                    checked: defaultSort === "modtime",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "modtime" })
                        ),
                },
            ],
        },
        {
            label: "Show Hidden Files",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, true);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": true })
                        );
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, false);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": false })
                        );
                    },
                },
            ],
        },
    ];
}
