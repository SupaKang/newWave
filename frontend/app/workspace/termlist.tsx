// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getApi, WOS } from "@/app/store/global";
import { BlockService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeTabRouteId } from "@/app/store/wshrouter";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { autoUpdate, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";

const StatusColor: Record<string, string> = {
    running: "bg-green-500",
    done: "bg-zinc-500",
    init: "bg-yellow-500",
};

async function focusTermBlock(tabId: string, blockId: string, currentTabId: string) {
    const route = makeTabRouteId(tabId);
    if (tabId != currentTabId) {
        getApi().setActiveTab(tabId);
        await RpcApi.WaitForRouteCommand(TabRpcClient, { routeid: route, waitms: 3000 });
    }
    await RpcApi.SetBlockFocusCommand(TabRpcClient, blockId, { route });
}

function shortenPath(path: string): string {
    if (!path) {
        return "";
    }
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) {
        return path;
    }
    return "…/" + parts.slice(-2).join("/");
}

const TermRow = memo(
    ({ blockId, tabId, currentTabId, onDone }: { blockId: string; tabId: string; currentTabId: string; onDone: () => void }) => {
        const [block] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
        const [status, setStatus] = useState<string>(null);
        const [editing, setEditing] = useState(false);
        const [title, setTitle] = useState("");
        useEffect(() => {
            BlockService.GetControllerStatus(blockId)
                .then((s) => setStatus(s?.shellprocstatus ?? null))
                .catch(() => setStatus(null));
        }, [blockId]);
        if (block?.meta?.view != "term") {
            return null;
        }
        const meta = block.meta;
        const name = meta["frame:title"] || (meta.controller == "cmd" ? meta.cmd : null) || "terminal";
        const conn = meta.connection || "local";
        const saveTitle = () => {
            setEditing(false);
            fireAndForget(() =>
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "frame:title": title.trim() || null },
                })
            );
        };
        return (
            <div
                className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-hoverbg cursor-pointer"
                onClick={() => {
                    if (editing) {
                        return;
                    }
                    onDone();
                    fireAndForget(() => focusTermBlock(tabId, blockId, currentTabId));
                }}
            >
                <span className={cn("w-2 h-2 rounded-full shrink-0", StatusColor[status] ?? "bg-zinc-700")} title={status ?? ""} />
                <div className="flex flex-col min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            className="bg-transparent border border-border rounded px-1 text-sm text-primary outline-none"
                            value={title}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setTitle(e.target.value)}
                            onBlur={saveTitle}
                            onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) {
                                    return;
                                }
                                if (e.key == "Enter") saveTitle();
                                if (e.key == "Escape") setEditing(false);
                            }}
                        />
                    ) : (
                        <span className="text-sm text-primary truncate">{name}</span>
                    )}
                    <span className="text-xxs text-secondary truncate">
                        {conn}
                        {meta["cmd:cwd"] ? ` · ${shortenPath(meta["cmd:cwd"])}` : ""}
                    </span>
                </div>
                <div className="hidden group-hover:flex items-center gap-1 text-secondary">
                    <i
                        className="fa fa-solid fa-pen text-xs p-1 hover:text-white cursor-pointer"
                        title="Rename"
                        onClick={(e) => {
                            e.stopPropagation();
                            setTitle(meta["frame:title"] ?? "");
                            setEditing(true);
                        }}
                    />
                    <i
                        className="fa fa-solid fa-xmark text-sm p-1 hover:text-error cursor-pointer"
                        title="Close terminal"
                        onClick={(e) => {
                            e.stopPropagation();
                            fireAndForget(() => RpcApi.DeleteBlockCommand(TabRpcClient, { blockid: blockId }));
                        }}
                    />
                </div>
            </div>
        );
    }
);
TermRow.displayName = "TermRow";

const TabTermGroup = memo(
    ({ tabId, currentTabId, onDone }: { tabId: string; currentTabId: string; onDone: () => void }) => {
        const [tab] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
        const blockIds = tab?.blockids ?? [];
        if (blockIds.length == 0) {
            return null;
        }
        return (
            <div className="flex flex-col">
                <div className="px-2 pt-2 pb-0.5 text-xxs uppercase tracking-wide text-muted">
                    {tab.name || "tab"}
                    {tabId == currentTabId ? " (current)" : ""}
                </div>
                {blockIds.map((blockId) => (
                    <TermRow key={blockId} blockId={blockId} tabId={tabId} currentTabId={currentTabId} onDone={onDone} />
                ))}
            </div>
        );
    }
);
TabTermGroup.displayName = "TabTermGroup";

const TermListFloatingWindow = memo(
    ({ isOpen, onClose, referenceElement }: { isOpen: boolean; onClose: () => void; referenceElement: HTMLElement }) => {
        const workspace = useAtomValue(atoms.workspace);
        const currentTabId = useAtomValue(atoms.staticTabId);
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: { reference: referenceElement },
        });
        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);
        if (!isOpen) {
            return null;
        }
        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl z-50 w-72 flex flex-col"
                >
                    <div className="px-3 py-2 border-b border-border text-sm font-semibold text-primary">Terminals</div>
                    <div className="max-h-[60vh] overflow-y-auto p-1">
                        {(workspace?.tabids ?? []).map((tabId) => (
                            <TabTermGroup key={tabId} tabId={tabId} currentTabId={currentTabId} onDone={onClose} />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="w-full px-3 py-2 border-t border-border text-xs text-secondary hover:bg-hoverbg hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
                        onClick={() => {
                            onClose();
                            fireAndForget(() => createBlock({ meta: { view: "term", controller: "shell" } }));
                        }}
                    >
                        <i className="fa fa-solid fa-plus" />
                        New Terminal
                    </button>
                </div>
            </FloatingPortal>
        );
    }
);
TermListFloatingWindow.displayName = "TermListFloatingWindow";

export { TermListFloatingWindow };
