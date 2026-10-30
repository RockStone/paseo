import { describe, expect, it } from "vitest";
import {
  deriveAgentStateBucket,
  getAgentStatusPriority,
  getWorkspaceStateBucketPriority,
} from "./agent-state-bucket.js";

describe("deriveAgentStateBucket", () => {
  it("clears an acknowledged error badge without changing the agent lifecycle", () => {
    const failed = { status: "error", requiresAttention: true, attentionReason: "error" } as const;
    expect(deriveAgentStateBucket(failed)).toBe("failed");
    expect(
      deriveAgentStateBucket({ ...failed, requiresAttention: false, attentionReason: null }),
    ).toBe("done");
    expect(
      deriveAgentStateBucket({ ...failed, requiresAttention: false, pendingPermissionCount: 1 }),
    ).toBe("needs_input");
    expect(deriveAgentStateBucket(failed)).toBe("failed");
    expect(failed.status).toBe("error");
  });

  it("shows live background work after the foreground turn ends, without masking errors or permissions", () => {
    const activity = { status: "idle", backgroundTaskCount: 1 } as const;
    expect(deriveAgentStateBucket(activity)).toBe("running");
    expect(deriveAgentStateBucket({ ...activity, requiresAttention: true })).toBe("running");
    expect(deriveAgentStateBucket({ ...activity, pendingPermissionCount: 1 })).toBe("needs_input");
    expect(deriveAgentStateBucket({ ...activity, status: "error" })).toBe("failed");
    expect(deriveAgentStateBucket({ ...activity, status: "closed" })).toBe("done");
    expect(deriveAgentStateBucket({ ...activity, backgroundTaskCount: 0 })).toBe("done");
    expect(getAgentStatusPriority(activity)).toBe(getAgentStatusPriority({ status: "running" }));
  });

  it("prioritizes pending permissions as needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 1,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("needs_input");
  });

  it("keeps legacy permission attention in needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "permission",
      }),
    ).toBe("needs_input");
  });

  it("prioritizes error attention before running status", () => {
    expect(
      deriveAgentStateBucket({
        status: "running",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "error",
      }),
    ).toBe("failed");
  });

  it("treats unread finished agents as attention", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("attention");
  });

  it("does not count initializing agents as running for workspace buckets", () => {
    expect(
      deriveAgentStateBucket({
        status: "initializing",
        pendingPermissionCount: 0,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("done");
  });
});

describe("getWorkspaceStateBucketPriority", () => {
  it("orders active buckets before done", () => {
    expect(
      ["done", "attention", "running", "failed", "needs_input"].sort(
        (left, right) =>
          getWorkspaceStateBucketPriority(left) - getWorkspaceStateBucketPriority(right),
      ),
    ).toEqual(["needs_input", "failed", "running", "attention", "done"]);
  });
});

describe("getAgentStatusPriority", () => {
  it("keeps initializing agents ahead of completed agents in agent lists", () => {
    expect(getAgentStatusPriority({ status: "initializing" })).toBeLessThan(
      getAgentStatusPriority({ status: "idle" }),
    );
  });

  it("prioritizes pending permissions before errors and running agents", () => {
    const permission = getAgentStatusPriority({ status: "running", pendingPermissionCount: 1 });
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "error", pendingPermissionCount: 0 }),
    );
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "running", pendingPermissionCount: 0 }),
    );
  });
});
