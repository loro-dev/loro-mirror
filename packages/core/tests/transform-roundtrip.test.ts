import { describe, expect, it } from "vitest";
import { LoroDoc, LoroMap } from "loro-crdt";
import { Mirror } from "../src/core/mirror.js";
import { schema, type InferType } from "../src/schema/index.js";
import type { ContainerSchemaType, RootSchemaType } from "../src/schema/types.js";

// Simple date transform for testing
const dateTransform = {
    decode: (s: string) => new Date(s),
    encode: (d: Date) => d.toISOString(),
};

// Number transform: cents to formatted currency string
const currencyTransform = {
    decode: (cents: number) => `$${(cents / 100).toFixed(2)}`,
    encode: (currency: string) =>
        Math.round(parseFloat(currency.replace("$", "")) * 100),
};

// Boolean transform: boolean to status string
type Status = "active" | "inactive";

const statusTransform = {
    decode: (active: boolean): Status => (active ? "active" : "inactive"),
    encode: (status: Status) => status === "active",
};

// Object domain type: passes isObject(), encodes to number
class Money {
    constructor(public cents: number) {}
    format() {
        return `$${(this.cents / 100).toFixed(2)}`;
    }
}
const moneyTransform = {
    decode: (n: number) => new Money(n),
    encode: (m: Money) => m.cents,
};

// Object domain type: passes isObject(), encodes to string
class Point {
    constructor(
        public x: number,
        public y: number,
    ) {}
}
const pointTransform = {
    decode: (s: string): Point => {
        const [x, y] = s.split(",").map(Number);
        return new Point(x, y);
    },
    encode: (p: Point) => `${p.x},${p.y}`,
};

const bigintTransform = {
    decode: (s: string) => BigInt(s),
    encode: (n: bigint) => n.toString(),
};

interface OrgHierarchy {
    org: string;
    departments: { name: string; teams: { lead: string; members: string[] }[] }[];
}
const jsonTransform = {
    decode: (s: string): OrgHierarchy =>
        s ? JSON.parse(s) : { org: "", departments: [] },
    encode: (obj: OrgHierarchy) => JSON.stringify(obj),
};

/**
 * Runs init + optional update across 3 sync modes each (up to 6 checks):
 *
 * Phase 1 — Init roundtrip (exercises initializeContainer path):
 *   (a) Direct: init(mirror1) → assertAfterInit(mirror1.getState())
 *   (b) Snapshot: import snapshot from doc1 → new mirror → assertAfterInit
 *   (c) Update sync: new mirror on empty doc → import updates → assertAfterInit
 *
 * Phase 2 — Update roundtrip (exercises diff algorithm path):
 *   (a) Direct: update(mirror1) → assertAfterUpdate(mirror1.getState())
 *   (b) Snapshot: import snapshot from doc1 (post-update) → assertAfterUpdate
 *   (c) Update sync: new mirror on empty doc → import all updates → assertAfterUpdate
 */
function assertRoundtrip<S extends RootSchemaType<Record<string, ContainerSchemaType>>>(opts: {
    schema: S;
    init: (mirror: Mirror<S>, doc: LoroDoc) => void;
    assertAfterInit: (state: InferType<S>, doc: LoroDoc) => void;
    update?: (mirror: Mirror<S>, doc: LoroDoc) => void;
    assertAfterUpdate?: (state: InferType<S>, doc: LoroDoc) => void;
}) {
    // Phase 1: Init roundtrip

    // (a) Direct — setState + getState on same doc
    const doc1 = new LoroDoc();
    const mirror1 = new Mirror({ doc: doc1, schema: opts.schema });
    opts.init(mirror1, doc1);
    opts.assertAfterInit(mirror1.getState(), doc1);

    // (b) Snapshot import — tests decode during Mirror initialization
    const doc2 = new LoroDoc();
    doc2.import(doc1.export({ mode: "snapshot" }));
    const mirror2 = new Mirror({ doc: doc2, schema: opts.schema });
    opts.assertAfterInit(mirror2.getState(), doc2);

    // (c) Update import — tests event-driven decode on existing Mirror
    const doc3 = new LoroDoc();
    const mirror3 = new Mirror({ doc: doc3, schema: opts.schema });
    doc3.import(doc1.export({ mode: "update" }));
    opts.assertAfterInit(mirror3.getState(), doc3);

    // Phase 2: Update roundtrip (optional)
    if (opts.update && opts.assertAfterUpdate) {
        // (a) Direct — update on same doc
        opts.update(mirror1, doc1);
        opts.assertAfterUpdate(mirror1.getState(), doc1);

        // (b) Snapshot import — post-update snapshot
        const doc4 = new LoroDoc();
        doc4.import(doc1.export({ mode: "snapshot" }));
        const mirror4 = new Mirror({ doc: doc4, schema: opts.schema });
        opts.assertAfterUpdate(mirror4.getState(), doc4);

        // (c) Update import — all updates from beginning
        const doc5 = new LoroDoc();
        const mirror5 = new Mirror({ doc: doc5, schema: opts.schema });
        doc5.import(doc1.export({ mode: "update" }));
        opts.assertAfterUpdate(mirror5.getState(), doc5);
    }
}

describe("Transform Roundtrip", () => {
    describe("Map", () => {
        it("String → Date", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    name: schema.String(),
                    createdAt: schema.String().transform(dateTransform),
                }),
            });

            const testDate = new Date("2025-01-19T10:00:00.000Z");
            const updatedDate = new Date("2026-06-01T00:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        record: { name: "Test Record", createdAt: testDate },
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.record.name).toBe("Test Record");
                    expect(state.record.createdAt).toBeInstanceOf(Date);
                    expect(state.record.createdAt.getTime()).toBe(testDate.getTime());

                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("createdAt")).toBe("2025-01-19T10:00:00.000Z");
                },
                update: (mirror) => {
                    mirror.setState({
                        record: { name: "Test Record", createdAt: updatedDate },
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.record.createdAt).toBeInstanceOf(Date);
                    expect(state.record.createdAt.getTime()).toBe(updatedDate.getTime());

                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("createdAt")).toBe("2026-06-01T00:00:00.000Z");
                },
            });
        });

        it("Number → Currency", () => {
            const testSchema = schema({
                product: schema.LoroMap({
                    name: schema.String(),
                    price: schema.Number().transform(currencyTransform),
                }),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        product: { name: "Widget", price: "$19.99" },
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.product.name).toBe("Widget");
                    expect(state.product.price).toBe("$19.99");

                    const productMap = doc.getMap("product");
                    expect(productMap.get("price")).toBe(1999);
                    expect(typeof productMap.get("price")).toBe("number");
                },
                update: (mirror) => {
                    mirror.setState({
                        product: { name: "Widget", price: "$29.99" },
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.product.price).toBe("$29.99");

                    const productMap = doc.getMap("product");
                    expect(productMap.get("price")).toBe(2999);
                },
            });
        });

        it("Boolean → Status", () => {
            const testSchema = schema({
                user: schema.LoroMap({
                    name: schema.String(),
                    status: schema.Boolean().transform(statusTransform),
                }),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        user: { name: "Alice", status: "active" },
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.user.name).toBe("Alice");
                    expect(state.user.status).toBe("active");

                    const userMap = doc.getMap("user");
                    expect(userMap.get("status")).toBe(true);
                    expect(typeof userMap.get("status")).toBe("boolean");
                },
                update: (mirror) => {
                    mirror.setState({
                        user: { name: "Alice", status: "inactive" as Status },
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.user.status).toBe("inactive");

                    const userMap = doc.getMap("user");
                    expect(userMap.get("status")).toBe(false);
                },
            });
        });

        it("mixed transformed and plain fields", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    plainString: schema.String(),
                    transformedString: schema.String().transform(dateTransform),
                    plainNumber: schema.Number(),
                    plainBoolean: schema.Boolean(),
                }),
            });

            const testDate = new Date("2025-05-15T00:00:00.000Z");
            const updatedDate = new Date("2026-01-01T00:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        record: {
                            plainString: "hello",
                            transformedString: testDate,
                            plainNumber: 42,
                            plainBoolean: true,
                        },
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.record.plainString).toBe("hello");
                    expect(state.record.transformedString).toBeInstanceOf(Date);
                    expect(state.record.plainNumber).toBe(42);
                    expect(state.record.plainBoolean).toBe(true);

                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("plainString")).toBe("hello");
                    expect(recordMap.get("transformedString")).toBe(
                        "2025-05-15T00:00:00.000Z",
                    );
                    expect(recordMap.get("plainNumber")).toBe(42);
                    expect(recordMap.get("plainBoolean")).toBe(true);
                },
                update: (mirror) => {
                    mirror.setState({
                        record: {
                            plainString: "world",
                            transformedString: updatedDate,
                            plainNumber: 100,
                            plainBoolean: false,
                        },
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.record.plainString).toBe("world");
                    expect(state.record.transformedString).toBeInstanceOf(Date);
                    expect(state.record.transformedString.getTime()).toBe(updatedDate.getTime());
                    expect(state.record.plainNumber).toBe(100);
                    expect(state.record.plainBoolean).toBe(false);

                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("transformedString")).toBe(
                        "2026-01-01T00:00:00.000Z",
                    );
                },
            });
        });

        it("object→number map field (Money)", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    price: schema.Number().transform(moneyTransform),
                }),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { price: new Money(999) } });
                },
                assertAfterInit: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("price")).toBe(999);
                    expect(typeof recordMap.get("price")).toBe("number");

                    expect(state.record.price).toBeInstanceOf(Money);
                    expect(state.record.price.cents).toBe(999);
                },
                update: (mirror) => {
                    mirror.setState({ record: { price: new Money(1499) } });
                },
                assertAfterUpdate: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("price")).toBe(1499);
                    expect(typeof recordMap.get("price")).toBe("number");

                    expect(state.record.price).toBeInstanceOf(Money);
                    expect(state.record.price.cents).toBe(1499);
                },
            });
        });

        it("object→string map field (Point)", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    location: schema.String().transform(pointTransform),
                }),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { location: new Point(10, 20) } });
                },
                assertAfterInit: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("location")).toBe("10,20");
                    expect(typeof recordMap.get("location")).toBe("string");

                    expect(state.record.location).toBeInstanceOf(Point);
                    expect(state.record.location.x).toBe(10);
                    expect(state.record.location.y).toBe(20);
                },
                update: (mirror) => {
                    mirror.setState({ record: { location: new Point(30, 40) } });
                },
                assertAfterUpdate: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("location")).toBe("30,40");

                    expect(state.record.location).toBeInstanceOf(Point);
                    expect(state.record.location.x).toBe(30);
                    expect(state.record.location.y).toBe(40);
                },
            });
        });

        it("catch-all with transform", () => {
            const s = schema({
                metadata: schema.LoroMap({}).catchall(schema.String().transform(dateTransform)),
            });
            assertRoundtrip({
                schema: s,
                init: (mirror) => {
                    const date1 = new Date("2024-01-01");
                    const date2 = new Date("2024-06-15");
                    mirror.setState({ metadata: { createdAt: date1, updatedAt: date2 } });
                },
                assertAfterInit: (state, doc) => {
                    const map = doc.getMap("metadata");
                    expect(map.get("createdAt")).toBe(new Date("2024-01-01").toISOString());
                    expect(map.get("updatedAt")).toBe(new Date("2024-06-15").toISOString());
                    expect(state.metadata.createdAt).toEqual(new Date("2024-01-01"));
                    expect(state.metadata.updatedAt).toEqual(new Date("2024-06-15"));
                },
                update: (mirror) => {
                    mirror.setState({
                        metadata: {
                            createdAt: new Date("2024-01-01"),
                            updatedAt: new Date("2025-01-01"),
                        },
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    const map = doc.getMap("metadata");
                    expect(map.get("updatedAt")).toBe(new Date("2025-01-01").toISOString());
                    expect(state.metadata.updatedAt).toEqual(new Date("2025-01-01"));
                },
            });
        });

        it("optional fields lifecycle", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    name: schema.String(),
                    optionalDate: schema.String({ required: false }).transform(dateTransform),
                }),
            });
            const testDate = new Date("2025-01-19T10:00:00.000Z");
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { name: "Test", optionalDate: testDate } });
                },
                assertAfterInit: (state) => {
                    expect(state.record.optionalDate).toBeInstanceOf(Date);
                    expect(state.record.optionalDate!.getTime()).toBe(testDate.getTime());
                },
                update: (mirror) => {
                    mirror.setState({ record: { name: "Test", optionalDate: undefined } });
                },
                assertAfterUpdate: (state) => {
                    expect(state.record.optionalDate).toBeUndefined();
                },
            });
        });

        it("optional across all primitives", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    optString: schema.String({ required: false }).transform(dateTransform),
                    optNumber: schema.Number({ required: false }).transform(currencyTransform),
                    optBoolean: schema.Boolean({ required: false }).transform(statusTransform),
                }),
            });
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        record: {
                            optString: new Date("2025-01-01"),
                            optNumber: "$19.99",
                            optBoolean: "active" as Status,
                        },
                    });
                },
                assertAfterInit: (state) => {
                    expect(state.record.optString).toBeInstanceOf(Date);
                    expect(state.record.optNumber).toBe("$19.99");
                    expect(state.record.optBoolean).toBe("active");
                },
                update: (mirror) => {
                    mirror.setState({
                        record: { optString: undefined, optNumber: undefined, optBoolean: undefined },
                    });
                },
                assertAfterUpdate: (state) => {
                    expect(state.record.optString).toBeUndefined();
                    expect(state.record.optNumber).toBeUndefined();
                    expect(state.record.optBoolean).toBeUndefined();
                },
            });
        });

        it("falsy encoded values (epoch, $0, false)", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    createdAt: schema.String({ required: true }).transform(dateTransform),
                    price: schema.Number({ required: true }).transform(currencyTransform),
                    status: schema.Boolean({ required: true }).transform(statusTransform),
                }),
            });
            const epochDate = new Date("1970-01-01T00:00:00.000Z");
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        record: { createdAt: epochDate, price: "$0.00", status: "inactive" as Status },
                    });
                },
                assertAfterInit: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(recordMap.get("createdAt")).toBe("1970-01-01T00:00:00.000Z");
                    expect(recordMap.get("price")).toBe(0);
                    expect(recordMap.get("status")).toBe(false);
                    expect(state.record.createdAt).toBeInstanceOf(Date);
                    expect(state.record.createdAt.getTime()).toBe(0);
                    expect(state.record.price).toBe("$0.00");
                    expect(state.record.status).toBe("inactive");
                },
            });
        });

        it("exotic: BigInt", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    big: schema.String({ required: true }).transform(bigintTransform),
                }),
            });
            const bigValue = BigInt("9007199254740993");
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { big: bigValue } });
                },
                assertAfterInit: (state) => {
                    expect(state.record.big).toBe(bigValue);
                    expect(state.record.big.toString()).toBe("9007199254740993");
                },
                update: (mirror) => {
                    mirror.setState({ record: { big: BigInt("18014398509481984") } });
                },
                assertAfterUpdate: (state) => {
                    expect(state.record.big).toBe(BigInt("18014398509481984"));
                },
            });
        });

        it("exotic: class with methods", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    price: schema.Number().transform(moneyTransform),
                }),
            });
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { price: new Money(1999) } });
                },
                assertAfterInit: (state) => {
                    expect(state.record.price).toBeInstanceOf(Money);
                    expect(state.record.price.format()).toBe("$19.99");
                },
                update: (mirror) => {
                    mirror.setState({ record: { price: new Money(2999) } });
                },
                assertAfterUpdate: (state) => {
                    expect(state.record.price).toBeInstanceOf(Money);
                    expect(state.record.price.format()).toBe("$29.99");
                },
            });
        });

        it("JSON transform: complex hierarchy as string", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    config: schema.String().transform(jsonTransform),
                }),
            });
            const initValue: OrgHierarchy = {
                org: "Acme",
                departments: [{ name: "Eng", teams: [{ lead: "Alice", members: ["Bob"] }] }],
            };
            const updatedValue: OrgHierarchy = {
                org: "Acme",
                departments: [{ name: "Eng", teams: [{ lead: "Alice", members: ["Bob", "Charlie"] }] }],
            };
            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ record: { config: initValue } });
                },
                assertAfterInit: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(typeof recordMap.get("config")).toBe("string");
                    expect(state.record.config).toEqual(initValue);
                    expect(state.record.config.departments[0].teams[0].lead).toBe("Alice");
                },
                update: (mirror) => {
                    mirror.setState({ record: { config: updatedValue } });
                },
                assertAfterUpdate: (state, doc) => {
                    const recordMap = doc.getMap("record");
                    expect(typeof recordMap.get("config")).toBe("string");
                    expect(state.record.config).toEqual(updatedValue);
                    expect(state.record.config.departments[0].teams[0].members).toContain("Charlie");
                },
            });
        });

        it("consistency check mode", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    name: schema.String(),
                    createdAt: schema.String().transform(dateTransform),
                }),
            });
            const testDate = new Date("2025-01-19T10:00:00.000Z");
            const doc = new LoroDoc();
            const mirror = new Mirror({ doc, schema: testSchema, checkStateConsistency: true });
            expect(() => {
                mirror.setState({ record: { name: "Test Record", createdAt: testDate } });
            }).not.toThrow();
            expect(mirror.getState().record.createdAt).toBeInstanceOf(Date);
        });
    });

    describe("List (no idSelector)", () => {
        it("primitive items", () => {
            const testSchema = schema({
                dates: schema.LoroList(
                    schema.String().transform(dateTransform),
                ),
            });

            const dates = [
                new Date("2025-01-01T00:00:00.000Z"),
                new Date("2025-06-15T12:00:00.000Z"),
                new Date("2025-12-31T23:59:59.000Z"),
            ];

            const date4 = new Date("2025-09-15T06:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ dates });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.dates).toHaveLength(3);
                    expect(state.dates[0]).toBeInstanceOf(Date);
                    expect(state.dates[0].getTime()).toBe(dates[0].getTime());
                    expect(state.dates[1].getTime()).toBe(dates[1].getTime());
                    expect(state.dates[2].getTime()).toBe(dates[2].getTime());

                    const datesList = doc.getList("dates");
                    expect(datesList.get(0)).toBe("2025-01-01T00:00:00.000Z");
                    expect(datesList.get(1)).toBe("2025-06-15T12:00:00.000Z");
                    expect(datesList.get(2)).toBe("2025-12-31T23:59:59.000Z");
                },
                update: (mirror) => {
                    mirror.setState({ dates: [...dates, date4] });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.dates).toHaveLength(4);
                    expect(state.dates[3]).toBeInstanceOf(Date);
                    expect(state.dates[3].getTime()).toBe(date4.getTime());

                    const datesList = doc.getList("dates");
                    expect(datesList.get(3)).toBe("2025-09-15T06:00:00.000Z");
                },
            });
        });

        it("Map items with transformed fields", () => {
            const testSchema = schema({
                items: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        createdAt: schema.String().transform(dateTransform),
                    }),
                ),
            });

            const testDate = new Date("2025-03-15T08:30:00.000Z");
            const date2 = new Date("2025-06-01T00:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        items: [{ id: "item-1", createdAt: testDate }],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.items).toHaveLength(1);
                    expect(state.items[0].id).toBe("item-1");
                    expect(state.items[0].createdAt).toBeInstanceOf(Date);
                    expect(state.items[0].createdAt.getTime()).toBe(testDate.getTime());

                    const list = doc.getList("items");
                    const itemMap = list.get(0) as LoroMap;
                    expect(itemMap.get("createdAt")).toBe("2025-03-15T08:30:00.000Z");
                    expect(typeof itemMap.get("createdAt")).toBe("string");
                },
                update: (mirror) => {
                    mirror.setState({
                        items: [
                            { id: "item-1", createdAt: testDate },
                            { id: "item-2", createdAt: date2 },
                        ],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.items).toHaveLength(2);
                    expect(state.items[1].id).toBe("item-2");
                    expect(state.items[1].createdAt).toBeInstanceOf(Date);
                    expect(state.items[1].createdAt.getTime()).toBe(date2.getTime());

                    const list = doc.getList("items");
                    const itemMap = list.get(1) as LoroMap;
                    expect(itemMap.get("createdAt")).toBe("2025-06-01T00:00:00.000Z");
                },
            });
        });

        it("object domain items (Money)", () => {
            const testSchema = schema({
                prices: schema.LoroList(
                    schema.Number().transform(moneyTransform),
                ),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ prices: [new Money(999), new Money(1499)] });
                },
                assertAfterInit: (state, doc) => {
                    const list = doc.getList("prices");
                    expect(list.get(0)).toBe(999);
                    expect(list.get(1)).toBe(1499);
                    expect(typeof list.get(0)).toBe("number");

                    expect(state.prices[0]).toBeInstanceOf(Money);
                    expect(state.prices[0].cents).toBe(999);
                    expect(state.prices[1]).toBeInstanceOf(Money);
                    expect(state.prices[1].cents).toBe(1499);
                },
                update: (mirror) => {
                    mirror.setState({
                        prices: [new Money(999), new Money(1499), new Money(2999)],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    const list = doc.getList("prices");
                    expect(list.get(2)).toBe(2999);
                    expect(typeof list.get(2)).toBe("number");

                    expect(state.prices).toHaveLength(3);
                    expect(state.prices[2]).toBeInstanceOf(Money);
                    expect(state.prices[2].cents).toBe(2999);
                },
            });
        });

        it("empty → populated → empty", () => {
            const testSchema = schema({
                dates: schema.LoroList(
                    schema.String().transform(dateTransform),
                ),
            });

            const doc = new LoroDoc();
            const mirror = new Mirror({ doc, schema: testSchema });

            mirror.setState({ dates: [] });
            expect(mirror.getState().dates).toEqual([]);

            mirror.setState({ dates: [new Date("2025-01-01T00:00:00.000Z")] });
            expect(mirror.getState().dates).toHaveLength(1);
            expect(mirror.getState().dates[0]).toBeInstanceOf(Date);

            mirror.setState({ dates: [] });
            expect(mirror.getState().dates).toEqual([]);
        });
    });

    describe("List (with idSelector)", () => {
        it("primitive items", () => {
            const testSchema = schema({
                dates: schema.LoroList(
                    schema.String().transform(dateTransform),
                    (id) => id.getTime().toString(),
                ),
            });

            const dates = [
                new Date("2025-01-01T00:00:00.000Z"),
                new Date("2025-06-15T12:00:00.000Z"),
                new Date("2025-12-31T23:59:59.000Z"),
            ];

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ dates });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.dates).toHaveLength(3);
                    expect(state.dates[0]).toBeInstanceOf(Date);
                    expect(state.dates[1]).toBeInstanceOf(Date);
                    expect(state.dates[2]).toBeInstanceOf(Date);
                    expect(state.dates[0].getTime()).toBe(dates[0].getTime());
                    expect(state.dates[1].getTime()).toBe(dates[1].getTime());
                    expect(state.dates[2].getTime()).toBe(dates[2].getTime());

                    const datesList = doc.getList("dates");
                    expect(datesList.get(0)).toBe("2025-01-01T00:00:00.000Z");
                    expect(datesList.get(1)).toBe("2025-06-15T12:00:00.000Z");
                    expect(datesList.get(2)).toBe("2025-12-31T23:59:59.000Z");
                },
            });
        });

        it("transforms Number list items", () => {
            const testSchema = schema({
                prices: schema.LoroList(
                    schema.Number().transform(currencyTransform),
                    (p) => p,
                ),
            });

            const prices = ["$9.99", "$14.99", "$29.99"];

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ prices });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.prices).toHaveLength(3);
                    expect(state.prices[0]).toBe("$9.99");
                    expect(state.prices[1]).toBe("$14.99");
                    expect(state.prices[2]).toBe("$29.99");

                    const pricesList = doc.getList("prices");
                    expect(pricesList.get(0)).toBe(999);
                    expect(pricesList.get(1)).toBe(1499);
                    expect(pricesList.get(2)).toBe(2999);
                },
            });
        });

        it("transforms Boolean list items", () => {
            const testSchema = schema({
                statuses: schema.LoroList(
                    schema.Boolean().transform(statusTransform),
                    (s) => s,
                ),
            });

            const statuses: Status[] = ["active", "inactive", "active"];

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ statuses });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.statuses).toHaveLength(3);
                    expect(state.statuses[0]).toBe("active");
                    expect(state.statuses[1]).toBe("inactive");
                    expect(state.statuses[2]).toBe("active");

                    const statusList = doc.getList("statuses");
                    expect(statusList.get(0)).toBe(true);
                    expect(statusList.get(1)).toBe(false);
                    expect(statusList.get(2)).toBe(true);
                },
            });
        });

        it("Map items with in-place update", () => {
            const testSchema = schema({
                events: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        name: schema.String(),
                        scheduledAt: schema.String().transform(dateTransform),
                    }),
                    (e) => e.id,
                ),
            });

            const newDate = new Date("2025-07-04T20:00:00.000Z");

            // This test exercises in-place update so needs sequential setState calls.
            const doc = new LoroDoc();
            const mirror = new Mirror({ doc, schema: testSchema });
            const eventDate = new Date("2025-07-04T18:00:00.000Z");

            mirror.setState({
                events: [
                    { id: "evt-1", name: "Event 1", scheduledAt: eventDate },
                ],
            });

            mirror.setState({
                events: [
                    {
                        id: "evt-1",
                        name: "Event 1 Updated",
                        scheduledAt: newDate,
                    },
                ],
            });

            const state = mirror.getState();
            expect(state.events[0].scheduledAt).toBeInstanceOf(Date);
            expect(state.events[0].scheduledAt.getTime()).toBe(
                newDate.getTime(),
            );
            expect(state.events[0].name).toBe("Event 1 Updated");
        });

        it("reorder preserves transforms", () => {
            const testSchema = schema({
                tasks: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        dueAt: schema.String().transform(dateTransform),
                    }),
                    (t) => t.id,
                ),
            });

            const d1 = new Date("2025-01-01T00:00:00.000Z");
            const d2 = new Date("2025-02-01T00:00:00.000Z");
            const d3 = new Date("2025-03-01T00:00:00.000Z");

            // This test exercises reordering so needs sequential setState calls.
            const doc = new LoroDoc();
            const mirror = new Mirror({ doc, schema: testSchema });

            mirror.setState({
                tasks: [
                    { id: "a", dueAt: d1 },
                    { id: "b", dueAt: d2 },
                    { id: "c", dueAt: d3 },
                ],
            });

            mirror.setState({
                tasks: [
                    { id: "c", dueAt: d3 },
                    { id: "a", dueAt: d1 },
                    { id: "b", dueAt: d2 },
                ],
            });

            const state = mirror.getState();
            expect(state.tasks[0].id).toBe("c");
            expect(state.tasks[0].dueAt.getTime()).toBe(d3.getTime());
            expect(state.tasks[1].id).toBe("a");
            expect(state.tasks[1].dueAt.getTime()).toBe(d1.getTime());
            expect(state.tasks[2].id).toBe("b");
            expect(state.tasks[2].dueAt.getTime()).toBe(d2.getTime());
        });

        it("object domain items (Money)", () => {
            const testSchema = schema({
                prices: schema.LoroList(
                    schema.Number().transform(moneyTransform),
                    (m) => m.cents.toString(),
                ),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ prices: [new Money(999)] });
                },
                assertAfterInit: (state, doc) => {
                    const list = doc.getList("prices");
                    expect(list.get(0)).toBe(999);
                    expect(typeof list.get(0)).toBe("number");

                    expect(state.prices[0]).toBeInstanceOf(Money);
                    expect(state.prices[0].cents).toBe(999);
                },
                update: (mirror) => {
                    mirror.setState({
                        prices: [new Money(999), new Money(1499)],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    const list = doc.getList("prices");
                    expect(list.get(1)).toBe(1499);
                    expect(typeof list.get(1)).toBe("number");

                    expect(state.prices).toHaveLength(2);
                    expect(state.prices[1]).toBeInstanceOf(Money);
                    expect(state.prices[1].cents).toBe(1499);
                },
            });
        });
    });

    describe("MovableList (with idSelector)", () => {
        it("primitive items", () => {
            const testSchema = schema({
                timestamps: schema.LoroMovableList(
                    schema.String().transform(dateTransform),
                    (d) => d.toISOString(),
                ),
            });

            const dates = [
                new Date("2025-01-01T00:00:00.000Z"),
                new Date("2025-06-01T00:00:00.000Z"),
                new Date("2025-12-01T00:00:00.000Z"),
            ];

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ timestamps: dates });
                },
                assertAfterInit: (state) => {
                    expect(state.timestamps).toHaveLength(3);
                    expect(state.timestamps[0]).toBeInstanceOf(Date);
                    expect(state.timestamps[1]).toBeInstanceOf(Date);
                    expect(state.timestamps[2]).toBeInstanceOf(Date);
                },
            });
        });

        it("Map items with transformed fields", () => {
            const testSchema = schema({
                tasks: schema.LoroMovableList(
                    schema.LoroMap({
                        id: schema.String(),
                        dueDate: schema.String().transform(dateTransform),
                    }),
                    (item) => item.id,
                ),
            });

            const testDate = new Date("2025-04-20T14:00:00.000Z");
            const updatedDate = new Date("2025-08-15T10:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        tasks: [{ id: "task-1", dueDate: testDate }],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.tasks).toHaveLength(1);
                    expect(state.tasks[0].id).toBe("task-1");
                    expect(state.tasks[0].dueDate).toBeInstanceOf(Date);
                    expect(state.tasks[0].dueDate.getTime()).toBe(testDate.getTime());

                    const list = doc.getMovableList("tasks");
                    const itemMap = list.get(0) as LoroMap;
                    expect(itemMap.get("dueDate")).toBe("2025-04-20T14:00:00.000Z");
                    expect(typeof itemMap.get("dueDate")).toBe("string");
                },
                update: (mirror) => {
                    mirror.setState({
                        tasks: [{ id: "task-1", dueDate: updatedDate }],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.tasks[0].dueDate).toBeInstanceOf(Date);
                    expect(state.tasks[0].dueDate.getTime()).toBe(updatedDate.getTime());

                    const list = doc.getMovableList("tasks");
                    const itemMap = list.get(0) as LoroMap;
                    expect(itemMap.get("dueDate")).toBe("2025-08-15T10:00:00.000Z");
                },
            });
        });

        it("reorder preserves transforms", () => {
            const testSchema = schema({
                items: schema.LoroMovableList(
                    schema.LoroMap({
                        id: schema.String(),
                        date: schema.String().transform(dateTransform),
                    }),
                    (item) => item.id,
                ),
            });

            const date1 = new Date("2025-01-01T00:00:00.000Z");
            const date2 = new Date("2025-02-01T00:00:00.000Z");

            // This test exercises reordering so needs sequential setState calls.
            const doc = new LoroDoc();
            const mirror = new Mirror({ doc, schema: testSchema });

            mirror.setState({
                items: [
                    { id: "a", date: date1 },
                    { id: "b", date: date2 },
                ],
            });

            mirror.setState({
                items: [
                    { id: "b", date: date2 },
                    { id: "a", date: date1 },
                ],
            });

            const list = doc.getMovableList("items");
            const first = list.get(0) as LoroMap;
            const second = list.get(1) as LoroMap;
            expect(first.get("date")).toBe("2025-02-01T00:00:00.000Z");
            expect(second.get("date")).toBe("2025-01-01T00:00:00.000Z");

            const state = mirror.getState();
            expect(state.items[0].date).toBeInstanceOf(Date);
            expect(state.items[1].date).toBeInstanceOf(Date);
        });

        it("object domain items (Money)", () => {
            const testSchema = schema({
                prices: schema.LoroMovableList(
                    schema.Number().transform(moneyTransform),
                    (m) => m.cents.toString(),
                ),
            });

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ prices: [new Money(999)] });
                },
                assertAfterInit: (state, doc) => {
                    const list = doc.getMovableList("prices");
                    expect(list.get(0)).toBe(999);
                    expect(typeof list.get(0)).toBe("number");

                    expect(state.prices[0]).toBeInstanceOf(Money);
                    expect(state.prices[0].cents).toBe(999);
                },
                update: (mirror) => {
                    mirror.setState({
                        prices: [new Money(999), new Money(1499)],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    const list = doc.getMovableList("prices");
                    expect(list.get(1)).toBe(1499);
                    expect(typeof list.get(1)).toBe("number");

                    expect(state.prices).toHaveLength(2);
                    expect(state.prices[1]).toBeInstanceOf(Money);
                    expect(state.prices[1].cents).toBe(1499);
                },
            });
        });
    });

    describe("MovableList (no idSelector)", () => {
        it("primitive items", () => {
            const testSchema = schema({
                timestamps: schema.LoroMovableList(
                    schema.String().transform(dateTransform),
                    undefined as any,
                ),
            });

            const dates = [
                new Date("2025-01-01T00:00:00.000Z"),
                new Date("2025-06-01T00:00:00.000Z"),
                new Date("2025-12-01T00:00:00.000Z"),
            ];

            const changedDate = new Date("2025-09-01T00:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({ timestamps: dates });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.timestamps).toHaveLength(3);
                    expect(state.timestamps[0]).toBeInstanceOf(Date);
                    expect(state.timestamps[1]).toBeInstanceOf(Date);
                    expect(state.timestamps[2]).toBeInstanceOf(Date);
                    expect(state.timestamps[0].getTime()).toBe(dates[0].getTime());
                    expect(state.timestamps[1].getTime()).toBe(dates[1].getTime());
                    expect(state.timestamps[2].getTime()).toBe(dates[2].getTime());

                    const list = doc.getMovableList("timestamps");
                    expect(list.get(0)).toBe("2025-01-01T00:00:00.000Z");
                    expect(list.get(1)).toBe("2025-06-01T00:00:00.000Z");
                    expect(list.get(2)).toBe("2025-12-01T00:00:00.000Z");
                },
                update: (mirror) => {
                    mirror.setState({
                        timestamps: [dates[0], changedDate, dates[2]],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.timestamps[1]).toBeInstanceOf(Date);
                    expect(state.timestamps[1].getTime()).toBe(changedDate.getTime());

                    const list = doc.getMovableList("timestamps");
                    expect(list.get(1)).toBe("2025-09-01T00:00:00.000Z");
                },
            });
        });

        it("Map items with transformed fields", () => {
            const testSchema = schema({
                tasks: schema.LoroMovableList(
                    schema.LoroMap({
                        id: schema.String(),
                        dueDate: schema.String().transform(dateTransform),
                    }),
                    undefined as any,
                ),
            });

            const testDate = new Date("2025-04-20T14:00:00.000Z");
            const updatedDate = new Date("2025-08-10T09:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        tasks: [{ id: "task-1", dueDate: testDate }],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.tasks).toHaveLength(1);
                    expect(state.tasks[0].id).toBe("task-1");
                    expect(state.tasks[0].dueDate).toBeInstanceOf(Date);
                    expect(state.tasks[0].dueDate.getTime()).toBe(testDate.getTime());

                    const list = doc.getMovableList("tasks");
                    const itemMap = list.get(0) as LoroMap;
                    expect(itemMap.get("dueDate")).toBe("2025-04-20T14:00:00.000Z");
                },
                update: (mirror) => {
                    mirror.setState({
                        tasks: [{ id: "task-1", dueDate: updatedDate }],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.tasks[0].dueDate).toBeInstanceOf(Date);
                    expect(state.tasks[0].dueDate.getTime()).toBe(updatedDate.getTime());

                    const list = doc.getMovableList("tasks");
                    const itemMap = list.get(0) as LoroMap;
                    expect(itemMap.get("dueDate")).toBe("2025-08-10T09:00:00.000Z");
                },
            });
        });
    });

    describe("Tree", () => {
        it("node data with transformed fields", () => {
            const testSchema = schema({
                tree: schema.LoroTree(
                    schema.LoroMap({
                        title: schema.String(),
                        createdAt: schema.String().transform(dateTransform),
                    }),
                ),
            });

            const testDate = new Date("2025-01-19T10:00:00.000Z");
            const updatedDate = new Date("2025-06-15T12:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        tree: [
                            {
                                id: "",
                                data: {
                                    title: "Root Node",
                                    createdAt: testDate,
                                },
                                children: [],
                            },
                        ],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.tree).toHaveLength(1);
                    expect(state.tree[0].data.title).toBe("Root Node");
                    expect(state.tree[0].data.createdAt).toBeInstanceOf(Date);
                    expect(state.tree[0].data.createdAt.getTime()).toBe(
                        testDate.getTime(),
                    );

                    const tree = doc.getTree("tree");
                    const roots = tree.roots();
                    expect(roots).toHaveLength(1);
                    expect(roots[0].data.get("createdAt")).toBe(
                        "2025-01-19T10:00:00.000Z",
                    );
                },
                update: (mirror) => {
                    const currentState = mirror.getState();
                    mirror.setState({
                        tree: [
                            {
                                id: currentState.tree[0].id,
                                data: {
                                    title: "Root Node",
                                    createdAt: updatedDate,
                                },
                                children: [],
                            },
                        ],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.tree[0].data.createdAt).toBeInstanceOf(Date);
                    expect(state.tree[0].data.createdAt.getTime()).toBe(
                        updatedDate.getTime(),
                    );

                    const tree = doc.getTree("tree");
                    expect(tree.roots()[0].data.get("createdAt")).toBe(
                        "2025-06-15T12:00:00.000Z",
                    );
                },
            });
        });

        it("nested nodes with transforms", () => {
            const testSchema = schema({
                tree: schema.LoroTree(
                    schema.LoroMap({
                        name: schema.String(),
                        timestamp: schema.String().transform(dateTransform),
                    }),
                ),
            });

            const parentDate = new Date("2025-01-01T00:00:00.000Z");
            const childDate = new Date("2025-06-15T12:00:00.000Z");
            const newChildDate = new Date("2025-09-20T08:30:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        tree: [
                            {
                                id: "",
                                data: { name: "Parent", timestamp: parentDate },
                                children: [
                                    {
                                        id: "",
                                        data: {
                                            name: "Child",
                                            timestamp: childDate,
                                        },
                                        children: [],
                                    },
                                ],
                            },
                        ],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.tree[0].data.timestamp).toBeInstanceOf(Date);
                    expect(state.tree[0].children[0].data.timestamp).toBeInstanceOf(
                        Date,
                    );
                    expect(state.tree[0].data.timestamp.getTime()).toBe(
                        parentDate.getTime(),
                    );
                    expect(state.tree[0].children[0].data.timestamp.getTime()).toBe(
                        childDate.getTime(),
                    );

                    const tree = doc.getTree("tree");
                    const roots = tree.roots();
                    expect(roots[0].data.get("timestamp")).toBe(
                        "2025-01-01T00:00:00.000Z",
                    );
                    const children = roots[0].children();
                    expect(children).toBeDefined();
                    expect(children!.length).toBeGreaterThan(0);
                    expect(children![0].data.get("timestamp")).toBe(
                        "2025-06-15T12:00:00.000Z",
                    );
                },
                update: (mirror) => {
                    const state = mirror.getState();
                    mirror.setState({
                        tree: [
                            {
                                id: state.tree[0].id,
                                data: {
                                    name: "Parent",
                                    timestamp: parentDate,
                                },
                                children: [
                                    {
                                        id: state.tree[0].children[0].id,
                                        data: {
                                            name: "Child Updated",
                                            timestamp: newChildDate,
                                        },
                                        children: [],
                                    },
                                ],
                            },
                        ],
                    });
                },
                assertAfterUpdate: (state, doc) => {
                    expect(state.tree[0].children[0].data.name).toBe(
                        "Child Updated",
                    );
                    expect(
                        state.tree[0].children[0].data.timestamp.getTime(),
                    ).toBe(newChildDate.getTime());
                    expect(state.tree[0].data.timestamp.getTime()).toBe(
                        parentDate.getTime(),
                    );

                    const tree = doc.getTree("tree");
                    const roots = tree.roots();
                    const children = roots[0].children();
                    expect(children![0].data.get("timestamp")).toBe(
                        "2025-09-20T08:30:00.000Z",
                    );
                },
            });
        });
    });

    describe("Nested containers", () => {
        it("3-level nested maps with transforms at each level", () => {
            const testSchema = schema({
                outer: schema.LoroMap({
                    outerDate: schema.String().transform(dateTransform),
                    inner: schema.LoroMap({
                        innerDate: schema.String().transform(dateTransform),
                        deepInner: schema.LoroMap({
                            deepDate: schema.String().transform(dateTransform),
                        }),
                    }),
                }),
            });

            const d1 = new Date("2025-01-01T00:00:00.000Z");
            const d2 = new Date("2025-06-01T00:00:00.000Z");
            const d3 = new Date("2025-12-01T00:00:00.000Z");
            const d4 = new Date("2025-09-15T18:30:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        outer: {
                            outerDate: d1,
                            inner: {
                                innerDate: d2,
                                deepInner: {
                                    deepDate: d3,
                                },
                            },
                        },
                    });
                },
                assertAfterInit: (state) => {
                    expect(state.outer.outerDate).toBeInstanceOf(Date);
                    expect(state.outer.inner.innerDate).toBeInstanceOf(Date);
                    expect(state.outer.inner.deepInner.deepDate).toBeInstanceOf(Date);
                    expect(state.outer.outerDate.getTime()).toBe(d1.getTime());
                    expect(state.outer.inner.innerDate.getTime()).toBe(d2.getTime());
                    expect(state.outer.inner.deepInner.deepDate.getTime()).toBe(
                        d3.getTime(),
                    );
                },
                update: (mirror) => {
                    mirror.setState({
                        outer: {
                            outerDate: d1,
                            inner: {
                                innerDate: d2,
                                deepInner: {
                                    deepDate: d4,
                                },
                            },
                        },
                    });
                },
                assertAfterUpdate: (state) => {
                    expect(state.outer.inner.deepInner.deepDate.getTime()).toBe(
                        d4.getTime(),
                    );
                    expect(state.outer.outerDate.getTime()).toBe(d1.getTime());
                    expect(state.outer.inner.innerDate.getTime()).toBe(
                        d2.getTime(),
                    );
                },
            });
        });

        it("list within map within list", () => {
            const testSchema = schema({
                groups: schema.LoroList(
                    schema.LoroMap({
                        name: schema.String(),
                        events: schema.LoroList(
                            schema.LoroMap({
                                title: schema.String(),
                                when: schema.String().transform(dateTransform),
                            }),
                        ),
                    }),
                ),
            });

            const eventDate = new Date("2025-07-04T20:00:00.000Z");

            assertRoundtrip({
                schema: testSchema,
                init: (mirror) => {
                    mirror.setState({
                        groups: [
                            {
                                name: "Summer Events",
                                events: [{ title: "Fireworks", when: eventDate }],
                            },
                        ],
                    });
                },
                assertAfterInit: (state, doc) => {
                    expect(state.groups[0].events[0].when).toBeInstanceOf(Date);
                    expect(state.groups[0].events[0].when.getTime()).toBe(
                        eventDate.getTime(),
                    );

                    const groupsList = doc.getList("groups");
                    const groupMap = groupsList.get(0) as LoroMap;
                    const eventsList = groupMap.get("events") as unknown;
                    const eventsContainer = eventsList as {
                        get(i: number): LoroMap;
                    };
                    const eventMap = eventsContainer.get(0);
                    expect(eventMap.get("when")).toBe("2025-07-04T20:00:00.000Z");
                },
                update: (mirror) => {
                    const eventDate2 = new Date("2025-07-05T10:00:00.000Z");
                    mirror.setState({
                        groups: [
                            {
                                name: "Summer Events",
                                events: [
                                    { title: "Fireworks", when: eventDate },
                                    { title: "BBQ", when: eventDate2 },
                                ],
                            },
                        ],
                    });
                },
                assertAfterUpdate: (state) => {
                    expect(state.groups[0].events).toHaveLength(2);
                    expect(state.groups[0].events[1].when).toBeInstanceOf(Date);
                    expect(state.groups[0].events[1].title).toBe("BBQ");
                },
            });
        });
    });

    describe("Pre-populated doc with initialState", () => {
        it("decodes transforms when Mirror is created with both a pre-populated doc and initialState (nested maps in list)", () => {
            const testSchema = schema({
                items: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        createdAt: schema.String().transform(dateTransform),
                    }),
                ),
            });

            type State = InferType<typeof testSchema>;

            const defaultState: State = { items: [] };

            // Step 1: Populate a doc via a mirror
            const doc1 = new LoroDoc();
            const mirror1 = new Mirror({ doc: doc1, schema: testSchema });
            const testDate = new Date("2024-05-10T00:00:00.000Z");
            mirror1.setState({
                items: [{ id: "txn-1", createdAt: testDate }],
            });

            // Verify mirror1 works correctly
            const state1 = mirror1.getState();
            expect(state1.items[0].createdAt).toBeInstanceOf(Date);

            // Step 2: Export and import into a new doc 
            const doc2 = new LoroDoc();
            doc2.import(doc1.export({ mode: "snapshot" }));

            // Step 3: Create a new mirror with BOTH pre-populated doc AND initialState
            const mirror2 = new Mirror({
                doc: doc2,
                schema: testSchema,
                initialState: defaultState,
            });

            const state2 = mirror2.getState();

            expect(state2.items[0].createdAt).toBeInstanceOf(Date);
            expect(state2.items[0].createdAt.getTime()).toBe(testDate.getTime());
        });

        it("decodes transforms when Mirror is created with both a pre-populated doc and initialState (flat map)", () => {
            const testSchema = schema({
                record: schema.LoroMap({
                    name: schema.String(),
                    createdAt: schema.String().transform(dateTransform),
                }),
            });

            type State = InferType<typeof testSchema>;

            const defaultState = {
                record: { name: "", createdAt: new Date(0) },
            } as unknown as State;

            // Populate a doc
            const doc1 = new LoroDoc();
            const mirror1 = new Mirror({ doc: doc1, schema: testSchema });
            const testDate = new Date("2025-03-15T08:30:00.000Z");
            mirror1.setState({
                record: { name: "Test", createdAt: testDate },
            });

            // Export and import
            const doc2 = new LoroDoc();
            doc2.import(doc1.export({ mode: "snapshot" }));

            // Create mirror with both doc and initialState
            const mirror2 = new Mirror({
                doc: doc2,
                schema: testSchema,
                initialState: defaultState,
            });

            const state2 = mirror2.getState();
            expect(state2.record.createdAt).toBeInstanceOf(Date);
            expect(state2.record.createdAt.getTime()).toBe(testDate.getTime());
            expect(state2.record.name).toBe("Test");
        });

        it("decodes transforms for object domain types with pre-populated doc and initialState", () => {
            const testSchema = schema({
                prices: schema.LoroList(
                    schema.Number().transform(moneyTransform),
                ),
            });

            type State = InferType<typeof testSchema>;
            const defaultState: State = { prices: [] };

            // Populate
            const doc1 = new LoroDoc();
            const mirror1 = new Mirror({ doc: doc1, schema: testSchema });
            mirror1.setState({ prices: [new Money(999), new Money(1499)] });

            // Export/import
            const doc2 = new LoroDoc();
            doc2.import(doc1.export({ mode: "snapshot" }));

            // Create with both doc and initialState
            const mirror2 = new Mirror({
                doc: doc2,
                schema: testSchema,
                initialState: defaultState,
            });

            const state2 = mirror2.getState();
            expect(state2.prices).toHaveLength(2);
            expect(state2.prices[0]).toBeInstanceOf(Money);
            expect(state2.prices[0].cents).toBe(999);
            expect(state2.prices[1]).toBeInstanceOf(Money);
            expect(state2.prices[1].cents).toBe(1499);
        });

        it("works correctly without initialState (control case)", () => {
            const testSchema = schema({
                items: schema.LoroList(
                    schema.LoroMap({
                        id: schema.String(),
                        createdAt: schema.String().transform(dateTransform),
                    }),
                ),
            });

            // Populate
            const doc1 = new LoroDoc();
            const mirror1 = new Mirror({ doc: doc1, schema: testSchema });
            const testDate = new Date("2024-05-10T00:00:00.000Z");
            mirror1.setState({
                items: [{ id: "txn-1", createdAt: testDate }],
            });

            // Export/import
            const doc2 = new LoroDoc();
            doc2.import(doc1.export({ mode: "snapshot" }));

            // Create mirror with ONLY the pre-populated doc (no initialState)
            const mirror2 = new Mirror({ doc: doc2, schema: testSchema });

            const state2 = mirror2.getState();
            expect(state2.items[0].createdAt).toBeInstanceOf(Date);
            expect(state2.items[0].createdAt.getTime()).toBe(testDate.getTime());
        });
    });
});
