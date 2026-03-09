import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `x-lens-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const {
  loadPersonaSession,
  appendPersonaSessionMessage,
  savePersonaSession,
  clearPersonaSession,
  getPersonaSessionPath,
} = await import("../session-manager.js");

describe("session-manager", () => {
  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should return empty array for new persona", () => {
    expect(loadPersonaSession("trader")).toEqual([]);
  });

  it("should store separate sessions per persona", () => {
    const msg1 = { role: "user" as const, content: [{ type: "text" as const, text: "trader msg" }], timestamp: 1 };
    const msg2 = { role: "user" as const, content: [{ type: "text" as const, text: "predictor msg" }], timestamp: 2 };

    appendPersonaSessionMessage("trader", msg1);
    appendPersonaSessionMessage("predictor", msg2);

    const traderMsgs = loadPersonaSession("trader");
    const predictorMsgs = loadPersonaSession("predictor");

    expect(traderMsgs).toHaveLength(1);
    expect(predictorMsgs).toHaveLength(1);
    expect((traderMsgs[0].content as any)[0].text).toBe("trader msg");
    expect((predictorMsgs[0].content as any)[0].text).toBe("predictor msg");
  });

  it("should save full session (overwrite)", () => {
    appendPersonaSessionMessage("trader", {
      role: "user", content: [{ type: "text", text: "old" }], timestamp: 1,
    } as any);
    savePersonaSession("trader", [
      { role: "user", content: [{ type: "text", text: "new" }], timestamp: 2 } as any,
    ]);
    const loaded = loadPersonaSession("trader");
    expect(loaded).toHaveLength(1);
    expect((loaded[0].content as any)[0].text).toBe("new");
  });

  it("should clear a persona session", () => {
    appendPersonaSessionMessage("trader", {
      role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1,
    } as any);
    clearPersonaSession("trader");
    expect(loadPersonaSession("trader")).toEqual([]);
  });

  it("should return correct path per persona", () => {
    const path = getPersonaSessionPath("trader");
    expect(path).toMatch(/sessions\/trader\.jsonl$/);
  });
});
