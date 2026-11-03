// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { CraftAppsModel } from "@/app/store/craftapps-model";
import { FileOpenChoice, getChoicesForExt } from "@/app/store/fileopen";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";

type OpenWithModalProps = {
    ext: string;
    paths: string[];
    onDone: (result: { handler: string; always: boolean }) => void;
};

function ChoiceIcon({ choice }: { choice: FileOpenChoice }) {
    if (choice.iconUrl) {
        return <img src={choice.iconUrl} className="w-7 h-7 object-contain" />;
    }
    return (
        <div className="w-7 h-7 flex items-center justify-center text-xl" style={{ color: choice.color }}>
            <i className={makeIconClass(choice.icon, true)} />
        </div>
    );
}

const OpenWithModal = ({ ext, paths, onDone }: OpenWithModalProps) => {
    // subscribed so the choice list (and app icons) refresh if the craft app list loads while open
    useAtomValue(CraftAppsModel.getInstance().appsAtom);
    useAtomValue(CraftAppsModel.getInstance().iconsAtom);
    const choices = getChoicesForExt(ext);
    const [selected, setSelected] = useState(choices[0].handler);

    const finish = (handler: string, always: boolean) => {
        modalsModel.popModal();
        onDone({ handler, always });
    };
    const fileLabel = paths.length == 1 ? paths[0].split(/[\\/]/).pop() : `${paths.length} files`;

    return (
        <Modal className="pt-6 pb-4 px-5 w-[460px]" onClose={() => finish(null, false)}>
            <div className="flex flex-col gap-3 mx-2">
                <div>
                    <div className="font-bold text-primary">
                        How do you want to open {ext ? `.${ext} files` : "this file"}?
                    </div>
                    <div className="text-xs text-secondary mt-1 truncate">{fileLabel}</div>
                </div>
                <div className="flex flex-col gap-1 max-h-[340px] overflow-y-auto">
                    {choices.map((choice) => (
                        <div
                            key={choice.handler}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors",
                                selected == choice.handler ? "bg-accent/30" : "hover:bg-hoverbg"
                            )}
                            onClick={() => setSelected(choice.handler)}
                            onDoubleClick={() => finish(choice.handler, false)}
                        >
                            <ChoiceIcon choice={choice} />
                            <div className="flex flex-col min-w-0">
                                <div className="text-sm text-primary">{choice.label}</div>
                                <div className="text-xs text-secondary truncate">{choice.description}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                    {ext ? (
                        <Button className="grey" onClick={() => finish(selected, true)}>
                            Always
                        </Button>
                    ) : null}
                    <Button onClick={() => finish(selected, false)}>Just once</Button>
                </div>
            </div>
        </Modal>
    );
};

OpenWithModal.displayName = "OpenWithModal";

export { OpenWithModal };
