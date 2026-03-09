import { describe, it, expect } from "vitest";
import { buildDaemonSystemPrompt } from "../daemon.js";

// Minimal skills stub — just enough for formatSkillsForPrompt
const emptySkills: any[] = [];

describe("buildDaemonSystemPrompt", () => {
  it("job-finder persona contains LinkedIn and NOT trading analyst", () => {
    const prompt = buildDaemonSystemPrompt(emptySkills, "", "job-finder");
    expect(prompt).toContain("LinkedIn");
    expect(prompt).not.toContain("trading analyst");
  });

  it("trader persona contains trading and market regime", () => {
    const prompt = buildDaemonSystemPrompt(emptySkills, "", "trader");
    expect(prompt.toLowerCase()).toContain("trading");
    expect(prompt.toLowerCase()).toContain("market regime");
  });

  it("unknown persona gets a generic prompt with persona name and skill_read", () => {
    const prompt = buildDaemonSystemPrompt(emptySkills, "", "my-custom-bot");
    expect(prompt).toContain("my-custom-bot");
    expect(prompt).toContain("skill_read");
    // Should NOT contain persona-specific content
    expect(prompt).not.toContain("LinkedIn");
    expect(prompt.toLowerCase()).not.toContain("market regime");
  });

  it("includes memory content in the prompt", () => {
    const memory = "Previous run: detected regime GREEN";
    const prompt = buildDaemonSystemPrompt(emptySkills, memory, "trader");
    expect(prompt).toContain(memory);
  });

  it("includes shared sections for all personas", () => {
    for (const persona of ["trader", "job-finder", "unknown-persona"]) {
      const prompt = buildDaemonSystemPrompt(emptySkills, "", persona);
      expect(prompt).toContain("Skill Usage Protocol");
      expect(prompt).toContain("Schedule Management");
      expect(prompt).toContain("[ALERT]");
      expect(prompt).toContain("memory_append");
    }
  });
});
