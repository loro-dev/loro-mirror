import { test, expectTypeOf, describe } from "vitest";
import {
    InferType,
    InferInputType,
    schema,
    TransformDefinition,
} from "../src/index.js";

// Test transform definition
const stringDateTransform: TransformDefinition<string, Date> = {
    decode: (s: string) => new Date(s),
    encode: (d: Date) => d.toISOString(),
};

const numberDateTransform: TransformDefinition<number, Date> = {
    decode: (s: number) => new Date(s),
    encode: (d: Date) => d.getTime(),
};

const booleanNumberTransform: TransformDefinition<boolean, number> = {
    decode: (s: boolean) => s ? 1 : 0,
    encode: (d: number) => !!d,
};

describe("infer type", () => {
    test("infer any", () => {
        const anySchema = schema.Any();

        type InferredType = InferType<typeof anySchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<unknown>();
    });

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

    test("infer custom string type with explicit options type and no options arg", () => {
        type UserId = string & { _brand: "userId" };
        const stringSchema = schema.String<UserId, { description?: string }>();

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

    test("infer custom string type with required: false (single generic)", () => {
        type UserId = string & { _brand: "userId" };
        const optionalUserIdSchema = schema.String<UserId>({ required: false });

        type InferredType = InferType<typeof optionalUserIdSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<UserId | undefined>();
    });

    test("infer string transform to domain type | undefined when no defaultValue", () => {
        const transformedSchema = schema.String().transform(stringDateTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: string) => Date>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: Date) => string>();

        // InferType resolves to domain type | undefined because empty docs can omit the field
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<Date | undefined>();
    });

    test("infer string transform with required: false", () => {
        const transformedSchema = schema.String({ required: false }).transform(stringDateTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: string) => Date>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: Date) => string>();

        // InferType resolves to domain type | undefined
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<Date | undefined>();
    });

    test("infer number transform to domain type | undefined when no defaultValue", () => {
        const transformedSchema = schema.Number().transform(numberDateTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: number) => Date>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: Date) => number>();

        // InferType resolves to domain type | undefined because empty docs can omit the field
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<Date | undefined>();
    });

    test("infer number transform with required: false", () => {
        const transformedSchema = schema.Number({ required: false }).transform(numberDateTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: number) => Date>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: Date) => number>();

        // InferType resolves to domain type | undefined
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<Date | undefined>();
    });

    test("infer boolean transform to domain type | undefined when no defaultValue", () => {
        const transformedSchema = schema.Boolean().transform(booleanNumberTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: boolean) => number>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: number) => boolean>();

        // InferType resolves to domain type | undefined because empty docs can omit the field
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<number | undefined>();
    });

    test("infer boolean transform with required: false", () => {
        const transformedSchema = schema.Boolean({ required: false }).transform(booleanNumberTransform);

        // Transform decode/encode have correct types
        expectTypeOf(transformedSchema.transform.decode).toEqualTypeOf<(value: boolean) => number>();
        expectTypeOf(transformedSchema.transform.encode).toEqualTypeOf<(value: number) => boolean>();

        // InferType resolves to domain type | undefined
        expectTypeOf<InferType<typeof transformedSchema>>().toEqualTypeOf<number | undefined>();
    });

    test("infer transform in LoroMap", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            createdAt: schema.String().transform(stringDateTransform),
        });

        type InferredType = InferType<typeof mapSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<
            { name: string; createdAt: Date | undefined } & { $cid: string }
        >();
    });

    test("infer transform in nested LoroList of LoroMap", () => {
        const listSchema = schema.LoroList(
            schema.LoroMap({
                name: schema.String(),
                when: schema.String().transform(stringDateTransform),
            }),
        );

        type InferredType = InferType<typeof listSchema>;

        expectTypeOf<InferredType>().toEqualTypeOf<
            Array<{ name: string; when: Date | undefined } & { $cid: string }>
        >();
    });

    test("standalone transformed field with required: false", () => {
        const field = schema
            .Number({ required: false })
            .transform(numberDateTransform);

        type FieldType = InferInputType<typeof field>;

        expectTypeOf<FieldType>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroMap", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            deletedAt: schema
                .Number({ required: false })
                .transform(numberDateTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type DeletedAtField = MapInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: true inside LoroMap", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            deletedAt: schema
                .Number({ required: true })
                .transform(numberDateTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type DeletedAtField = MapInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroMap (string transform)", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            archivedAt: schema
                .String({ required: false })
                .transform(stringDateTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type ArchivedAtField = MapInput["archivedAt"];

        expectTypeOf<ArchivedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroMap (boolean transform)", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            score: schema
                .Boolean({ required: false })
                .transform(booleanNumberTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type ScoreField = MapInput["score"];

        expectTypeOf<ScoreField>().toEqualTypeOf<number | undefined>();
    });

    test("transformed field with required: false inside LoroList of LoroMap", () => {
        const listSchema = schema.LoroList(
            schema.LoroMap({
                name: schema.String(),
                deletedAt: schema
                    .Number({ required: false })
                    .transform(numberDateTransform),
            }),
        );

        type ListInput = NonNullable<InferInputType<typeof listSchema>>;
        type ItemInput = NonNullable<ListInput[number]>;
        type DeletedAtField = ItemInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroMovableList of LoroMap", () => {
        const listSchema = schema.LoroMovableList(
            schema.LoroMap({
                id: schema.String(),
                deletedAt: schema
                    .Number({ required: false })
                    .transform(numberDateTransform),
            }),
            (item) => item.id,
        );

        type ListInput = NonNullable<InferInputType<typeof listSchema>>;
        type ItemInput = NonNullable<ListInput[number]>;
        type DeletedAtField = ItemInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: true inside LoroMovableList of LoroMap", () => {
        const listSchema = schema.LoroMovableList(
            schema.LoroMap({
                id: schema.String(),
                deletedAt: schema
                    .Number({ required: true })
                    .transform(numberDateTransform),
            }),
            (item) => item.id,
        );

        type ListInput = NonNullable<InferInputType<typeof listSchema>>;
        type ItemInput = NonNullable<ListInput[number]>;
        type DeletedAtField = ItemInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroTree node data", () => {
        const treeSchema = schema.LoroTree(
            schema.LoroMap({
                name: schema.String(),
                deletedAt: schema
                    .Number({ required: false })
                    .transform(numberDateTransform),
            }),
        );

        type TreeInput = NonNullable<InferInputType<typeof treeSchema>>;
        type NodeInput = TreeInput[number];
        type NodeData = NodeInput["data"];
        type DeletedAtField = NodeData["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: true inside LoroTree node data", () => {
        const treeSchema = schema.LoroTree(
            schema.LoroMap({
                name: schema.String(),
                deletedAt: schema
                    .Number({ required: true })
                    .transform(numberDateTransform),
            }),
        );

        type TreeInput = NonNullable<InferInputType<typeof treeSchema>>;
        type NodeInput = TreeInput[number];
        type NodeData = NodeInput["data"];
        type DeletedAtField = NodeData["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("transformed field with required: false inside LoroMap with catchall", () => {
        const mapSchema = schema
            .LoroMap({
                name: schema.String(),
                deletedAt: schema
                    .Number({ required: false })
                    .transform(numberDateTransform),
            })
            .catchall(schema.String());

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type DeletedAtField = MapInput["deletedAt"];

        expectTypeOf<DeletedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("non-transformed field with required: false inside LoroMap (control)", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            nickname: schema.String({ required: false }),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type NicknameField = MapInput["nickname"];

        expectTypeOf<NicknameField>().toEqualTypeOf<string | undefined>();
    });

    test("transformed field with required: true inside LoroMap (control)", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            createdAt: schema.Number().transform(numberDateTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type CreatedAtField = MapInput["createdAt"];

        expectTypeOf<CreatedAtField>().toEqualTypeOf<Date | undefined>();
    });

    test("required transformed field with explicit defaultValue stays non-optional", () => {
        const mapSchema = schema.LoroMap({
            name: schema.String(),
            createdAt: schema
                .String({
                    defaultValue: new Date("2025-01-01T00:00:00.000Z"),
                })
                .transform(stringDateTransform),
        });

        type MapInput = NonNullable<InferInputType<typeof mapSchema>>;
        type CreatedAtField = MapInput["createdAt"];

        expectTypeOf<CreatedAtField>().toEqualTypeOf<Date>();
    });
});
