// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CraftAppsModel } from "./craftapps-model";

const { getFileIcon, listApps, decode } = vi.hoisted(() => ({
    getFileIcon: vi.fn(),
    listApps: vi.fn(),
    decode: vi.fn(),
}));

vi.mock("@/app/store/global", () => ({ getApi: () => ({ getFileIcon }) }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: {} }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { CraftAppsListCommand: listApps } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

describe("Craft app icons", () => {
    const model = CraftAppsModel.getInstance();
    const app = { appid: "filmcraft", installed: true, exepath: "C:\\FilmCraft\\filmcraft.exe" };

    beforeEach(() => {
        vi.resetAllMocks();
        globalStore.set(model.iconsAtom, {});
        listApps.mockResolvedValue([app]);
        vi.stubGlobal(
            "Image",
            class {
                src = "";
                decode() {
                    return decode(this.src);
                }
            }
        );
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("keeps the fallback for an invalid OS icon and retries on refresh", async () => {
        getFileIcon.mockResolvedValueOnce("data:,").mockResolvedValueOnce("data:image/png;base64,valid");
        decode.mockRejectedValueOnce(new Error("Invalid image")).mockResolvedValueOnce(undefined);

        await model.refresh();
        expect(globalStore.get(model.iconsAtom).filmcraft).toBeUndefined();

        await model.refresh();
        expect(globalStore.get(model.iconsAtom).filmcraft).toBe("data:image/png;base64,valid");
        expect(getFileIcon).toHaveBeenCalledTimes(2);
    });

    it("publishes an icon only after it has decoded", async () => {
        getFileIcon.mockResolvedValue("data:image/png;base64,valid");
        let finishDecode: () => void;
        decode.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishDecode = resolve;
                })
        );

        const refreshing = model.refresh();
        await vi.waitFor(() => expect(decode).toHaveBeenCalledWith("data:image/png;base64,valid"));
        expect(globalStore.get(model.iconsAtom).filmcraft).toBeUndefined();
        finishDecode();
        await refreshing;
        expect(globalStore.get(model.iconsAtom).filmcraft).toBe("data:image/png;base64,valid");
    });

    it("keeps the fallback when OS icon extraction fails", async () => {
        getFileIcon.mockRejectedValue(new Error("No icon"));
        await model.refresh();
        expect(globalStore.get(model.iconsAtom).filmcraft).toBeUndefined();
        expect(decode).not.toHaveBeenCalled();
    });
});
