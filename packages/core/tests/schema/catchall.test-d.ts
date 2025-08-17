import { test, expectTypeOf, describe } from 'vitest'
import { InferType, schema } from '../../src';

describe("infer type", () => {
    test("catchall", () => {
        const mixedSchema = schema.LoroMap({
            name: schema.String({ required: true }),
            age: schema.Number({ required: true }),
        })

        type InferredType = InferType<typeof mixedSchema>;

        expectTypeOf<InferredType>().toMatchTypeOf<{
            name: string,
            age: number,
        } | undefined>();
    })

    test("catchall with empty schema", () => {
        const emptySchema = schema.LoroMap({});
        const mixedSchema = emptySchema.catchall(schema.String());

        type InferredType = InferType<typeof mixedSchema>;

        expectTypeOf<InferredType>().toMatchTypeOf<{
            [key: string]: string | undefined,
        } | undefined>();
    })

    test("record loro map", () => {
        const recordSchema = schema.LoroMapRecord(schema.String({ required: true }));

        type InferredType = InferType<typeof recordSchema>;

        expectTypeOf<InferredType>().toMatchTypeOf<{
            [key: string]: string,
        } | undefined>();
    })
})