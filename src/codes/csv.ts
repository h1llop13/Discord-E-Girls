export function codesToCsv(codes: readonly string[]): string {
  return `code\n${codes.map((code) => `${code}\n`).join("")}`;
}
