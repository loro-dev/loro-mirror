import { act, renderHook } from '@testing-library/react';
import { useAtom } from 'jotai';
import { LoroDoc } from 'loro-crdt';
import { schema } from 'loro-mirror';
import { afterEach, describe, expect, it } from 'vitest';
import { loroMirrorAtom, useLoroMirror } from '../src';

// Helper to wait for Jotai state propagation
const waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('loro-mirror-jotai', () => {
    // Clear store cache after each test to ensure isolation
    afterEach(() => {
        const doc = new LoroDoc();
        const testAtom = loroMirrorAtom({ doc, schema: schema({}), key: 'test-cleanup' });
        const { unmount } = renderHook(() => useAtom(testAtom));
        unmount();
    });

    it('should initialize with initial state', () => {
        const doc = new LoroDoc();
        const testSchema = schema({ text: schema.LoroText() });
        const testAtom = loroMirrorAtom({
            doc,
            schema: testSchema,
            key: 'test-init',
            initialState: { text: 'hello' },
        });

        const { result } = renderHook(() => useAtom(testAtom));
        expect(result.current[0]).toEqual({ text: 'hello' });
    });

    it('should update loro doc when atom state changes', async () => {
        const doc = new LoroDoc();
        const testSchema = schema({ text: schema.LoroText() });
        const testAtom = loroMirrorAtom({
            doc,
            schema: testSchema,
            key: 'test-atom-to-loro',
            initialState: { text: '' },
        });

        const { result } = renderHook(() => useAtom(testAtom));

        act(() => {
            result.current[1]({ text: 'hello' });
        });

        await act(async () => {
            await waitFor(50);
        });

        expect(result.current[0]).toEqual({ text: 'hello' });
        const loroText = doc.getText('text');
        expect(loroText.toString()).toBe('hello');
    });

    it('should update atom state when loro doc changes', async () => {
        const doc = new LoroDoc();
        const testSchema = schema({ text: schema.LoroText() });
        const testAtom = loroMirrorAtom({
            doc,
            schema: testSchema,
            key: 'test-loro-to-atom',
            initialState: { text: '' },
        });
        const loroText = doc.getText('text');

        const { result } = renderHook(() => useAtom(testAtom));

        act(() => {
            loroText.insert(0, 'hello');
            doc.commit();
        });

        await act(async () => {
            await waitFor(50);
        });

        expect(result.current[0]).toEqual({ text: 'hello' });
    });

    it('should share state between atoms with the same key', async () => {
        const doc = new LoroDoc();
        const testSchema = schema({
            map: schema.LoroMap({
                count: schema.Number()
            })
        });
        const config = {
            doc,
            schema: testSchema,
            key: 'shared-counter',
            initialState: { map: { count: 0 } },
        };

        const atom1 = loroMirrorAtom(config);
        const atom2 = loroMirrorAtom(config);

        const { result: result1 } = renderHook(() => useAtom(atom1));
        const { result: result2 } = renderHook(() => useAtom(atom2));

        act(() => {
            result1.current[1]((prev) => ({ map: { count: prev.map.count + 1 } }));
        });

        await act(async () => {
            await waitFor(50);
        });

        expect(result1.current[0].map.count).toBe(1);
        expect(result2.current[0].map.count).toBe(1);
    });

    describe('useLoroMirror', () => {
        it('should return the mirror instance for a given config', () => {
            const doc = new LoroDoc();
            const testSchema = schema({ text: schema.LoroText() });
            const config = {
                doc,
                schema: testSchema,
                key: 'mirror-test',
            };

            // First, initialize an atom to ensure the store and mirror are created
            const testAtom = loroMirrorAtom(config);
            renderHook(() => useAtom(testAtom));

            const { result } = renderHook(() => useLoroMirror(config));

            expect(result.current).not.toBeNull();
            expect(result.current?.getContainerIds).toBeInstanceOf(Function);
        });
    });
});
