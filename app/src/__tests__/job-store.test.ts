import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `x-lens-job-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { JobStore } = await import("../job-store.js");

describe("JobStore", () => {
  let store: InstanceType<typeof JobStore>;

  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
    store = new JobStore();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should return empty array when no jobs file exists", () => {
    expect(store.list()).toEqual([]);
  });

  it("should create and retrieve a cron job", () => {
    const job = store.create({
      id: "test-job",
      persona: "trader",
      prompt: "Run OI scan",
      type: "cron",
      schedule: "30 6 * * 1-5",
      notify: true,
    });
    expect(job.id).toBe("test-job");
    expect(store.list()).toHaveLength(1);
    expect(store.get("test-job")).toEqual(job);
  });

  it("should create an interval job", () => {
    const job = store.create({
      id: "interval-job",
      persona: "predictor",
      prompt: "Check markets",
      type: "interval",
      interval_minutes: 60,
      notify: true,
    });
    expect(job.type).toBe("interval");
    expect(job.interval_minutes).toBe(60);
  });

  it("should create a continuous job", () => {
    const job = store.create({
      id: "continuous-job",
      persona: "predictor",
      prompt: "Monitor BTC arb",
      type: "continuous",
      pause_seconds: 30,
      notify: true,
    });
    expect(job.type).toBe("continuous");
    expect(job.pause_seconds).toBe(30);
  });

  it("should delete a job", () => {
    store.create({
      id: "to-delete",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    expect(store.list()).toHaveLength(1);
    const deleted = store.delete("to-delete");
    expect(deleted).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("should return false when deleting non-existent job", () => {
    expect(store.delete("nope")).toBe(false);
  });

  it("should update last_run and last_result_summary", () => {
    store.create({
      id: "update-me",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const now = new Date().toISOString();
    store.recordRun("update-me", now, "NVDA CALL 72%");
    const job = store.get("update-me")!;
    expect(job.last_run).toBe(now);
    expect(job.last_result_summary).toBe("NVDA CALL 72%");
    expect(job.run_count).toBe(1);
  });

  it("should persist across instances", () => {
    store.create({
      id: "persist-test",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    const store2 = new JobStore();
    expect(store2.list()).toHaveLength(1);
    expect(store2.get("persist-test")?.prompt).toBe("test");
  });

  it("should reject duplicate job IDs", () => {
    store.create({
      id: "dupe",
      persona: "trader",
      prompt: "test",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    });
    expect(() => store.create({
      id: "dupe",
      persona: "trader",
      prompt: "test2",
      type: "cron",
      schedule: "* * * * *",
      notify: false,
    })).toThrow(/already exists/);
  });
});
