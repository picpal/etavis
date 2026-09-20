/** Workers 런타임 타입 중 이 워커가 쓰는 것만. @cloudflare/workers-types 를 설치하면
 *  앱의 의존성 트리가 바뀌므로, 심사를 앞두고는 필요한 만큼만 직접 적는다. */
declare interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}
declare interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}
declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
