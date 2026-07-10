import type { ProofStorage } from "./proofStorage";

export class MemoryProofStorage implements ProofStorage {
  public saved = new Map<string, Buffer>();

  async save(orderId: string, bytes: Buffer, ext: string): Promise<string> {
    const path = `memory://${orderId}.${ext}`;
    this.saved.set(path, bytes);
    return path;
  }
}
