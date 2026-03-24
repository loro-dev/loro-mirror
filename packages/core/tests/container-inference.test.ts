import { describe, expect, it } from "vitest";
import {
    inferContainerTypeFromValue,
    inferSchemaContainerTypeFromValue,
    isPlainObjectValue,
    matchesContainerType,
} from "../src/core/container-inference.js";

describe("container inference", () => {
    describe("isPlainObjectValue", () => {
        it("accepts plain objects and rejects non-container values", () => {
            expect(isPlainObjectValue({})).toBe(true);
            expect(isPlainObjectValue({ title: "Docs" })).toBe(true);

            expect(isPlainObjectValue([])).toBe(false);
            expect(isPlainObjectValue(null)).toBe(false);
            expect(isPlainObjectValue("text")).toBe(false);
            expect(isPlainObjectValue(new Date())).toBe(false);
            expect(isPlainObjectValue(/re/)).toBe(false);
        });
    });

    describe("inferContainerTypeFromValue", () => {
        it("infers map and list values by shape", () => {
            expect(inferContainerTypeFromValue({ title: "Docs" })).toBe("Map");
            expect(inferContainerTypeFromValue(["a", "b"])).toBe("List");
        });

        it("respects infer options for strings and arrays", () => {
            expect(inferContainerTypeFromValue("hello")).toBeUndefined();
            expect(
                inferContainerTypeFromValue("hello", {
                    defaultLoroText: true,
                }),
            ).toBe("Text");

            expect(
                inferContainerTypeFromValue(["a"], {
                    defaultMovableList: true,
                }),
            ).toBe("MovableList");
        });
    });

    describe("inferSchemaContainerTypeFromValue", () => {
        it("maps inferred loro container types to schema names", () => {
            expect(inferSchemaContainerTypeFromValue({ title: "Docs" })).toBe(
                "loro-map",
            );
            expect(inferSchemaContainerTypeFromValue(["a"])).toBe("loro-list");
            expect(
                inferSchemaContainerTypeFromValue(["a"], {
                    defaultMovableList: true,
                }),
            ).toBe("loro-movable-list");
            expect(
                inferSchemaContainerTypeFromValue("hello", {
                    defaultLoroText: true,
                }),
            ).toBe("loro-text");
        });
    });

    describe("matchesContainerType", () => {
        it("checks container compatibility by value shape", () => {
            expect(matchesContainerType("Map", { title: "Docs" })).toBe(true);
            expect(matchesContainerType("List", ["a"])).toBe(true);
            expect(matchesContainerType("MovableList", ["a"])).toBe(true);
            expect(matchesContainerType("Tree", ["a"])).toBe(true);
            expect(matchesContainerType("Text", "hello")).toBe(true);

            expect(matchesContainerType("Map", ["a"])).toBe(false);
            expect(matchesContainerType("Text", 1)).toBe(false);
            expect(matchesContainerType("List", { title: "Docs" })).toBe(false);
        });
    });
});
