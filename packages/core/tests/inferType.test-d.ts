import { test, expectTypeOf, describe } from "vitest";
import { InferType, schema } from "../src/index.js";

describe("infer type", () => {
    test("catchall", () => {
        const mixedSchema = schema
            .LoroMap({
                name: schema.String(),
                age: schema.Number(),
            })
            .catchall(schema.String());

        type InferredType = InferType<typeof mixedSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<
            {
                name: string;
                age: number;
            } & {
                [key: string]: string;
            } & { $cid: string }
        >();
    });

    test("catchall with empty schema", () => {
        const emptySchema = schema.LoroMap({});
        const mixedSchema = emptySchema.catchall(schema.String());

        type InferredType = InferType<typeof mixedSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<
            {
                [key: string]: string;
            } & { $cid: string }
        >();
    });

    test("record loro map", () => {
        const recordSchema = schema.LoroMapRecord(schema.String());

        type InferredType = InferType<typeof recordSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<
            {
                [key: string]: string;
            } & { $cid: string }
        >();
    });

    test("infer custom string type", () => {
        type UserId = string & { _brand: "userId" };
        const stringSchema = schema.String<UserId>();

        type InferredType = InferType<typeof stringSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<UserId>();
    });

    test("infer required", () => {
        const requiredSchema = schema.String({ required: false });

        type InferredType = InferType<typeof requiredSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<string | undefined>();
    });

    test("infer required false and custom string type", () => {
        type UserId = string & { _brand: "userId" };
        const requiredSchema = schema.String<UserId, { required: false }>({
            required: false,
        });

        type InferredType = InferType<typeof requiredSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<UserId | undefined>();
    });
});
