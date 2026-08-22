import { describe, expect, it } from "vitest";
import { dueAction, type TimerState } from "../src/timers/due-action.js";
import { timerPolicy } from "../src/timers/policy.js";

const at = (minute: number): Date => new Date(minute * 60_000);

function state(overrides: Partial<TimerState> = {}): TimerState {
  return {
    startedAt: null,
    waitingExpiresAt: at(2),
    warningAt: null,
    closesAt: null,
    deletesAt: null,
    warningSentAt: null,
    entryLockedAt: null,
    ...overrides,
  };
}

describe("timer policy", () => {
  it("uses 60/10/5 minute production values", () => {
    const policy = timerPolicy(false);
    expect(policy.orderMilliseconds).toBe(60 * 60_000);
    expect(policy.warningBeforeMilliseconds).toBe(10 * 60_000);
    expect(policy.deletionDelayMilliseconds).toBe(5 * 60_000);
  });

  it("uses 2/1/1 minute test values", () => {
    const policy = timerPolicy(true);
    expect(policy.orderMilliseconds).toBe(2 * 60_000);
    expect(policy.warningBeforeMilliseconds).toBe(60_000);
    expect(policy.deletionDelayMilliseconds).toBe(60_000);
  });
});

describe("dueAction", () => {
  it("expires a conversation that never started", () => {
    expect(dueAction(state(), at(2))).toBe("expire_waiting");
  });

  it("warns, locks, and completes in order", () => {
    const timer = state({
      startedAt: at(0),
      warningAt: at(1),
      closesAt: at(2),
      deletesAt: at(3),
    });
    expect(dueAction(timer, at(1))).toBe("warn");
    expect(dueAction({ ...timer, warningSentAt: at(1) }, at(2))).toBe("lock");
    expect(dueAction({ ...timer, warningSentAt: at(1), entryLockedAt: at(2) }, at(3))).toBe("complete");
  });

  it("does not send a stale warning after closing time", () => {
    const timer = state({ startedAt: at(0), warningAt: at(1), closesAt: at(2), deletesAt: at(3), entryLockedAt: at(2) });
    expect(dueAction(timer, at(2))).toBeNull();
  });
});
