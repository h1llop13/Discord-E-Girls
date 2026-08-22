import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function generateCode(randomIndex: (maximum: number) => number = randomInt): string {
  const characters = Array.from({ length: 8 }, () => ALPHABET[randomIndex(ALPHABET.length)]);
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

export function generateUniqueCodes(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new RangeError("Code count must be an integer between 1 and 10000.");
  }

  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateCode());
  }

  return [...codes];
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}
