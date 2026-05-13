import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorIdentity } from "./actor.js";
import { normalizeActorIdentity, resolveDefaultActorFromEnv } from "./actor.js";

const actorContext = new AsyncLocalStorage<ActorIdentity>();

export function runWithActorContext<T>(actor: ActorIdentity, fn: () => T): T {
  return actorContext.run(normalizeActorIdentity(actor), fn);
}

export function getCurrentActor(): ActorIdentity | undefined {
  return actorContext.getStore();
}

export function getCurrentActorOrDefault(): ActorIdentity {
  return getCurrentActor() ?? resolveDefaultActorFromEnv();
}

export function currentActor(): ActorIdentity {
  return getCurrentActorOrDefault();
}
