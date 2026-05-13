import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LeaderElection } from "../../mcp/core/reliability/leader-election.js";

describe("LeaderElection", () => {
  it("runs as leader when databaseUrl is absent", async () => {
    const election = LeaderElection.open({
      databaseUrl: undefined,
      enabled: true,
      instanceId: "test-no-db"
    });

    const order: string[] = [];
    const result = await election.runIfLeader({
      lockKey: "cleanup-sync",
      onLeader: async () => {
        order.push("leader");
        return "ok";
      },
      onFollower: async () => {
        order.push("follower");
        return "skip";
      }
    });

    assert.equal(result, "ok");
    assert.deepEqual(order, ["leader"]);
    assert.equal(election.describeInstance(), "test-no-db");
    await election.close();
  });

  it("runs as leader when feature is disabled", async () => {
    const election = LeaderElection.open({
      databaseUrl: "postgres://dummy:dummy@localhost:5432/db",
      enabled: false,
      instanceId: "test-disabled"
    });

    const result = await election.runIfLeader({
      lockKey: "cleanup-sync",
      onLeader: async () => "leader-ran",
      onFollower: async () => "follower-ran"
    });

    assert.equal(result, "leader-ran");
    await election.close();
  });

  it("supports follower callback defaulting to undefined", async () => {
    const election = LeaderElection.open({
      databaseUrl: undefined,
      enabled: true
    });

    const result = await election.runIfLeader({
      lockKey: "job",
      onLeader: async () => 42
    });

    assert.equal(result, 42);
    await election.close();
  });
});
