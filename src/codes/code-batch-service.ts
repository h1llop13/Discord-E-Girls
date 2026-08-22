import { generateUniqueCodes } from "./generator.js";

interface CodeInserter {
  insertCodes(codes: readonly string[]): Promise<string[]>;
}

export class CodeBatchService {
  public constructor(private readonly repository: CodeInserter) {}

  public async generate(count: number): Promise<string[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
      throw new RangeError("Code count must be an integer between 1 and 10000.");
    }
    const inserted: string[] = [];
    while (inserted.length < count) {
      const candidates = generateUniqueCodes(count - inserted.length);
      inserted.push(...(await this.repository.insertCodes(candidates)));
    }
    return inserted;
  }
}
