import { describe, expect, it } from 'vitest';
import { buildMerkleProof, buildMerkleRoot, hashLeaf, verifyMerkleProof } from './merkle';

describe('merkle', () => {
  it('builds a stable root and verifies a proof', () => {
    const leaves = ['a', 'b', 'c', 'd'].map((x) => hashLeaf(x));
    const root = buildMerkleRoot(leaves);
    const proof = buildMerkleProof(leaves, 2);
    expect(proof.root).toBe(root);
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('fails verification when leaf is tampered', () => {
    const leaves = ['a', 'b', 'c'].map((x) => hashLeaf(x));
    const proof = buildMerkleProof(leaves, 1);
    const tampered = { ...proof, leaf: hashLeaf('tampered') };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });
});
