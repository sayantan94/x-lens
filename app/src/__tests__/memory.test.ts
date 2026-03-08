import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test memory functions by temporarily overriding the home directory
// so tests don't pollute the real ~/.x-lens directory.
// Since memory.ts uses homedir() at module level, we mock it.

import { vi } from "vitest";

const TEST_HOME = join(tmpdir(), `x-lens-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

// Import after mock setup
const {
  readMemory,
  writeMemory,
  appendMemory,
  getMemoryPath,
  loadSessionMessages,
  appendSessionMessage,
  clearSession,
  getSessionPath,
} = await import("../memory.js");

describe("memory", () => {
  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe("readMemory", () => {
    it("should return '(no memory yet)' when file does not exist", () => {
      expect(readMemory()).toBe("(no memory yet)");
    });
  });

  describe("writeMemory / readMemory roundtrip", () => {
    it("should write and read back content", () => {
      writeMemory("Hello, this is a test.");
      expect(readMemory()).toBe("Hello, this is a test.");
    });

    it("should replace content on subsequent writes", () => {
      writeMemory("First");
      writeMemory("Second");
      expect(readMemory()).toBe("Second");
    });
  });

  describe("appendMemory", () => {
    it("should append to existing memory", () => {
      writeMemory("Line 1");
      appendMemory("Line 2");
      const result = readMemory();
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
    });

    it("should work when no memory file exists", () => {
      appendMemory("First append");
      const result = readMemory();
      expect(result).toContain("First append");
    });
  });

  describe("getMemoryPath", () => {
    it("should return a path ending with MEMORY.md", () => {
      expect(getMemoryPath()).toMatch(/MEMORY\.md$/);
    });
  });
});

describe("session persistence", () => {
  beforeEach(() => {
    if (!existsSync(TEST_HOME)) mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe("loadSessionMessages", () => {
    it("should return empty array when no session file exists", () => {
      expect(loadSessionMessages()).toEqual([]);
    });
  });

  describe("appendSessionMessage / loadSessionMessages roundtrip", () => {
    it("should save and load full AgentMessages", () => {
      const msg1 = {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Hello" }],
        timestamp: Date.now(),
      };
      const msg2 = {
        role: "user" as const,
        content: [{ type: "text" as const, text: "World" }],
        timestamp: Date.now() + 1000,
      };

      appendSessionMessage(msg1);
      appendSessionMessage(msg2);

      const loaded = loadSessionMessages();
      expect(loaded).toHaveLength(2);
      expect(loaded[0]).toEqual(msg1);
      expect(loaded[1]).toEqual(msg2);
    });
  });

  describe("clearSession", () => {
    it("should clear all session messages", () => {
      appendSessionMessage({
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: Date.now(),
      });
      expect(loadSessionMessages()).toHaveLength(1);

      clearSession();
      expect(loadSessionMessages()).toEqual([]);
    });
  });

  describe("getSessionPath", () => {
    it("should return a path ending with context.jsonl", () => {
      expect(getSessionPath()).toMatch(/context\.jsonl$/);
    });
  });
});
