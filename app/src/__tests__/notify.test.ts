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

  it("should call osascript with title and body", () => {
    notify("NVDA: CALL 72%", "Entry above $143, target $155");
    expect(exec).toHaveBeenCalledOnce();
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain("display notification");
    expect(cmd).toContain("NVDA: CALL 72%");
    expect(cmd).toContain("Entry above $143, target $155");
  });

  it("should escape double quotes in title and body", () => {
    notify('Test "quotes"', 'Body "here"');
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain('\\"quotes\\"');
    expect(cmd).toContain('\\"here\\"');
    expect(cmd).toContain("display notification");
  });

  it("should include sound name", () => {
    notify("Alert", "Body", "Glass");
    const cmd = (exec as any).mock.calls[0][0] as string;
    expect(cmd).toContain('sound name "Glass"');
  });
});
