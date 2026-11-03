// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { memo } from "react";

function openFolderInFiles(folder: string) {
    fireAndForget(() => createBlock({ meta: { view: "preview", file: folder } }));
}

// shows the workspace's "open folder" (set from File > Open Folder...) next to the workspace switcher
export const WorkspaceFolderChip = memo(({ workspaceId, folder }: { workspaceId: string; folder: string }) => {
    if (!folder) {
        return null;
    }
    const folderName =
        folder
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || folder;
    const onContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            { label: "Open in Files", click: () => openFolderInFiles(folder) },
            { label: "Copy Path", click: () => fireAndForget(() => navigator.clipboard.writeText(folder)) },
            { type: "separator" },
            {
                label: "Close Folder",
                click: () =>
                    fireAndForget(() =>
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: `workspace:${workspaceId}`,
                            meta: { "workspace:folder": null },
                        })
                    ),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };
    return (
        <Tooltip content={`Working folder: ${folder}`} placement="bottom" divClassName="flex items-center min-w-0">
            <div
                className="flex items-center gap-1.5 max-w-[180px] px-2 py-0.5 mx-1 rounded text-xs text-secondary hover:text-primary hover:bg-hoverbg cursor-pointer select-none"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => openFolderInFiles(folder)}
                onContextMenu={onContextMenu}
            >
                <i className="fa fa-solid fa-folder-open shrink-0" />
                <span className="truncate">{folderName}</span>
            </div>
        </Tooltip>
    );
});
WorkspaceFolderChip.displayName = "WorkspaceFolderChip";
