import { describe, expect, it } from "vitest";
import {
    normalizeTreeJson,
    type NormalizedTreeNode,
} from "../src/core/tree-utils.js";

type TreeData = Record<string, unknown>;

function isTreeData(value: unknown): value is TreeData {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("tree utils", () => {
    it("normalizes nested tree nodes from loro tree json", () => {
        const normalized = normalizeTreeJson(
            [
                {
                    id: "root",
                    meta: { title: "Root" },
                    children: [
                        {
                            id: "child",
                            meta: { title: "Child" },
                        },
                    ],
                },
            ],
            {
                isTreeData,
                createEmptyData: () => ({}),
            },
        );

        expect(normalized).toEqual<NormalizedTreeNode<TreeData>[]>([
            {
                id: "root",
                data: { title: "Root" },
                children: [
                    {
                        id: "child",
                        data: { title: "Child" },
                        children: [],
                    },
                ],
            },
        ]);
    });

    it("falls back to empty values for malformed tree nodes", () => {
        const normalized = normalizeTreeJson(
            [
                {
                    id: 123,
                    meta: [],
                    children: [
                        null,
                        {
                            id: "valid-child",
                            meta: "nope",
                            children: "bad",
                        },
                    ],
                },
            ],
            {
                isTreeData,
                createEmptyData: () => ({}),
            },
        );

        expect(normalized).toEqual<NormalizedTreeNode<TreeData>[]>([
            {
                id: "",
                data: {},
                children: [
                    {
                        id: "",
                        data: {},
                        children: [],
                    },
                    {
                        id: "valid-child",
                        data: {},
                        children: [],
                    },
                ],
            },
        ]);
    });

    it("returns an empty list when the input is not an array", () => {
        expect(
            normalizeTreeJson("not-an-array", {
                isTreeData,
                createEmptyData: () => ({}),
            }),
        ).toEqual([]);
    });
});
