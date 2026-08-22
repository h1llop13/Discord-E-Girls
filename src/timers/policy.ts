export interface TimerPolicy {
  waitingMilliseconds: number;
  orderMilliseconds: number;
  warningBeforeMilliseconds: number;
  deletionDelayMilliseconds: number;
  pollMilliseconds: number;
}

const minute = 60_000;

export function timerPolicy(testMode: boolean): TimerPolicy {
  return testMode
    ? {
        waitingMilliseconds: 2 * minute,
        orderMilliseconds: 2 * minute,
        warningBeforeMilliseconds: minute,
        deletionDelayMilliseconds: minute,
        pollMilliseconds: 1_000,
      }
    : {
        waitingMilliseconds: 60 * minute,
        orderMilliseconds: 60 * minute,
        warningBeforeMilliseconds: 10 * minute,
        deletionDelayMilliseconds: 5 * minute,
        pollMilliseconds: 5_000,
      };
}
