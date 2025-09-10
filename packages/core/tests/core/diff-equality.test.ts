import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { diffContainer } from "../../src/core/diff";
import { schema } from "../../src/schema";

describe("diffMap equality for falsy primitives", () => {
    it("does not emit changes when string field stays ''", () => {
        const doc = new LoroDoc();
        // Ensure the container exists (name must match schema field)
        doc.getMap("profile");

        const rootSchema = schema({
            profile: schema.LoroMap({
                bio: schema.String(),
            }),
        });

        const oldState = { profile: { bio: "" } } as const;
        const newState = { profile: { bio: "" } } as const;

        const changes = diffContainer(doc, oldState, newState, "", rootSchema);
        expect(changes.length).toBe(0);
    });

    it("does not emit changes when field stays null", () => {
        const doc = new LoroDoc();
        doc.getMap("profile");

        const rootSchema = schema({
            profile: schema.LoroMap({
                note: schema.String(),
            }),
        });

        const oldState = { profile: { note: null } } as const;
        const newState = { profile: { note: null } } as const;

        const changes = diffContainer(doc, oldState, newState, "", rootSchema);
        expect(changes.length).toBe(0);
    });
});

