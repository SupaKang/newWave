// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CraftAppsModel } from "@/app/store/craftapps-model";
import { FileOpenAssocKey, getChoicesForExt, setFileAssoc } from "@/app/store/fileopen";
import { atoms } from "@/app/store/global";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";

const SelectClass =
    "bg-panel border border-border rounded px-2 py-1 text-sm text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent";

function HandlerSelect({ ext, value, onChange }: { ext: string; value: string; onChange: (handler: string) => void }) {
    const choices = getChoicesForExt(ext);
    const known = choices.some((choice) => choice.handler == value);
    return (
        <select className={SelectClass} value={value} onChange={(e) => onChange(e.target.value)}>
            {!known && value ? <option value={value}>{value} (unavailable)</option> : null}
            {choices.map((choice) => (
                <option key={choice.handler} value={choice.handler}>
                    {choice.label}
                </option>
            ))}
        </select>
    );
}

// the visual editor writes each change straight to settings.json via SetConfigCommand
export const FileAssocContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    const settings = useAtomValue(atoms.settingsAtom);
    useAtomValue(CraftAppsModel.getInstance().appsAtom);
    const assoc = settings?.[FileOpenAssocKey] ?? {};
    const exts = Object.keys(assoc).sort();
    const [newExt, setNewExt] = useState("");
    const [error, setError] = useState<string>(null);

    useEffect(() => {
        fireAndForget(() => CraftAppsModel.getInstance().ensureLoaded());
    }, []);

    const save = (ext: string, handler: string) => {
        setError(null);
        setFileAssoc(ext, handler).catch((e) => setError(`${e}`));
    };
    const normalizedNewExt = newExt.trim().replace(/^\./, "").toLowerCase();
    const addRow = () => {
        if (!/^[a-z0-9_+-]+$/.test(normalizedNewExt)) {
            setError("Enter a file extension such as pptx or png");
            return;
        }
        save(normalizedNewExt, getChoicesForExt(normalizedNewExt)[0].handler);
        setNewExt("");
    };

    return (
        <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
            <div className="text-sm text-secondary">
                When you drop a file on newWave, it asks which app to open it with. Choosing <b>Always</b> saves the
                choice here. Remove an entry to be asked again.
            </div>
            {error ? <div className="text-sm text-error">{error}</div> : null}
            <div className="flex flex-col gap-1">
                {exts.length == 0 ? (
                    <div className="text-sm text-muted py-2">No saved file associations yet.</div>
                ) : (
                    exts.map((ext) => (
                        <div key={ext} className="flex items-center gap-3 py-1">
                            <div className="w-24 font-mono text-sm text-primary">.{ext}</div>
                            <HandlerSelect ext={ext} value={assoc[ext]} onChange={(handler) => save(ext, handler)} />
                            <button
                                className="px-2 py-1 text-secondary hover:text-error cursor-pointer transition-colors"
                                title="Remove (ask again next time)"
                                onClick={() => save(ext, null)}
                            >
                                <i className="fa fa-solid fa-trash" />
                            </button>
                        </div>
                    ))
                )}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border">
                <input
                    className="w-32 bg-panel border border-border rounded px-2 py-1 text-sm text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="ext (e.g. pptx)"
                    value={newExt}
                    onChange={(e) => setNewExt(e.target.value)}
                    onKeyDown={(e) => e.key == "Enter" && addRow()}
                />
                <button
                    className="px-3 py-1 rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer text-sm"
                    onClick={addRow}
                >
                    Add
                </button>
            </div>
        </div>
    );
});
FileAssocContent.displayName = "FileAssocContent";
