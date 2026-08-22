import { describe, expect, it } from "vitest";
import type { GuardState } from "../src/db/activation-guard-repository.js";
import type { ActivationResult, OrderRecord } from "../src/db/order-repository.js";
import { ActivationService } from "../src/services/activation-service.js";

const order: OrderRecord = {
  id: 1,
  guildId: "guild",
  buyerDiscordId: "buyer",
  voiceChannelId: null,
  status: "active",
  createdAt: new Date(0),
  startedAt: null,
  closedAt: null,
};

class MemoryGuards {
  public failedAttempts = 0;
  public blockedUntil: Date | null = null;

  public async get(): Promise<GuardState> {
    return { failedAttempts: this.failedAttempts, blockedUntil: this.blockedUntil };
  }

  public async recordFailure(): Promise<GuardState> {
    this.failedAttempts += 1;
    if (this.failedAttempts >= 5) this.blockedUntil = new Date("2030-01-01T01:00:00Z");
    return this.get();
  }

  public async clear(): Promise<void> {
    this.failedAttempts = 0;
    this.blockedUntil = null;
  }
}

class MemoryOrders {
  public calls = 0;
  public available = true;

  public async activateCode(): Promise<ActivationResult> {
    this.calls += 1;
    if (!this.available) return { kind: "used" };
    this.available = false;
    return { kind: "activated", order };
  }
}

describe("ActivationService", () => {
  it("rejects malformed values before querying codes", async () => {
    const orders = new MemoryOrders();
    const outcome = await new ActivationService(orders, new MemoryGuards()).activate("hello", "guild", "buyer");
    expect(outcome.kind).toBe("invalid_format");
    expect(orders.calls).toBe(0);
  });

  it("blocks after the fifth failed attempt", async () => {
    const guards = new MemoryGuards();
    const service = new ActivationService(new MemoryOrders(), guards, () => new Date("2030-01-01T00:00:00Z"));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await service.activate("bad", "guild", "buyer");
    }
    const outcome = await service.activate("AAAA-BBBB", "guild", "buyer");
    expect(outcome.kind).toBe("blocked");
  });

  it("clears previous failures after success", async () => {
    const guards = new MemoryGuards();
    guards.failedAttempts = 3;
    const outcome = await new ActivationService(new MemoryOrders(), guards).activate("AAAA-BBBB", "guild", "buyer");
    expect(outcome.kind).toBe("activated");
    expect(guards.failedAttempts).toBe(0);
  });

  it("allows only one of two simultaneous activations", async () => {
    const orders = new MemoryOrders();
    const service = new ActivationService(orders, new MemoryGuards());
    const outcomes = await Promise.all([
      service.activate("AAAA-BBBB", "guild", "buyer-1"),
      service.activate("AAAA-BBBB", "guild", "buyer-2"),
    ]);
    expect(outcomes.map((value) => value.kind).sort()).toEqual(["activated", "used"]);
  });
});
