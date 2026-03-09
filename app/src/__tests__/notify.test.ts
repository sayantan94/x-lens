import { describe, it, expect, vi, beforeEach } from "vitest";
import { exec } from "node:child_process";

vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd: string, cb: Function) => cb(null, "", "")),
}));

const { notify } = await import("../notify.js");

describe("notify", () => {
  beforeEach(() => {
    vi.mocked(exec).mockClear();
  });

  it("should call terminal-notifier with title and body", () => {
    notify("NVDA: CALL 72%", "Entry above $143, target $155");
    expect(exec).toHaveBeenCalledOnce();
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain("terminal-notifier");
    expect(cmd).toContain("NVDA: CALL 72%");
    expect(cmd).toContain("Entry above $143, target $155");
  });

  it("should include subtitle when provided", () => {
    notify("Alert", "Body text", "Subtitle here");
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain("-subtitle");
    expect(cmd).toContain("Subtitle here");
  });

  it("should include group flag for x-lens", () => {
    notify("Test", "Body");
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain("-group");
    expect(cmd).toContain("x-lens");
  });
});
