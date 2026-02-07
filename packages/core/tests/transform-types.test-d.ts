import { describe, it, expectTypeOf } from "vitest";
import { schema } from "../src/schema/index.js";
import type { InferType } from "../src/schema/types.js";

describe("Transform type inference", () => {
    const dateTransform = {
        decode: (s: string) => new Date(s),
        encode: (d: Date) => d.toISOString(),
    };

    it("infers Date | undefined for optional field with transform", () => {
        const s = schema
            .String({ required: false })
            .transform(dateTransform);
        type T = InferType<typeof s>;
        expectTypeOf<T>().toEqualTypeOf<Date | undefined>();
    });

    it("infers Date for required field with transform", () => {
        const s = schema.String().transform(dateTransform);
        type T = InferType<typeof s>;
        expectTypeOf<T>().toEqualTypeOf<Date>();
    });
});
