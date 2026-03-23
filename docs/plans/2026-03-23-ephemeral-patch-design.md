# Design: `setStateWithEphemeralPatch`

Issue: https://github.com/loro-dev/loro-mirror/issues/35

## Problem

When users drag or scale canvas elements, syncing every intermediate state through LoroDoc pollutes the editing history with redundant operations. We need real-time sync of temporary states without the history cost.

## Solution

Combine LoroDoc with `EphemeralStore` (from `loro-crdt`). Temporary state changes go through the ephemeral channel for real-time sync, and only commit to LoroDoc after a debounced timeout.

## Design Decisions

| Decision | Choice |
|---|---|
| EphemeralStore source | `loro-crdt` built-in module |
| Patch structure | Simple value only (`{ x: 100, y: 200 }`), no lastOp/baseValue |
| Conflict handling | Remote can directly overwrite EphemeralStore; on finalize, only commit values written by local peer |
| Scope | Map key-level primitive modifications only |
| Non-Map / new-key / new-Map changes | Go directly to LoroDoc |
| Finalize behavior | Write to LoroDoc + clear patch; debounce on repeated calls |
| State composition | `this.state` = base + ephemeral overlay; internal `baseState` tracks pure LoroDoc state |
| Network sync | Not Mirror's responsibility; Mirror subscribes to EphemeralStore for remote patches |
| SyncDirection | New `FROM_EPHEMERAL` variant |
| Default finalizeTimeout | 50,000ms |

## Data Model

### EphemeralStore Patch Structure

Each ContainerID is a key in the EphemeralStore. The value is a map of field-level values:

```json
{
  "x": 100,
  "y": 200
}
```

No lastOp or baseValue tracking. The EphemeralStore is plain LWW — remote peers can overwrite values directly.

### Local Tracking

Mirror internally maintains `localEphemeralValues: Map<string, Record<string, unknown>>` (keyed by ContainerID) to track what the local peer last wrote to EphemeralStore. On finalize, only values that still match `localEphemeralValues` are committed to LoroDoc. This prevents:
- Patching stale values when remote peer has overwritten
- Duplicate commits from multiple peers

### State Composition

`this.state` is always the composed state (base + ephemeral overlay). Mirror maintains a separate `this.baseState` for the pure LoroDoc state.

Composition simply overlays all EphemeralStore values on top of baseState for matching ContainerID + key pairs.

## Change Classification

When `setStateWithEphemeralPatch` is called, Mirror diffs the state and classifies each change:

**Goes to EphemeralStore (all conditions must be met):**
- Change kind is `set` (not `insert`/`delete`/`move`/`tree-*`/`set-container`)
- Target container is an existing Map (ContainerID is non-empty)
- Key already exists on that Map
- Value is primitive (not a container type)

**Goes directly to LoroDoc:**
- New Map creation, new key addition
- List/MovableList/Text/Tree operations
- `set-container` (value is a nested container)

## API

### MirrorOptions

```ts
interface MirrorOptions<S> {
  // ... existing options
  ephemeralStore?: EphemeralStore;
}
```

### New Methods on Mirror

```ts
// Same overload signatures as setState
setStateWithEphemeralPatch(
  updater: ((state: InferType<S>) => void) | Partial<InferInputType<S>>,
  options?: SetStateOptions & { finalizeTimeout?: number }
): void;

// Immediately finalize all pending ephemeral patches
finalizeEphemeralPatches(): void;
```

### New SyncDirection

```ts
enum SyncDirection {
  FROM_LORO = "FROM_LORO",
  TO_LORO = "TO_LORO",
  BIDIRECTIONAL = "BIDIRECTIONAL",
  FROM_EPHEMERAL = "FROM_EPHEMERAL",  // new
}
```

## Flow

### `setStateWithEphemeralPatch` Call

```
1. Calculate newState via Immer (same as setState)
2. Diff newState vs current baseState -> list of changes
3. Classify changes:
   a. Ephemeral-eligible -> store value in EphemeralStore, record in localEphemeralValues
   b. Non-eligible -> apply to LoroDoc directly (doc.commit())
4. Update this.baseState for LoroDoc changes
5. Compose this.state = baseState + ephemeral overlay
6. Reset debounce timer (finalizeTimeout, default 50s)
7. Notify subscribers
```

### Finalize (timeout or manual)

```
1. For each entry in localEphemeralValues:
   a. Read current value from EphemeralStore
   b. If it matches localEphemeralValues -> write to LoroDoc
   c. If it doesn't match -> skip (remote peer overwrote)
2. doc.commit()
3. Delete finalized keys from EphemeralStore
4. Clear localEphemeralValues
5. Update baseState from LoroDoc
6. Recompose this.state (no more local overlay for finalized keys)
7. Notify subscribers
```

### FROM_LORO Event (remote LoroDoc change)

```
1. Update baseState as usual (existing handleLoroEvent logic)
2. Recompose this.state = baseState + ephemeral overlay
3. Notify subscribers (SyncDirection.FROM_LORO)
```

### Remote Ephemeral Patch (via EphemeralStore.subscribe)

```
1. EphemeralStore already has the new data
2. Recompose this.state = baseState + ephemeral overlay
3. Notify subscribers (SyncDirection.FROM_EPHEMERAL)
```

## Usage Example

```ts
const doc = new LoroDoc();
const eph = new EphemeralStore();
const m = new Mirror({
  doc,
  ephemeralStore: eph,
  schema: mySchema,
});

// Network sync for ephemeral (user's responsibility)
eph.subscribeLocalUpdates((bytes) => channel.send(bytes));
channel.on("ephemeral", (bytes) => eph.apply(bytes));

// Drag operation - temporary state
m.setStateWithEphemeralPatch(
  (s) => { s.items[5].x = 100; s.items[5].y = 200; },
  { finalizeTimeout: 1_000 }
);

// Or manually finalize
m.finalizeEphemeralPatches();
```

## Implementation Plan

### Step 1: Internal state split
- Add `baseState` field to Mirror
- Modify `handleLoroEvent` to update `baseState`
- Add `composeState()` method (initially just returns baseState)
- Ensure `this.state` is always produced by `composeState()`

### Step 2: Ephemeral patch storage
- Accept `ephemeralStore` in MirrorOptions
- Add `localEphemeralValues` map for tracking local writes
- Implement `composeState()` with ephemeral overlay
- Subscribe to EphemeralStore for remote changes

### Step 3: `setStateWithEphemeralPatch`
- Implement change classification (ephemeral-eligible vs LoroDoc)
- Write eligible changes to EphemeralStore + localEphemeralValues
- Write non-eligible changes to LoroDoc
- Debounce timer management

### Step 4: Finalize
- Implement `finalizeEphemeralPatches()`
- Implement timeout-triggered finalize
- Local value match check on finalize

### Step 5: SyncDirection.FROM_EPHEMERAL
- Add new enum variant
- Wire up EphemeralStore subscribe -> recompose -> notify

### Step 6: Tests
- Basic ephemeral patch set and compose
- Change classification (Map primitive vs other)
- Debounce timer behavior
- Finalize writes to LoroDoc
- Finalize skips remote-overwritten values
- Remote ephemeral patch integration
- Mixed changes (some ephemeral, some LoroDoc)

### Step 7: dispose() cleanup
- Clear debounce timer
- Unsubscribe from EphemeralStore
- Clear localEphemeralValues
