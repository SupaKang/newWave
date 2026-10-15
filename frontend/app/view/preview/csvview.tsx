// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTableNav } from "@table-nav/react";
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import "./csvview.scss";

const MAX_DATA_SIZE = 10 * 1024 * 1024; // 10MB in bytes

type CSVRow = {
    [key: string]: string | number;
};

interface CSVViewProps {
    parentRef: React.RefObject<HTMLDivElement>;
    content: string;
    filename: string;
    readonly: boolean;
}

interface State {
    content: string | null;
    showReadonly: boolean;
    tbodyHeight: number;
}

const columnHelper = createColumnHelper<any>();

// TODO remove parentRef dependency -- use own height
const CSVView = ({ parentRef, filename, content }: CSVViewProps) => {
    const headerRef = useRef<HTMLTableRowElement | null>(null);
    const probeRef = useRef<HTMLTableRowElement | null>(null);
    const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
    const filterRef = useRef<HTMLInputElement | null>(null);
    const [filter, setFilter] = useState("");
    const [rowHeight, setRowHeight] = useState(24);
    const [tableLoaded, setTableLoaded] = useState(false);

    const [state, setState] = useState<State>({
        content,
        showReadonly: true,
        tbodyHeight: 0,
    });

    const { listeners } = useTableNav();
    const domRect = useDimensionsWithExistingRef(parentRef, 30);
    const parentHeight = domRect?.height ?? 0;

    // Parse the CSV data
    const parsedData = useMemo<CSVRow[]>(() => {
        if (!state.content) return [];

        // Trim the content and then check for headers based on the first row's content.
        const trimmedContent = state.content.trim();
        const firstRow = trimmedContent.split("\n")[0];

        // This checks if the first row starts with a letter or a quote
        const hasHeaders = !!firstRow.match(/^[a-zA-Z"]/);

        const results = Papa.parse(trimmedContent, { header: hasHeaders });

        // Check for non-header CSVs
        if (!hasHeaders && Array.isArray(results.data) && Array.isArray(results.data[0])) {
            const dataArray = results.data as string[][]; // Asserting the type
            const headers = Array.from({ length: dataArray[0].length }, (_, i) => `Column ${i + 1}`);
            results.data = dataArray.map((row) => {
                const newRow: CSVRow = {};
                row.forEach((value, index) => {
                    newRow[headers[index]] = value;
                });
                return newRow;
            });
        }

        return results.data.map((row) => {
            return Object.fromEntries(
                Object.entries(row as CSVRow).map(([key, value]) => {
                    if (typeof value === "string") {
                        const numberValue = parseFloat(value);
                        if (!isNaN(numberValue) && String(numberValue) === value) {
                            return [key, numberValue];
                        }
                    }
                    return [key, value];
                })
            ) as CSVRow;
        });
    }, [state.content]);

    const filteredData = useMemo(() => {
        const query = filter.trim().toLowerCase();
        if (query == "") {
            return parsedData;
        }
        return parsedData.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(query)));
    }, [parsedData, filter]);

    // Column Definitions
    const columns = useMemo(() => {
        if (parsedData.length === 0) {
            return [];
        }
        const headers = Object.keys(parsedData[0]);
        return headers.map((header) =>
            columnHelper.accessor(header, {
                header: () => header,
                cell: (info) => info.renderValue(),
            })
        );
    }, [parsedData]);

    useEffect(() => {
        if (probeRef.current && headerRef.current && parsedData.length && parentRef.current) {
            const probeHeight = probeRef.current.offsetHeight;
            setRowHeight(probeHeight);
            const fullTBodyHeight = probeHeight * filteredData.length;
            const headerHeight = headerRef.current.offsetHeight + (filterRef.current?.offsetHeight ?? 0);
            const maxHeightLessHeader = parentHeight - headerHeight;
            const tbodyHeight = Math.max(0, Math.min(maxHeightLessHeader, fullTBodyHeight) - 3); // 3 for the borders

            setState((prevState) => ({ ...prevState, tbodyHeight }));
            setTableLoaded(true);
        }
    }, [parentHeight, parsedData, filteredData]);

    const table = useReactTable({
        manualPagination: true,
        data: filteredData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const rows = table.getRowModel().rows;
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tbodyRef.current,
        estimateSize: () => rowHeight,
        overscan: 10,
    });
    useEffect(() => {
        virtualizer.measure();
    }, [rowHeight]);
    const virtualRows = virtualizer.getVirtualItems();
    const padTop = virtualRows[0]?.start ?? 0;
    const padBottom = virtualRows.length > 0 ? virtualizer.getTotalSize() - virtualRows.at(-1).end : 0;
    return (
        <div
            className={clsx("csv-view ellipsis", { show: tableLoaded || parsedData.length == 0 })}
            style={{ height: "auto" }}
        >
            <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter"
                className="block w-full px-2 py-1 text-xs bg-transparent border border-border rounded outline-none focus:border-accent"
            />
            <table className="probe">
                <tbody>
                    <tr ref={probeRef}>
                        <td>dummy data</td>
                    </tr>
                </tbody>
            </table>
            <table {...listeners}>
                <thead>
                    {table.getHeaderGroups().map((headerGroup, index) => (
                        <tr key={headerGroup.id} ref={headerRef} id={headerGroup.id} tabIndex={index}>
                            {headerGroup.headers.map((header, index) => (
                                <th
                                    key={header.id}
                                    colSpan={header.colSpan}
                                    id={header.id}
                                    tabIndex={index}
                                    style={{ width: header.getSize() }}
                                >
                                    {header.isPlaceholder ? null : (
                                        <div
                                            {...{
                                                className: header.column.getCanSort()
                                                    ? "inner cursor-pointer select-none ellipsis"
                                                    : "",
                                                onClick: header.column.getToggleSortingHandler(),
                                            }}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {header.column.getIsSorted() === "asc" ? (
                                                <i className="sort-icon fa-sharp fa-solid fa-sort-up"></i>
                                            ) : header.column.getIsSorted() === "desc" ? (
                                                <i className="sort-icon fa-sharp fa-solid fa-sort-down"></i>
                                            ) : null}
                                        </div>
                                    )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody
                    style={{ height: `${state.tbodyHeight}px`, paddingTop: padTop, paddingBottom: padBottom }}
                    ref={tbodyRef}
                >
                    {virtualRows.map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        return (
                            <tr key={row.id} id={row.id} tabIndex={virtualRow.index}>
                                {row.getVisibleCells().map((cell) => (
                                    <td className="ellipsis" key={cell.id} id={cell.id} tabIndex={virtualRow.index}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export { CSVView };
