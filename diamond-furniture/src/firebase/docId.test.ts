import { describe, it, expect } from 'vitest';
import { safeDocId } from './docId';

describe('safeDocId — legal Firestore document IDs', () => {
  // The real bug: colours like "B.Gold/Spl" put a "/" in the key, which Firestore
  // rejects as a doc ID, making the whole import throw.
  const withSlash = [
    'XUV||8002 (Y)||B.Gold/Spl',
    'Activa||4001 (Cushion)||P.Blue/D. Blue',
    'EV Chair||201||P.Pink /White',
    'Garden Table||Garden Table||T.Wood/M.B',
  ];

  it('never contains a "/"', () => {
    for (const k of withSlash) expect(safeDocId(k)).not.toContain('/');
  });

  it('is never "." or ".." and never the reserved __…__ shape', () => {
    for (const k of ['.', '..', '__x__', 'a/b']) {
      const id = safeDocId(k);
      expect(id === '.' || id === '..').toBe(false);
      expect(/^__.*__$/.test(id)).toBe(false);
    }
  });

  it('is deterministic (same key → same id, so re-imports upsert)', () => {
    for (const k of withSlash) expect(safeDocId(k)).toBe(safeDocId(k));
  });

  it('is collision-free for keys that differ only by an illegal char', () => {
    // "a/b" and "a_b" clean to the same prefix but must not collide (hash differs).
    expect(safeDocId('a/b')).not.toBe(safeDocId('a_b'));
  });

  it('gives distinct ids across a realistic set including duplicates suffixes', () => {
    const keys = [
      'BIG CHAIR||2001(New)||S-W',
      'BIG CHAIR||2001(New)||S-W #2',
      ...withSlash,
      'XUV||8001 (Pearl)||A.Gold Red/8003',
    ];
    const ids = keys.map(safeDocId);
    expect(new Set(ids).size).toBe(keys.length);
  });

  it('stays within Firestore\'s 1500-byte limit', () => {
    const long = 'X'.repeat(5000) + '||' + 'Y'.repeat(5000) + '||Z';
    expect(new TextEncoder().encode(safeDocId(long)).length).toBeLessThanOrEqual(1500);
  });
});
