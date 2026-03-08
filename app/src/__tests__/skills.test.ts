import { describe, it, expect } from "vitest";
import { loadSkills, formatSkillsForPrompt, formatSkillsForMatching } from "../skills.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadSkills", () => {
  it("should load a single markdown skill", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    writeFileSync(join(dir, "check-email.md"), `---
name: check-email
description: Check email for urgent messages
triggers: [email, gmail, inbox]
---

## Instructions
1. Open gmail.com
2. Check for unread
`);
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("check-email");
    expect(skills[0].description).toBe("Check email for urgent messages");
    expect(skills[0].triggers).toEqual(["email", "gmail", "inbox"]);
  });

  it("should load a folder skill with skill.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const skillDir = join(dir, "deploy-site");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "skill.md"), `---
name: deploy-site
description: Deploy website
triggers: [deploy, release]
---

## Instructions
1. Run ./deploy.sh
`);
    writeFileSync(join(skillDir, "deploy.sh"), "#!/bin/bash\necho deployed");
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy-site");
    expect(skills[0].baseDir).toBe(skillDir);
  });

  it("should return empty array for missing directory", () => {
    const skills = loadSkills("/nonexistent/path");
    expect(skills).toHaveLength(0);
  });

  it("should skip files without name in frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    writeFileSync(join(dir, "bad.md"), "# No frontmatter\nJust text");
    const skills = loadSkills(dir);
    expect(skills).toHaveLength(0);
  });
});

describe("formatSkillsForPrompt", () => {
  it("should format skills into prompt text", () => {
    const skills = [
      { name: "test", description: "A test skill", triggers: ["test"], instructions: "Do the thing", baseDir: "/tmp" },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("### test");
    expect(result).toContain("A test skill");
    expect(result).toContain("Do the thing");
  });

  it("should return empty string for no skills", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });
});

describe("formatSkillsForMatching", () => {
  it("should format skills for NLP matching", () => {
    const skills = [
      { name: "email", description: "Check email", triggers: ["email", "inbox"], instructions: "", baseDir: "" },
    ];
    const result = formatSkillsForMatching(skills);
    expect(result).toContain("email");
    expect(result).toContain("Check email");
    expect(result).toContain("inbox");
  });
});
