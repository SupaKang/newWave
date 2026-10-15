// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockComponentModel, getConnStatusAtom, globalStore, WOS } from "@/app/store/global";
import type { TermViewModel } from "@/app/view/term/term-model";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { RpcResponseHelper, WshClient } from "./wshclient";
import { RpcApi } from "./wshclientapi";

export class TabClient extends WshClient {
    constructor(routeId: string) {
        super(routeId);
    }

    async handle_setblockfocus(rh: RpcResponseHelper, blockId: string): Promise<void> {
        const layoutModel = getLayoutModelForStaticTab();
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const node = layoutModel.getNodeByBlockId(blockId);
        if (!node) {
            throw new Error(`Block not found in tab: ${blockId}`);
        }

        layoutModel.focusNode(node.id);
    }

    async handle_getfocusedblockdata(rh: RpcResponseHelper): Promise<FocusedBlockData> {
        const layoutModel = getLayoutModelForStaticTab();
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = focusedNode?.data?.blockId;

        if (!blockId) {
            return null;
        }

        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);

        if (!blockData) {
            return null;
        }

        const viewType = blockData.meta?.view ?? "";
        const controller = blockData.meta?.controller ?? "";
        const connName = blockData.meta?.connection ?? "";

        const result: FocusedBlockData = {
            blockid: blockId,
            viewtype: viewType,
            controller: controller,
            connname: connName,
            blockmeta: blockData.meta ?? {},
        };

        if (viewType === "term" && controller === "shell") {
            const jobStatus = await RpcApi.BlockJobStatusCommand(this, blockId);
            if (jobStatus) {
                result.termjobstatus = jobStatus;
            }
        }

        if (connName) {
            const connStatusAtom = getConnStatusAtom(connName);
            const connStatus = globalStore.get(connStatusAtom);
            if (connStatus) {
                result.connstatus = connStatus;
            }
        }

        if (viewType === "term") {
            try {
                const bcm = getBlockComponentModel(blockId);
                if (bcm?.viewModel) {
                    const termViewModel = bcm.viewModel as TermViewModel;
                    if (termViewModel.termRef?.current?.shellIntegrationStatusAtom) {
                        const shellIntegrationStatus = globalStore.get(termViewModel.termRef.current.shellIntegrationStatusAtom);
                        result.termshellintegrationstatus = shellIntegrationStatus || "";
                    }
                    if (termViewModel.termRef?.current?.lastCommandAtom) {
                        const lastCommand = globalStore.get(termViewModel.termRef.current.lastCommandAtom);
                        result.termlastcommand = lastCommand || "";
                    }
                }
            } catch (e) {
                console.log("error getting term-specific data", e);
            }
        }

        return result;
    }
}
