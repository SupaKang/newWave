// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, PrimitiveAtom } from "jotai";

const InstallTimeoutMs = 15 * 60 * 1000;

export class CraftAppsModel {
    private static instance: CraftAppsModel | null = null;

    appsAtom = atom<CraftAppInfo[]>([]) as PrimitiveAtom<CraftAppInfo[]>;
    iconsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;
    installingAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;
    errorAtom = atom(null) as PrimitiveAtom<string>;
    loaded = false;

    private constructor() {}

    static getInstance(): CraftAppsModel {
        if (!CraftAppsModel.instance) {
            CraftAppsModel.instance = new CraftAppsModel();
        }
        return CraftAppsModel.instance;
    }

    async ensureLoaded(): Promise<CraftAppInfo[]> {
        if (!this.loaded) {
            await this.refresh();
        }
        return globalStore.get(this.appsAtom);
    }

    async refresh() {
        const apps = await RpcApi.CraftAppsListCommand(TabRpcClient);
        this.loaded = true;
        globalStore.set(this.appsAtom, apps ?? []);
        const icons = { ...globalStore.get(this.iconsAtom) };
        for (const app of apps ?? []) {
            if (!app.installed || icons[app.appid]) {
                continue;
            }
            try {
                const iconUrl = await getApi().getFileIcon(app.exepath);
                const image = new Image();
                image.src = iconUrl;
                await image.decode();
                icons[app.appid] = iconUrl;
            } catch (e) {
                console.error("error loading icon for", app.appid, e);
            }
        }
        globalStore.set(this.iconsAtom, icons);
    }

    getApp(appId: string): CraftAppInfo {
        return globalStore.get(this.appsAtom).find((app) => app.appid == appId);
    }

    appsForExt(ext: string): CraftAppInfo[] {
        return globalStore.get(this.appsAtom).filter((app) => app.installed && app.exts?.includes(ext));
    }

    async install(appId: string) {
        if (globalStore.get(this.installingAtom)[appId]) {
            return;
        }
        globalStore.set(this.installingAtom, (prev) => ({ ...prev, [appId]: true }));
        globalStore.set(this.errorAtom, null);
        try {
            const summary = await RpcApi.CraftAppInstallCommand(TabRpcClient, appId, { timeout: InstallTimeoutMs });
            await this.refresh();
            this.showMessage(summary);
        } catch (e) {
            const msg = `Could not install ${this.getApp(appId)?.name ?? appId}: ${e}`;
            globalStore.set(this.errorAtom, msg);
            this.showMessage(msg);
        } finally {
            globalStore.set(this.installingAtom, (prev) => ({ ...prev, [appId]: false }));
        }
    }

    async registerMcp(appId: string) {
        try {
            this.showMessage(await RpcApi.CraftAppRegisterMcpCommand(TabRpcClient, appId, { timeout: 150000 }));
        } catch (e) {
            this.showMessage(`${e}`);
        }
    }

    showMessage(text: string) {
        modalsModel.pushModal("MessageModal", { children: text });
    }

    async launch(appId: string, path?: string) {
        await RpcApi.CraftAppLaunchCommand(TabRpcClient, { appid: appId, path });
    }
}
