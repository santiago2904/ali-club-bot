import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProofStorage } from "./proofStorage";

export class LocalProofStorage implements ProofStorage {
  constructor(private baseDir: string) {}

  async save(orderId: string, bytes: Buffer, ext: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const path = resolve(join(this.baseDir, `${orderId}.${ext}`));
    await writeFile(path, bytes);
    return path;
  }
}
