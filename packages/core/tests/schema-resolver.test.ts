import { describe, expect, it } from "vitest";
import { schema } from "../src/schema/index.js";
import {
    getChildContainerSchema,
    getChildSchema,
    getMapFieldSchema,
} from "../src/schema/resolver.js";

describe("schema resolver", () => {
    it("resolves root fields and map catchall fields", () => {
        const catchall = schema.Number();
        const itemsSchema = schema.LoroList(schema.String());
        const recordSchema = schema
            .LoroMap({
                title: schema.String(),
            })
            .catchall(catchall);
        const rootSchema = schema({
            items: itemsSchema,
            record: recordSchema,
        });

        expect(getMapFieldSchema(rootSchema, "items")).toBe(itemsSchema);
        expect(getMapFieldSchema(rootSchema, "missing")).toBeUndefined();
        expect(getMapFieldSchema(recordSchema, "title")).toBe(
            recordSchema.definition.title,
        );
        expect(getMapFieldSchema(recordSchema, "views")).toBe(catchall);
    });

    it("resolves list and tree child schemas", () => {
        const listItemSchema = schema.String();
        const listSchema = schema.LoroList(listItemSchema);
        const treeNodeSchema = schema.LoroMap({
            createdAt: schema.String(),
        });
        const treeSchema = schema.LoroTree(treeNodeSchema);

        expect(getChildSchema(listSchema)).toBe(listItemSchema);
        expect(getChildSchema(listSchema, 0)).toBe(listItemSchema);
        expect(getChildSchema(treeSchema)).toBe(treeNodeSchema);
        expect(getChildSchema(treeSchema, "createdAt")).toBe(treeNodeSchema);
    });

    it("only returns container schemas from container resolver", () => {
        const primitiveField = schema.String();
        const childMap = schema.LoroMap({
            title: primitiveField,
        });
        const rootSchema = schema({
            childMap,
        });
        const listSchema = schema.LoroList(primitiveField);

        expect(getChildContainerSchema(rootSchema, "childMap")).toBe(childMap);
        expect(getChildContainerSchema(childMap, "title")).toBeUndefined();
        expect(getChildContainerSchema(listSchema, 0)).toBeUndefined();
    });
});
