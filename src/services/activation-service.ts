import { CODE_PATTERN, normalizeCode } from "../codes/generator.js";
import type { GuardState } from "../db/activation-guard-repository.js";
import type { ActivationResult, OrderRecord } from "../db/order-repository.js";

interface GuardStore {
  get(guildId: string, userId: string): Promise<GuardState>;
  recordFailure(guildId: string, userId: string): Promise<GuardState>;
  clear(guildId: string, userId: string): Promise<void>;
}

interface OrderActivator {
  activateCode(code: string, guildId: string, buyerDiscordId: string): Promise<ActivationResult>;
}

export type CodeActivationOutcome =
  | { kind: "activated"; order: OrderRecord }
  | { kind: "blocked"; blockedUntil: Date }
  | { kind: "invalid_format" | "used" | "missing"; guard: GuardState };

export class ActivationService {
  public constructor(
    private readonly orders: OrderActivator,
    private readonly guards: GuardStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async activate(rawCode: string, guildId: string, userId: string): Promise<CodeActivationOutcome> {
    const currentGuard = await this.guards.get(guildId, userId);
    if (currentGuard.blockedUntil && currentGuard.blockedUntil.getTime() > this.now().getTime()) {
      return { kind: "blocked", blockedUntil: currentGuard.blockedUntil };
    }

    const code = normalizeCode(rawCode);
    if (!CODE_PATTERN.test(code)) {
      return { kind: "invalid_format", guard: await this.guards.recordFailure(guildId, userId) };
    }

    const activation = await this.orders.activateCode(code, guildId, userId);
    if (activation.kind !== "activated") {
      return { kind: activation.kind, guard: await this.guards.recordFailure(guildId, userId) };
    }

    await this.guards.clear(guildId, userId);
    return activation;
  }
}
