// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CraftAppsModel } from "@/app/store/craftapps-model";
import { atoms, createBlock, getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export const FileOpenPreview = "preview";
export const FileOpenSystem = "system";
export const FileOpenCraftPrefix = "craft:";
export const FileOpenAssocKey = "fileopen:assoc";

export type FileOpenChoice = {
    handler: string;
    label: string;
    description: string;
    icon: string;
    iconUrl?: string;
    color?: string;
};

export function getFileExt(path: string): string {
    const name = path.split(/[\\/]/).pop() ?? "";
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx <= 0) {
        return "";
    }
    return name.slice(dotIdx + 1).toLowerCase();
}

export function getFileAssocMap(): { [ext: string]: string } {
    return globalStore.get(atoms.settingsAtom)?.[FileOpenAssocKey] ?? {};
}

export async function setFileAssoc(ext: string, handler: string) {
    const assoc = { ...getFileAssocMap() };
    if (handler == null) {
        delete assoc[ext];
    } else {
        assoc[ext] = handler;
    }
    await RpcApi.SetConfigCommand(TabRpcClient, { [FileOpenAssocKey]: assoc } as SettingsType);
}

export function getChoicesForExt(ext: string): FileOpenChoice[] {
    const craftModel = CraftAppsModel.getInstance();
    const icons = globalStore.get(craftModel.iconsAtom);
    const choices: FileOpenChoice[] = [
        {
            handler: FileOpenPreview,
            label: "newWave Viewer",
            description: "Open in a preview block inside newWave",
            icon: "eye",
        },
    ];
    for (const app of craftModel.appsForExt(ext)) {
        choices.push({
            handler: FileOpenCraftPrefix + app.appid,
            label: app.name,
            description: app.description,
            icon: app.icon,
            iconUrl: icons[app.appid],
            color: app.color,
        });
    }
    choices.push({
        handler: FileOpenSystem,
        label: "Windows Default App",
        description: "Open with the app Windows uses for this file type",
        icon: "window-maximize",
    });
    return choices;
}

// a saved handler can go stale (craft app uninstalled), in which case we ask again
function isHandlerAvailable(handler: string, ext: string): boolean {
    if (handler == FileOpenPreview || handler == FileOpenSystem) {
        return true;
    }
    return getChoicesForExt(ext).some((choice) => choice.handler == handler);
}

export async function openWithHandler(handler: string, paths: string[]) {
    for (const path of paths) {
        if (handler == FileOpenSystem) {
            getApi().openNativePath(path);
        } else if (handler.startsWith(FileOpenCraftPrefix)) {
            await CraftAppsModel.getInstance().launch(handler.slice(FileOpenCraftPrefix.length), path);
        } else {
            await createBlock({ meta: { view: "preview", file: path } });
        }
    }
}

function askForHandler(ext: string, paths: string[]): Promise<{ handler: string; always: boolean }> {
    return new Promise((resolve) => {
        modalsModel.pushModal("OpenWithModal", { ext, paths, onDone: resolve });
    });
}

export async function openDroppedFiles(paths: string[]) {
    await CraftAppsModel.getInstance().ensureLoaded();
    const byExt = new Map<string, string[]>();
    for (const path of paths) {
        const ext = getFileExt(path);
        byExt.set(ext, [...(byExt.get(ext) ?? []), path]);
    }
    // one question per file type, asked one after another (the modal stack keys modals by name)
    for (const [ext, extPaths] of byExt) {
        const saved = getFileAssocMap()[ext];
        if (saved != null && isHandlerAvailable(saved, ext)) {
            await openWithHandler(saved, extPaths);
            continue;
        }
        const result = await askForHandler(ext, extPaths);
        if (result?.handler == null) {
            continue;
        }
        if (result.always && ext != "") {
            await setFileAssoc(ext, result.handler);
        }
        await openWithHandler(result.handler, extPaths);
    }
}
