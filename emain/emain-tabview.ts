// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { adaptFromElectronKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import { dialog, Rectangle, shell, WebContentsView } from "electron";
import { createNewWaveWindow, getWaveWindowById } from "emain/emain-window";
import path from "path";
import { configureAuthKeyRequestInjection } from "./authkey";
import { setWasActive } from "./emain-activity";
import { setupWebviewGuest } from "./emain-ipc";
import { getElectronAppBasePath, isDevVite, unamePlatform } from "./emain-platform";
import {
    decreaseZoomLevel,
    handleCtrlShiftFocus,
    handleCtrlShiftState,
    increaseZoomLevel,
    resetZoomLevel,
    shFrameNavHandler,
    shNavHandler,
} from "./emain-util";
import { ElectronWshClient } from "./emain-wsh";

function handleWindowsMenuAccelerators(
    waveEvent: WaveKeyboardEvent,
    tabView: WaveTabView,
    fullConfig: FullConfigType
): boolean {
    const waveWindow = getWaveWindowById(tabView.waveWindowId);

    if (checkKeyPressed(waveEvent, "Ctrl:Shift:n")) {
        createNewWaveWindow();
        return true;
    }

    if (checkKeyPressed(waveEvent, "Ctrl:Shift:r")) {
        tabView.webContents.reloadIgnoringCache();
        return true;
    }

    if (checkKeyPressed(waveEvent, "Ctrl:v")) {
        const ctrlVPaste = fullConfig?.settings?.["app:ctrlvpaste"];
        const shouldPaste = ctrlVPaste ?? true;
        if (!shouldPaste) {
            return false;
        }
        tabView.webContents.paste();
        return true;
    }

    if (checkKeyPressed(waveEvent, "Ctrl:0")) {
        resetZoomLevel(tabView.webContents);
        return true;
    }

    if (checkKeyPressed(waveEvent, "Ctrl:=") || checkKeyPressed(waveEvent, "Ctrl:Shift:=")) {
        increaseZoomLevel(tabView.webContents);
        return true;
    }

    if (checkKeyPressed(waveEvent, "Ctrl:-") || checkKeyPressed(waveEvent, "Ctrl:Shift:-")) {
        decreaseZoomLevel(tabView.webContents);
        return true;
    }

    if (checkKeyPressed(waveEvent, "F11")) {
        if (waveWindow) {
            waveWindow.setFullScreen(!waveWindow.isFullScreen());
        }
        return true;
    }

    for (let i = 1; i <= 9; i++) {
        if (checkKeyPressed(waveEvent, `Alt:Ctrl:${i}`)) {
            const workspaceNum = i - 1;
            RpcApi.WorkspaceListCommand(ElectronWshClient).then((workspaceList) => {
                if (workspaceList && workspaceNum < workspaceList.length) {
                    const workspace = workspaceList[workspaceNum];
                    if (waveWindow) {
                        waveWindow.switchWorkspace(workspace.workspacedata.oid);
                    }
                }
            });
            return true;
        }
    }

    if (checkKeyPressed(waveEvent, "Alt:Shift:i")) {
        tabView.webContents.toggleDevTools();
        return true;
    }

    return false;
}

function computeBgColor(fullConfig: FullConfigType): string {
    const settings = fullConfig?.settings;
    const isTransparent = settings?.["window:transparent"] ?? false;
    const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);
    if (isTransparent) {
        return "#00000000";
    } else if (isBlur) {
        return "#00000000";
    } else {
        return "#222222";
    }
}

// an error thrown in a render loop would otherwise fill the log file
const MaxFeLogLinesPerMinute = 60;
const wcIdToWaveTabMap = new Map<number, WaveTabView>();

export function getWaveTabViewByWebContentsId(webContentsId: number): WaveTabView {
    if (webContentsId == null) {
        return null;
    }
    return wcIdToWaveTabMap.get(webContentsId);
}

export class WaveTabView extends WebContentsView {
    waveWindowId: string; // this will be set for any tabviews that are initialized. (unset for the hot spare)
    isActiveTab: boolean;
    private _waveTabId: string; // always set, WaveTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
    createdTs: number; // ts milliseconds
    initPromise: Promise<void>;
    initResolve: () => void;
    savedInitOpts: WaveInitOpts;
    waveReadyPromise: Promise<void>;
    waveReadyResolve: () => void;
    isInitialized: boolean = false;
    isWaveReady: boolean = false;
    isDestroyed: boolean = false;
    keyboardChordMode: boolean = false;
    feLogWindowStart: number = 0;
    feLogCount: number = 0;
    hangDialogAbort: AbortController = null;
    resetChordModeTimeout: NodeJS.Timeout = null;

    constructor(fullConfig: FullConfigType) {
        console.log("createBareTabView");
        super({
            webPreferences: {
                preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
                webviewTag: true,
                spellcheck: false,
            },
        });
        this.createdTs = Date.now();
        this.savedInitOpts = null;
        this.initPromise = new Promise((resolve, _) => {
            this.initResolve = resolve;
        });
        this.initPromise.then(() => {
            this.isInitialized = true;
            console.log("tabview init", Date.now() - this.createdTs + "ms");
        });
        this.waveReadyPromise = new Promise((resolve, _) => {
            this.waveReadyResolve = resolve;
        });
        this.waveReadyPromise.then(() => {
            this.isWaveReady = true;
        });
        const wcId = this.webContents.id;
        wcIdToWaveTabMap.set(wcId, this);
        if (isDevVite) {
            this.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`);
        } else {
            this.webContents.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
        }
        this.webContents.on("destroyed", () => {
            wcIdToWaveTabMap.delete(wcId);
            removeWaveTabView(this.waveTabId);
            this.isDestroyed = true;
        });
        // renderer warnings/errors are otherwise lost; waveapp.log is the only thing left to read after a hang or glitch
        this.webContents.on("console-message", (e) => {
            if (e.level != "warning" && e.level != "error") {
                return;
            }
            const now = Date.now();
            if (now - this.feLogWindowStart > 60 * 1000) {
                this.feLogWindowStart = now;
                this.feLogCount = 0;
            }
            if (++this.feLogCount > MaxFeLogLinesPerMinute) {
                return;
            }
            const src = e.sourceId ? ` (${path.basename(e.sourceId)}:${e.lineNumber})` : "";
            console.log(`[fe:${this.waveTabId?.substring(0, 8) ?? "spare"}] ${e.level}: ${e.message.substring(0, 1000)}${src}`);
        });
        // a hung (not crashed) renderer never recovers on its own; shells live in wavesrv, so killing it only loses the view
        this.webContents.on("unresponsive", () => {
            if (this.waveTabId == null || this.hangDialogAbort != null) {
                return;
            }
            console.log("tab renderer unresponsive", this.waveTabId);
            const ww = getWaveWindowById(this.waveWindowId);
            if (ww == null || !this.isActiveTab) {
                this.webContents.forcefullyCrashRenderer();
                return;
            }
            this.hangDialogAbort = new AbortController();
            dialog
                .showMessageBox(ww, {
                    type: "warning",
                    buttons: ["Wait", "Reload Tab"],
                    defaultId: 1,
                    cancelId: 0,
                    title: "Tab Not Responding",
                    message: "This tab is not responding.",
                    detail: "Reloading redraws the tab. Running terminals keep running.",
                    signal: this.hangDialogAbort.signal,
                })
                .then((result) => {
                    this.hangDialogAbort = null;
                    if (result.response == 1 && !this.isDestroyed) {
                        this.webContents.forcefullyCrashRenderer();
                    }
                })
                .catch(() => {
                    this.hangDialogAbort = null;
                });
        });
        this.webContents.on("responsive", () => {
            console.log("tab renderer responsive again", this.waveTabId);
            this.hangDialogAbort?.abort();
        });
        // a crashed renderer is not "destroyed", so without this the dead view stays cached and the tab is blank until restart
        this.webContents.on("render-process-gone", (_e, details) => {
            if (details.reason == "clean-exit" || this.waveTabId == null) {
                return;
            }
            console.log("tab renderer gone", this.waveTabId, details.reason);
            const tabId = this.waveTabId;
            const ww = getWaveWindowById(this.waveWindowId);
            const wasActive = this.isActiveTab;
            if (ww == null) {
                this.destroy();
                return;
            }
            if (wasActive) {
                ww.activeTabView = null;
            }
            ww.removeTabView(tabId, true);
            if (wasActive) {
                fireAndForget(() => ww.setActiveTab(tabId, false));
            }
        });
        this.setBackgroundColor(computeBgColor(fullConfig));
    }

    get waveTabId(): string {
        return this._waveTabId;
    }

    set waveTabId(waveTabId: string) {
        this._waveTabId = waveTabId;
    }

    setKeyboardChordMode(mode: boolean) {
        this.keyboardChordMode = mode;
        if (mode) {
            if (this.resetChordModeTimeout) {
                clearTimeout(this.resetChordModeTimeout);
            }
            this.resetChordModeTimeout = setTimeout(() => {
                this.keyboardChordMode = false;
            }, CHORD_TIMEOUT);
        } else {
            if (this.resetChordModeTimeout) {
                clearTimeout(this.resetChordModeTimeout);
                this.resetChordModeTimeout = null;
            }
        }
    }

    positionTabOnScreen(winBounds: Rectangle) {
        this.setVisible(true);
        const curBounds = this.getBounds();
        if (
            curBounds.width == winBounds.width &&
            curBounds.height == winBounds.height &&
            curBounds.x == 0 &&
            curBounds.y == 0
        ) {
            return;
        }
        this.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
    }

    // hidden (not just moved off-screen) so Chromium throttles timers/rendering of background tabs and their webviews
    positionTabOffScreen(winBounds: Rectangle) {
        this.setVisible(false);
        const curBounds = this.getBounds();
        if (curBounds.x == -15000 && curBounds.width == winBounds.width && curBounds.height == winBounds.height) {
            return;
        }
        this.setBounds({
            x: -15000,
            y: -15000,
            width: winBounds.width,
            height: winBounds.height,
        });
    }

    isOnScreen() {
        const bounds = this.getBounds();
        return bounds.x == 0 && bounds.y == 0;
    }

    destroy() {
        console.log("destroy tab", this.waveTabId);
        removeWaveTabView(this.waveTabId);
        if (!this.isDestroyed) {
            this.webContents?.close();
        }
        this.isDestroyed = true;
    }
}

let MaxCacheSize = 10;
let TabIdleUnloadMs = 0;
let HotSpareEnabled = true;
const wcvCache = new Map<string, WaveTabView>();
const TabIdleCheckIntervalMs = 60 * 1000;

// re-read every check so settings changes apply without a restart
export function applyTabCacheSettings(fullConfig: FullConfigType) {
    const settings = fullConfig?.settings;
    if (settings?.["window:maxtabcachesize"] != null) {
        MaxCacheSize = settings["window:maxtabcachesize"];
    }
    TabIdleUnloadMs = (settings?.["window:tabidleunloadminutes"] ?? 0) * 60 * 1000;
    HotSpareEnabled = settings?.["window:hotsparetab"] ?? true;
    if (!HotSpareEnabled && HotSpareTab != null) {
        HotSpareTab.destroy();
        HotSpareTab = null;
    }
}

function evictIdleTabViews() {
    checkAndEvictCache();
    if (TabIdleUnloadMs <= 0) {
        return;
    }
    const now = Date.now();
    for (const tabView of Array.from(wcvCache.values())) {
        if (!tabView.isActiveTab && now - tabView.lastUsedTs > TabIdleUnloadMs) {
            tryEvictEntry(tabView.waveTabId);
        }
    }
}

export function startTabIdleEviction() {
    setInterval(() => {
        fireAndForget(async () => {
            applyTabCacheSettings(await RpcApi.GetFullConfigCommand(ElectronWshClient));
            evictIdleTabViews();
        });
    }, TabIdleCheckIntervalMs);
}

export function getWaveTabView(waveTabId: string): WaveTabView | undefined {
    const rtn = wcvCache.get(waveTabId);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

function tryEvictEntry(waveTabId: string): boolean {
    const tabView = wcvCache.get(waveTabId);
    if (!tabView) {
        return false;
    }
    if (tabView.isActiveTab) {
        return false;
    }
    const lastUsedDiff = Date.now() - tabView.lastUsedTs;
    if (lastUsedDiff < 1000) {
        return false;
    }
    const ww = getWaveWindowById(tabView.waveWindowId);
    if (!ww) {
        // this shouldn't happen, but if it does, just destroy the tabview
        console.log("[error] WaveWindow not found for WaveTabView", tabView.waveTabId);
        tabView.destroy();
        return true;
    } else {
        // will trigger a destroy on the tabview
        ww.removeTabView(tabView.waveTabId, false);
        return true;
    }
}

function checkAndEvictCache(): void {
    if (wcvCache.size <= MaxCacheSize) {
        return;
    }
    const sorted = Array.from(wcvCache.values()).sort((a, b) => {
        // Prioritize entries which are active
        if (a.isActiveTab && !b.isActiveTab) {
            return -1;
        }
        // Otherwise, sort by lastUsedTs
        return a.lastUsedTs - b.lastUsedTs;
    });
    for (let i = 0; i < sorted.length - MaxCacheSize; i++) {
        tryEvictEntry(sorted[i].waveTabId);
    }
}

export function clearTabCache() {
    const wcVals = Array.from(wcvCache.values());
    for (let i = 0; i < wcVals.length; i++) {
        const tabView = wcVals[i];
        tryEvictEntry(tabView.waveTabId);
    }
}

// returns [tabview, initialized]
export async function getOrCreateWebViewForTab(waveWindowId: string, tabId: string): Promise<[WaveTabView, boolean]> {
    let tabView = getWaveTabView(tabId);
    if (tabView) {
        return [tabView, true];
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    tabView = getSpareTab(fullConfig);
    tabView.waveWindowId = waveWindowId;
    tabView.lastUsedTs = Date.now();
    setWaveTabView(tabId, tabView);
    tabView.waveTabId = tabId;
    tabView.webContents.on("will-navigate", shNavHandler);
    tabView.webContents.on("will-frame-navigate", shFrameNavHandler);
    tabView.webContents.on("did-attach-webview", (event, wc) => {
        setupWebviewGuest(wc, tabView.webContents);
        wc.setWindowOpenHandler((details) => {
            if (wc == null || wc.isDestroyed() || tabView.webContents == null || tabView.webContents.isDestroyed()) {
                return { action: "deny" };
            }
            tabView.webContents.send("webview-new-window", wc.id, details);
            return { action: "deny" };
        });
    });
    tabView.webContents.on("before-input-event", (e, input) => {
        const waveEvent = adaptFromElectronKeyEvent(input);
        // console.log("WIN bie", tabView.waveTabId.substring(0, 8), waveEvent.type, waveEvent.code);
        handleCtrlShiftState(tabView.webContents, waveEvent);
        setWasActive(true);
        if (input.type == "keyDown" && tabView.keyboardChordMode) {
            e.preventDefault();
            tabView.setKeyboardChordMode(false);
            tabView.webContents.send("reinject-key", waveEvent);
            return;
        }

        if (unamePlatform === "win32" && input.type == "keyDown") {
            if (handleWindowsMenuAccelerators(waveEvent, tabView, fullConfig)) {
                e.preventDefault();
                return;
            }
        }
    });
    tabView.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });
    tabView.webContents.on("blur", () => {
        handleCtrlShiftFocus(tabView.webContents, false);
    });
    configureAuthKeyRequestInjection(tabView.webContents.session);
    return [tabView, false];
}

export function setWaveTabView(waveTabId: string, wcv: WaveTabView): void {
    if (waveTabId == null) {
        return;
    }
    wcvCache.set(waveTabId, wcv);
    checkAndEvictCache();
}

function removeWaveTabView(waveTabId: string): void {
    if (waveTabId == null) {
        return;
    }
    wcvCache.delete(waveTabId);
}

let HotSpareTab: WaveTabView = null;

export function ensureHotSpareTab(fullConfig: FullConfigType) {
    console.log("ensureHotSpareTab");
    if (!HotSpareEnabled) {
        return;
    }
    if (HotSpareTab == null) {
        HotSpareTab = new WaveTabView(fullConfig);
    }
}

export function getSpareTab(fullConfig: FullConfigType): WaveTabView {
    setTimeout(() => ensureHotSpareTab(fullConfig), 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return new WaveTabView(fullConfig);
    }
}
