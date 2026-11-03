// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CenteredDiv } from "@/app/element/quickelems";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { SpecializedViewProps } from "./preview";
import type { PreviewModel } from "./preview-model";

const CheckerboardStyle: React.CSSProperties = {
    backgroundImage: "repeating-conic-gradient(#808080 0% 25%, #b0b0b0 0% 50%)",
    backgroundSize: "16px 16px",
};

function ImageZoomControls() {
    const { zoomIn, zoomOut, resetTransform } = useControls();

    return (
        <div className="absolute flex flex-row z-[2] top-0 right-0 p-[5px] gap-1">
            <Button onClick={() => zoomIn()} title="Zoom In" className="py-1 px-[5px]">
                <i className="fa-sharp fa-plus" />
            </Button>
            <Button onClick={() => zoomOut()} title="Zoom Out" className="py-1 px-[5px]">
                <i className="fa-sharp fa-minus" />
            </Button>
            <Button onClick={() => resetTransform()} title="Reset Zoom" className="py-1 px-[5px]">
                <i className="fa-sharp fa-rotate-left" />
            </Button>
        </div>
    );
}

function makeStreamingUrl(remotePath: string): string {
    const usp = new URLSearchParams();
    usp.set("path", remotePath);
    return `${getWebServerEndpoint()}/wave/stream-file?${usp.toString()}`;
}

function PdfFrame({ url }: { url: string }) {
    return (
        <div className="flex flex-row h-full overflow-hidden items-center justify-center p-[5px]">
            <iframe src={url} width="100%" height="100%" name="pdfview" />
        </div>
    );
}

function StreamingImagePreview({ url }: { url: string }) {
    return (
        <div className="flex flex-row h-full overflow-hidden items-center justify-center relative">
            <TransformWrapper initialScale={1} centerOnInit pinch={{ step: 10 }}>
                {({ zoomIn, zoomOut, resetTransform, ...rest }) => (
                    <>
                        <ImageZoomControls />
                        <TransformComponent
                            wrapperClass="!h-full !w-full"
                            contentClass="!h-full !w-full flex items-center justify-center"
                        >
                            <img
                                src={url}
                                className="z-[1] max-w-full max-h-full object-contain"
                                style={CheckerboardStyle}
                            />
                        </TransformComponent>
                    </>
                )}
            </TransformWrapper>
        </div>
    );
}

async function goSiblingImage(model: PreviewModel, fileInfo: FileInfo, delta: number) {
    const dirUri = await model.formatRemoteUri(fileInfo.dir, globalStore.get);
    const images: FileInfo[] = [];
    const stream = model.env.rpc.FileListStreamCommand(TabRpcClient, { path: dirUri }, null);
    for await (const chunk of stream) {
        images.push(...(chunk?.fileinfo ?? []).filter((f) => !f.isdir && f.mimetype?.startsWith("image/")));
    }
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const idx = images.findIndex((f) => f.path == fileInfo.path);
    const next = images[idx + delta];
    if (idx == -1 || next == null) {
        return;
    }
    await model.goHistory(next.path);
}

function StreamingPreview({ model }: SpecializedViewProps) {
    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, []);
    const conn = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const isImage = fileInfo.mimetype?.startsWith("image/");
    useEffect(() => {
        if (!isImage) {
            return;
        }
        model.imageKeyDownHandler = (e: WaveKeyboardEvent): boolean => {
            const delta = checkKeyPressed(e, "ArrowLeft") ? -1 : checkKeyPressed(e, "ArrowRight") ? 1 : 0;
            if (delta == 0) {
                return false;
            }
            fireAndForget(() => goSiblingImage(model, fileInfo, delta));
            return true;
        };
        return () => {
            model.imageKeyDownHandler = null;
        };
    }, [fileInfo, isImage]);
    const streamingUrl = makeStreamingUrl(formatRemoteUri(fileInfo.path, conn));
    if (fileInfo.mimetype === "application/pdf") {
        return <PdfFrame url={streamingUrl} />;
    }
    if (fileInfo.mimetype.startsWith("video/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <video controls src={streamingUrl} className="w-full h-full p-[10px] object-contain" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("audio/")) {
        return (
            <div className="flex flex-row h-full overflow-hidden items-center justify-center">
                <audio controls src={streamingUrl} className="w-full h-full p-[10px] object-contain" />
            </div>
        );
    }
    if (fileInfo.mimetype.startsWith("image/")) {
        return <StreamingImagePreview url={streamingUrl} />;
    }
    return <CenteredDiv>Preview Not Supported</CenteredDiv>;
}

// office/hwp files are rendered to a cached PDF by the local Office/Hancom install (see pkg/docconvert)
function OfficeDocPreview({ model }: SpecializedViewProps) {
    const fileInfo = useAtomValue(model.statFile);
    const refreshVersion = useAtomValue(model.refreshVersion);
    const [pdfPath, setPdfPath] = useState<string>(null);
    const [errorStr, setErrorStr] = useState<string>(null);
    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, []);
    useEffect(() => {
        let canceled = false;
        setPdfPath(null);
        setErrorStr(null);
        model.env.rpc
            .ConvertDocToPdfCommand(TabRpcClient, fileInfo.path, { timeout: 130000 })
            .then((path) => {
                if (!canceled) {
                    setPdfPath(path);
                }
            })
            .catch((e) => {
                if (!canceled) {
                    setErrorStr(`${e}`);
                }
            });
        return () => {
            canceled = true;
        };
    }, [fileInfo.path, refreshVersion]);
    if (errorStr != null) {
        return <CenteredDiv>{errorStr}</CenteredDiv>;
    }
    if (pdfPath == null) {
        return (
            <CenteredDiv>
                <i className="fa-sharp fa-solid fa-spinner fa-spin mr-2" />
                Converting document...
            </CenteredDiv>
        );
    }
    return <PdfFrame url={makeStreamingUrl(formatRemoteUri(pdfPath, null))} />;
}

export { OfficeDocPreview, StreamingPreview };
