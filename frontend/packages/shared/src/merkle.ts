/**
 * Merkle tree helpers for client-side verification demo.
 * Uses a deterministic FNV-1a 64-bit fold encoded as 0x + 32 hex chars
 * so the UI works without a keccak dependency. Teammates should swap to
 * keccak256 for production (see API_CONTRACT.md).
 */

function fnv1aHex(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  // Expand to 32 hex chars for hash-like display
  const a = h.toString(16).padStart(16, '0');
  const b = (h ^ 0x9e3779b97f4a7c15n).toString(16).padStart(16, '0');
  return `0x${a}${b}`;
}

export function hashLeaf(canonical: string): string {
  return fnv1aHex(`leaf:${canonical}`);
}

export function hashPair(left: string, right: string): string {
  return fnv1aHex(`node:${left}|${right}`);
}

export interface MerkleProof {
  root: string;
  leaf: string;
  /** Sibling hashes from leaf to root; direction true = sibling is on the right. */
  siblings: Array<{ hash: string; right: boolean }>;
}

export function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return hashLeaf('empty');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export function buildMerkleProof(leaves: string[], index: number): MerkleProof {
  if (leaves.length === 0) {
    const leaf = hashLeaf('empty');
    return { root: leaf, leaf, siblings: [] };
  }
  if (index < 0 || index >= leaves.length) {
    throw new Error('leaf index out of range');
  }
  const siblings: MerkleProof['siblings'] = [];
  let level = [...leaves];
  let idx = index;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      if (i === idx || i + 1 === idx) {
        if (idx % 2 === 0) {
          siblings.push({ hash: right, right: true });
        } else {
          siblings.push({ hash: left, right: false });
        }
      }
      next.push(hashPair(left, right));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return { root: level[0]!, leaf: leaves[index]!, siblings };
}

export function verifyMerkleProof(proof: MerkleProof): boolean {
  let computed = proof.leaf;
  for (const step of proof.siblings) {
    computed = step.right ? hashPair(computed, step.hash) : hashPair(step.hash, computed);
  }
  return computed === proof.root;
}
