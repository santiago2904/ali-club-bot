export const PROOF_STORAGE = Symbol("ProofStorage");

export interface ProofStorage {
  /** Persists proof bytes and returns a stable path/identifier. */
  save(orderId: string, bytes: Buffer, ext: string): Promise<string>;
}
