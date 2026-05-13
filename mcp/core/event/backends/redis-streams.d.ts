import type { EventBus } from "../event-bus.js";

export interface CreateRedisStreamsEventBusOptions {
  redisUrl: string;
  streamKey?: string;
}

export function createRedisStreamsEventBus(
  options: CreateRedisStreamsEventBusOptions
): Promise<EventBus>;
