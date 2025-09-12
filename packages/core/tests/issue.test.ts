import { it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Mirror, schema } from "../src/";

it("Applying remote event then calling setState immediately may cause an event apply order issue", async () => {
    const docA = new LoroDoc();
    const docB = new LoroDoc();
    docA.getText("t").update("Hello");
    docB.import(docA.export({ mode: "snapshot" }));
    const m = new Mirror({
        doc: docA,
        schema: schema({
            t: schema.LoroText(),
        }),
    });

    docB.getText("t").push(" ABC!");
    docA.import(docB.export({ mode: "update" }));
    await m.setState({ t: "" });
    await Promise.resolve();
    expect(m.getState()).toStrictEqual(docA.toJSON());
});
