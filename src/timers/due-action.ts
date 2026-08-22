export interface TimerState {
  startedAt: Date | null;
  waitingExpiresAt: Date;
  warningAt: Date | null;
  closesAt: Date | null;
  deletesAt: Date | null;
  warningSentAt: Date | null;
  entryLockedAt: Date | null;
}

export type DueAction = "expire_waiting" | "warn" | "lock" | "complete" | null;

export function dueAction(timer: TimerState, now: Date): DueAction {
  const timestamp = now.getTime();
  if (!timer.startedAt) return timer.waitingExpiresAt.getTime() <= timestamp ? "expire_waiting" : null;
  if (timer.deletesAt && timer.deletesAt.getTime() <= timestamp) return "complete";
  if (!timer.entryLockedAt && timer.closesAt && timer.closesAt.getTime() <= timestamp) return "lock";
  if (
    !timer.warningSentAt
    && timer.warningAt
    && timer.warningAt.getTime() <= timestamp
    && timer.closesAt
    && timer.closesAt.getTime() > timestamp
  ) {
    return "warn";
  }
  return null;
}
