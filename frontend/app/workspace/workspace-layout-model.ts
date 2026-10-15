// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getOrefMetaKeyAtom, getSettingsKeyAtom } from "@/store/global";
import * as jotai from "jotai";
import { debounce } from "lodash-es";
import { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";

const VTabBar_DefaultWidth = 220;
const VTabBar_MinWidth = 110;
const VTabBar_MaxWidth = 280;

function clampVTabWidth(w: number): number {
    return Math.max(VTabBar_MinWidth, Math.min(w, VTabBar_MaxWidth));
}

class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;

    vtabPanelRef: ImperativePanelHandle | null;
    panelGroupRef: ImperativePanelGroupHandle | null;
    panelContainerRef: HTMLDivElement | null;
    vtabPanelWrapperRef: HTMLDivElement | null;

    private inResize: boolean;
    private vtabWidth: number;
    private vtabVisible: boolean;
    private transitionTimeoutRef: NodeJS.Timeout | null = null;
    private debouncedPersistVTabWidth: () => void;
    widgetsSidebarVisibleAtom: jotai.Atom<boolean>;

    private constructor() {
        this.vtabPanelRef = null;
        this.panelGroupRef = null;
        this.panelContainerRef = null;
        this.vtabPanelWrapperRef = null;
        this.inResize = false;
        this.vtabWidth = VTabBar_DefaultWidth;
        this.vtabVisible = false;
        this.widgetsSidebarVisibleAtom = jotai.atom(
            (get) =>
                get(getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:widgetsvisible")) ??
                true
        );
        this.initializeFromMeta();

        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handlePanelLayout = this.handlePanelLayout.bind(this);

        this.debouncedPersistVTabWidth = debounce(() => {
            if (!this.vtabVisible) return;
            const width = this.vtabPanelWrapperRef?.offsetWidth;
            if (width == null || width <= 0) return;
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("workspace", this.getWorkspaceId()),
                    meta: { "layout:vtabbarwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist vtabbar width:", e);
            }
        }, 300);
    }

    static getInstance(): WorkspaceLayoutModel {
        if (!WorkspaceLayoutModel.instance) {
            WorkspaceLayoutModel.instance = new WorkspaceLayoutModel();
        }
        return WorkspaceLayoutModel.instance;
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:vtabbarwidth");
    }

    private initializeFromMeta(): void {
        try {
            const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
            if (savedVTabWidth != null && savedVTabWidth > 0) {
                this.vtabWidth = savedVTabWidth;
            }
            const tabBarPosition = globalStore.get(getSettingsKeyAtom("app:tabbar")) ?? "top";
            this.vtabVisible = tabBarPosition === "left" && !isBuilderWindow();
        } catch (e) {
            console.warn("Failed to initialize from workspace meta:", e);
        }
    }

    private computeLayout(windowWidth: number): number[] {
        const vtabW = this.vtabVisible ? clampVTabWidth(this.vtabWidth) : 0;
        const vtabPct = windowWidth > 0 ? (vtabW / windowWidth) * 100 : 0;
        return [vtabPct, Math.max(0, 100 - vtabPct)];
    }

    private commitLayouts(windowWidth: number): void {
        if (!this.panelGroupRef) return;
        this.inResize = true;
        this.panelGroupRef.setLayout(this.computeLayout(windowWidth));
        this.inResize = false;
    }

    handlePanelLayout(sizes: number[]): void {
        if (this.inResize) return;
        if (!this.vtabVisible) return;
        const windowWidth = window.innerWidth;
        this.vtabWidth = clampVTabWidth((sizes[0] / 100) * windowWidth);
        this.debouncedPersistVTabWidth();
        this.commitLayouts(windowWidth);
    }

    handleWindowResize(): void {
        this.commitLayouts(window.innerWidth);
    }

    syncVTabWidthFromMeta(): void {
        const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedVTabWidth != null && savedVTabWidth > 0 && savedVTabWidth !== this.vtabWidth) {
            this.vtabWidth = savedVTabWidth;
            this.commitLayouts(window.innerWidth);
        }
    }

    registerRefs(
        panelGroupRef: ImperativePanelGroupHandle,
        panelContainerRef: HTMLDivElement,
        vtabPanelRef?: ImperativePanelHandle,
        vtabPanelWrapperRef?: HTMLDivElement,
        showLeftTabBar?: boolean
    ): void {
        this.panelGroupRef = panelGroupRef;
        this.panelContainerRef = panelContainerRef;
        this.vtabPanelRef = vtabPanelRef ?? null;
        this.vtabPanelWrapperRef = vtabPanelWrapperRef ?? null;
        this.vtabVisible = showLeftTabBar ?? false;
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);
    }

    private syncPanelCollapse(): void {
        if (!this.vtabPanelRef) return;
        if (this.vtabVisible) {
            this.vtabPanelRef.expand();
        } else {
            this.vtabPanelRef.collapse();
        }
    }

    enableTransitions(duration: number): void {
        if (!this.panelContainerRef) return;
        const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
        panels.forEach((panel: HTMLElement) => {
            panel.style.transition = "flex 0.2s ease-in-out";
        });
        if (this.transitionTimeoutRef) {
            clearTimeout(this.transitionTimeoutRef);
        }
        this.transitionTimeoutRef = setTimeout(() => {
            if (!this.panelContainerRef) return;
            const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
            panels.forEach((panel: HTMLElement) => {
                panel.style.transition = "none";
            });
        }, duration);
    }

    getVTabInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        if (!showLeftTabBar || isBuilderWindow()) return 0;
        return (clampVTabWidth(this.vtabWidth) / windowWidth) * 100;
    }

    setShowLeftTabBar(showLeftTabBar: boolean): void {
        if (this.vtabVisible === showLeftTabBar) return;
        this.vtabVisible = showLeftTabBar;
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);
    }
}

export { WorkspaceLayoutModel };
