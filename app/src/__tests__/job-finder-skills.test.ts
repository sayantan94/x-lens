import { describe, it, expect } from "vitest";
import { loadSkills, listPersonas } from "../skills.js";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");

describe("job-finder persona", () => {
  it("should appear in persona list", () => {
    const personas = listPersonas(PROJECT_ROOT);
    expect(personas).toContain("job-finder");
  });

  it("should load job-finder skills", () => {
    const skills = loadSkills(PROJECT_ROOT, "job-finder");
    const names = skills.map((s) => s.name);
    expect(names).toContain("linkedin-search");
    expect(names).toContain("post-extraction");
    expect(names).toContain("post-ranking");
    expect(names).toContain("linkedin-login");
  });

  it("should also load global skills", () => {
    const skills = loadSkills(PROJECT_ROOT, "job-finder");
    expect(skills.length).toBeGreaterThan(4);
  });
});
