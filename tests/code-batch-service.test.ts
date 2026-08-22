import { describe, expect, it } from "vitest";
import { CodeBatchService } from "../src/codes/code-batch-service.js";

class MemoryCodeRepository {
  public readonly codes = new Set<string>();

  public async insertCodes(codes: readonly string[]): Promise<string[]> {
    const inserted: string[] = [];
    for (const code of codes) {
      if (!this.codes.has(code)) {
        this.codes.add(code);
        inserted.push(code);
      }
    }
    return inserted;
  }
}

describe("CodeBatchService", () => {
  it("inserts exactly the requested number of unique codes", async () => {
    const repository = new MemoryCodeRepository();
    const codes = await new CodeBatchService(repository).generate(100);
    expect(codes).toHaveLength(100);
    expect(repository.codes.size).toBe(100);
  });

  it("rejects out-of-range administrator requests", async () => {
    const service = new CodeBatchService(new MemoryCodeRepository());
    await expect(service.generate(0)).rejects.toThrow(RangeError);
    await expect(service.generate(10_001)).rejects.toThrow(RangeError);
  });
});
