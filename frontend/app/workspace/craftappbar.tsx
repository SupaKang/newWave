// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { CraftAppsModel } from "@/app/store/craftapps-model";
import { getApi } from "@/app/store/global";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";

function showCraftAppMenu(app: CraftAppInfo, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const model = CraftAppsModel.getInstance();
    const menu: ContextMenuItem[] = [];
    if (app.installed) {
        menu.push({ label: `Open ${app.name}`, click: () => fireAndForget(() => model.launch(app.appid)) });
    }
    menu.push({
        label: app.installed ? "Update to Latest Version" : `Install ${app.name}`,
        click: () => fireAndForget(() => model.install(app.appid)),
    });
    if (app.clipath) {
        menu.push({
            label: "Register with Claude Code & Codex (MCP)",
            click: () => fireAndForget(() => model.registerMcp(app.appid)),
        });
        menu.push({
            label: "Copy CLI Path",
            click: () => fireAndForget(() => navigator.clipboard.writeText(app.clipath)),
        });
    }
    menu.push({ type: "separator" });
    menu.push({ label: "Open Homepage", click: () => getApi().openExternal(app.homeurl) });
    menu.push({ label: "Refresh App List", click: () => fireAndForget(() => model.refresh()) });
    ContextMenuModel.getInstance().showContextMenu(menu, e);
}

const CraftAppButton = memo(
    ({ app, iconUrl, installing }: { app: CraftAppInfo; iconUrl: string; installing: boolean }) => {
        const model = CraftAppsModel.getInstance();
        const tooltip = installing
            ? `Installing ${app.name}...`
            : app.installed
              ? `${app.name} — ${app.description}`
              : `${app.name} — click to install`;
        const onClick = () => {
            if (installing) {
                return;
            }
            if (app.installed) {
                fireAndForget(() => model.launch(app.appid));
                return;
            }
            fireAndForget(() => model.install(app.appid));
        };
        return (
            <Tooltip
                content={tooltip}
                placement="left"
                divClassName="flex justify-center items-center w-full py-1 pr-0.5 rounded-sm hover:bg-hoverbg cursor-pointer shrink-0"
                divOnClick={onClick}
            >
                <div
                    className="relative w-6 h-6 flex items-center justify-center"
                    onContextMenu={(e) => showCraftAppMenu(app, e)}
                >
                    {app.installed && iconUrl ? (
                        <img src={iconUrl} className="w-6 h-6 object-contain" draggable={false} />
                    ) : (
                        <i
                            className={cn(makeIconClass(app.icon, true), "text-lg", !app.installed && "opacity-40")}
                            style={{ color: app.color }}
                        />
                    )}
                    {installing ? (
                        <i className="fa fa-solid fa-spinner fa-spin absolute -bottom-1 -right-1 text-[10px] text-primary" />
                    ) : !app.installed ? (
                        <i className="fa fa-solid fa-circle-down absolute -bottom-1 -right-1 text-[10px] text-secondary" />
                    ) : null}
                </div>
            </Tooltip>
        );
    }
);
CraftAppButton.displayName = "CraftAppButton";

// fills the free space of the right widget bar; scrolls on its own when the window is short
const CraftAppBar = memo(() => {
    const model = CraftAppsModel.getInstance();
    const apps = useAtomValue(model.appsAtom);
    const icons = useAtomValue(model.iconsAtom);
    const installing = useAtomValue(model.installingAtom);
    useEffect(() => {
        fireAndForget(() => model.refresh());
    }, []);
    if (apps.length == 0) {
        return <div className="flex-grow" />;
    }
    return (
        <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] mt-1 pt-1 border-t border-border">
            {apps.map((app) => (
                <CraftAppButton
                    key={app.appid}
                    app={app}
                    iconUrl={icons[app.appid]}
                    installing={!!installing[app.appid]}
                />
            ))}
        </div>
    );
});
CraftAppBar.displayName = "CraftAppBar";

export { CraftAppBar };
