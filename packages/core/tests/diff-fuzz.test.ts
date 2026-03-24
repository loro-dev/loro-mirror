import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
    diffListWithIdSelector,
    diffMovableList,
} from "../src/core/diff.js";
import type { Change } from "../src/core/mirror.js";

type Prng = () => number;

const makePrng = (seed: number): Prng => {
    let s = seed >>> 0;
    return () => {
        s = (1664525 * s + 1013904223) >>> 0;
        return s / 0x100000000;
    };
};

const shuffle = <T>(input: readonly T[], rand: Prng): T[] => {
    const arr = input.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const int = (rand: Prng, maxExclusive: number): number =>
    Math.floor(rand() * maxExclusive);

const lcsLength = <T>(a: readonly T[], b: readonly T[]): number => {
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
        Array.from({ length: m + 1 }, () => 0),
    );

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp[n][m];
};

const countKinds = (changes: readonly Change[]) => {
    let deletes = 0;
    let inserts = 0;
    let moves = 0;
    let sets = 0;
    for (const c of changes) {
        if (c.kind === "delete") deletes++;
        else if (c.kind === "insert" || c.kind === "insert-container") inserts++;
        else if (c.kind === "move") moves++;
        else if (c.kind === "set" || c.kind === "set-container") sets++;
        else {
            throw new Error(`Unexpected change kind: ${String(c.kind)}`);
        }
    }
    return { deletes, inserts, moves, sets };
};

const applyListLikeChanges = (oldState: unknown[], changes: readonly Change[]) => {
    const arr = oldState.slice();
    for (const c of changes) {
        if (c.kind === "delete") {
            const index = c.key;
            if (typeof index !== "number") {
                throw new Error(`Expected numeric key, got ${String(index)}`);
            }
            if (index < 0 || index >= arr.length) {
                throw new Error(
                    `Delete index out of bounds: ${index} (len=${arr.length})`,
                );
            }
            arr.splice(index, 1);
            continue;
        }

        if (c.kind === "insert" || c.kind === "insert-container") {
            const index = c.key;
            if (typeof index !== "number") {
                throw new Error(`Expected numeric key, got ${String(index)}`);
            }
            if (index < 0 || index > arr.length) {
                throw new Error(
                    `Insert index out of bounds: ${index} (len=${arr.length})`,
                );
            }
            arr.splice(index, 0, c.value);
            continue;
        }

        if (c.kind === "move") {
            const fromIndex = c.fromIndex;
            const toIndex = c.toIndex;
            if (fromIndex < 0 || fromIndex >= arr.length) {
                throw new Error(
                    `Move fromIndex out of bounds: ${fromIndex} (len=${arr.length})`,
                );
            }
            const [moved] = arr.splice(fromIndex, 1);
            if (toIndex < 0 || toIndex > arr.length) {
                throw new Error(
                    `Move toIndex out of bounds: ${toIndex} (len=${arr.length})`,
                );
            }
            arr.splice(toIndex, 0, moved);
            continue;
        }

        if (c.kind === "set" || c.kind === "set-container") {
            const index = c.key;
            if (typeof index !== "number") {
                throw new Error(`Expected numeric key, got ${String(index)}`);
            }
            if (index < 0 || index >= arr.length) {
                throw new Error(
                    `Set index out of bounds: ${index} (len=${arr.length})`,
                );
            }
            arr[index] = c.value;
            continue;
        }

        throw new Error(`Unexpected change kind: ${String(c.kind)}`);
    }
    return arr;
};

describe("diff fuzz", () => {
    it("diffListWithIdSelector: fuzz correctness + minimal delete/insert counts", () => {
        const rand = makePrng(0xdecafbad);
        const pool = Array.from({ length: 80 }, (_, i) => `id:${i}`);

        const ROUNDS = 300;
        for (let round = 0; round < ROUNDS; round++) {
            const oldLen = int(rand, 25);
            const newLen = int(rand, 25);
            const overlap = Math.min(int(rand, 25), Math.min(oldLen, newLen));

            const shuffled = shuffle(pool, rand);
            const overlapIds = shuffled.slice(0, overlap);
            const oldOnlyIds = shuffled.slice(overlap, overlap + (oldLen - overlap));
            const newOnlyIds = shuffled.slice(
                overlap + (oldLen - overlap),
                overlap + (oldLen - overlap) + (newLen - overlap),
            );

            const oldState = shuffle([...overlapIds, ...oldOnlyIds], rand);
            const newState = shuffle([...overlapIds, ...newOnlyIds], rand);

            const doc = new LoroDoc();
            const containerId = doc.getList("list").id;

            const changes = diffListWithIdSelector(
                doc,
                oldState,
                newState,
                containerId,
                undefined,
                (x) => (typeof x === "string" ? x : undefined),
            );

            const lcs = lcsLength(oldState, newState);
            const { deletes, inserts, moves, sets } = countKinds(changes);
            expect(moves).toBe(0);
            expect(sets).toBe(0);
            expect(deletes).toBe(oldState.length - lcs);
            expect(inserts).toBe(newState.length - lcs);

            const applied = applyListLikeChanges(oldState, changes);
            expect(applied).toEqual(newState);
        }
    });

    it("diffMovableList: fuzz correctness + minimal delete/insert/move counts", () => {
        const rand = makePrng(0x12345678);
        const pool = Array.from({ length: 120 }, (_, i) => `id:${i}`);

        const ROUNDS = 250;
        for (let round = 0; round < ROUNDS; round++) {
            const oldLen = int(rand, 40);
            const newLen = int(rand, 40);
            const overlap = Math.min(int(rand, 40), Math.min(oldLen, newLen));

            const shuffled = shuffle(pool, rand);
            const overlapIds = shuffled.slice(0, overlap);
            const oldOnlyIds = shuffled.slice(overlap, overlap + (oldLen - overlap));
            const newOnlyIds = shuffled.slice(
                overlap + (oldLen - overlap),
                overlap + (oldLen - overlap) + (newLen - overlap),
            );

            const oldState = shuffle([...overlapIds, ...oldOnlyIds], rand);
            const newState = shuffle([...overlapIds, ...newOnlyIds], rand);

            const doc = new LoroDoc();
            const containerId = doc.getMovableList("list").id;

            const changes = diffMovableList(
                doc,
                oldState,
                newState,
                containerId,
                undefined,
                (x) => (typeof x === "string" ? x : undefined),
            );

            const { deletes, inserts, moves, sets } = countKinds(changes);
            expect(deletes).toBe(oldState.length - overlap);
            expect(inserts).toBe(newState.length - overlap);
            expect(sets).toBe(0);

            const oldCommon = oldState.filter((x) => newState.includes(x));
            const newCommon = newState.filter((x) => oldState.includes(x));
            const commonLcs = lcsLength(oldCommon, newCommon);
            expect(moves).toBe(oldCommon.length - commonLcs);

            const applied = applyListLikeChanges(oldState, changes);
            expect(applied).toEqual(newState);
        }
    });

    it("diffMovableList: fuzz correctness + set count for payload updates", () => {
        const rand = makePrng(0x5eedf00d);
        const pool = Array.from({ length: 120 }, (_, i) => `id:${i}`);

        const ROUNDS = 250;
        for (let round = 0; round < ROUNDS; round++) {
            const oldLen = int(rand, 35);
            const newLen = int(rand, 35);
            const overlap = Math.min(int(rand, 35), Math.min(oldLen, newLen));

            const shuffled = shuffle(pool, rand);
            const overlapIds = shuffled.slice(0, overlap);
            const oldOnlyIds = shuffled.slice(overlap, overlap + (oldLen - overlap));
            const newOnlyIds = shuffled.slice(
                overlap + (oldLen - overlap),
                overlap + (oldLen - overlap) + (newLen - overlap),
            );

            const oldIds = shuffle([...overlapIds, ...oldOnlyIds], rand);
            const newIds = shuffle([...overlapIds, ...newOnlyIds], rand);

            const oldPayloadById = new Map<string, number>();
            const newPayloadById = new Map<string, number>();

            for (const id of oldIds) {
                oldPayloadById.set(id, int(rand, 1_000_000));
            }
            for (const id of newIds) {
                if (oldPayloadById.has(id) && rand() < 0.35) {
                    newPayloadById.set(id, int(rand, 1_000_000));
                } else if (oldPayloadById.has(id)) {
                    newPayloadById.set(id, oldPayloadById.get(id)!);
                } else {
                    newPayloadById.set(id, int(rand, 1_000_000));
                }
            }

            const oldState = oldIds.map((id) => `${id}|v:${oldPayloadById.get(id)!}`);
            const newState = newIds.map((id) => `${id}|v:${newPayloadById.get(id)!}`);

            const expectedSets = overlapIds.filter((id) => {
                const oldV = oldPayloadById.get(id);
                const newV = newPayloadById.get(id);
                return oldV != null && newV != null && oldV !== newV;
            }).length;

            const doc = new LoroDoc();
            const containerId = doc.getMovableList("list").id;

            const changes = diffMovableList(
                doc,
                oldState,
                newState,
                containerId,
                undefined,
                (x) => {
                    if (typeof x !== "string") return undefined;
                    const idx = x.indexOf("|");
                    return idx === -1 ? x : x.slice(0, idx);
                },
            );

            const { deletes, inserts, moves, sets } = countKinds(changes);
            expect(deletes).toBe(oldState.length - overlap);
            expect(inserts).toBe(newState.length - overlap);
            expect(sets).toBe(expectedSets);

            const oldCommonIds = oldIds.filter((x) => newPayloadById.has(x));
            const newCommonIds = newIds.filter((x) => oldPayloadById.has(x));
            const commonLcs = lcsLength(oldCommonIds, newCommonIds);
            expect(moves).toBe(oldCommonIds.length - commonLcs);

            const applied = applyListLikeChanges(oldState, changes);
            expect(applied).toEqual(newState);
        }
    });
});
