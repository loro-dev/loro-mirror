import { act, renderHook } from '@testing-library/react';
import { useAtom } from 'jotai';
import { LoroDoc } from 'loro-crdt';
import { schema } from 'loro-mirror';
import { afterEach, describe, expect, it } from 'vitest';
import { loroMirrorAtom } from '../src';

// Helper to wait for Jotai state propagation
const waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('loro-mirror-jotai', () => {
    // Clear store cache after each test to ensure isolation
    afterEach(() => {
        const doc = new LoroDoc();
        const testAtom = loroMirrorAtom({ doc, schema: schema({}) });
        const { unmount } = renderHook(() => useAtom(testAtom));
        unmount();
    });

    it('should initialize with initial state', () => {
        const doc = new LoroDoc();
        const testSchema = schema({ text: schema.LoroText() });
        const testAtom = loroMirrorAtom({
            doc,
            schema: testSchema,
            initialState: { text: '' },
        });

        const { result } = renderHook(() => useAtom(testAtom));
        expect(result.current[0]).toEqual({ text: '' });
    });

    it('should update loro doc when atom state changes', async () => {
        const doc = new LoroDoc();
        const testSchema = schema({ text: schema.LoroText() });
        const testAtom = loroMirrorAtom({
            doc,
            schema: testSchema,
            initialState: { text: '' },
        });

        const { result } = renderHook(() => useAtom(testAtom));

        await act(async () => {
            result.current[1]({ text: 'hello' });
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
});
