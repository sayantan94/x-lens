import { describe, it, expect } from "vitest";
import { loadSkills, listPersonas, formatSkillsForPrompt, formatSkillsForMatching } from "../skills.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "xlens-"));
  mkdirSync(join(root, "skills", "global"), { recursive: true });
  return root;
}

describe("loadSkills", () => {
  it("should load a single markdown skill from skills/global/", () => {
    const root = makeProjectRoot();
    writeFileSync(join(root, "skills", "global", "check-email.md"), `---
name: check-email
description: Check email for urgent messages
triggers: [email, gmail, inbox]
---

## Instructions
1. Open gmail.com
2. Check for unread
`);
    const skills = loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("check-email");
    expect(skills[0].description).toBe("Check email for urgent messages");
    expect(skills[0].triggers).toEqual(["email", "gmail", "inbox"]);
  });

  it("should load a folder skill with skill.md", () => {
    const root = makeProjectRoot();
    const skillDir = join(root, "skills", "global", "deploy-site");
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
    const skills = loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy-site");
    expect(skills[0].baseDir).toBe(skillDir);
  });

  it("should load a folder skill with SKILL.md (uppercase)", () => {
    const root = makeProjectRoot();
    const skillDir = join(root, "skills", "global", "vcp-screener");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), `---
name: vcp-screener
description: VCP pattern screener
triggers: [vcp, volatility contraction]
---

## Instructions
Run the screener.
`);
    const skills = loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("vcp-screener");
  });

  it("should return empty array for missing directory", () => {
    const skills = loadSkills("/nonexistent/path");
    expect(skills).toHaveLength(0);
  });

  it("should skip files without name in frontmatter", () => {
    const root = makeProjectRoot();
    writeFileSync(join(root, "skills", "global", "bad.md"), "# No frontmatter\nJust text");
    const skills = loadSkills(root);
    expect(skills).toHaveLength(0);
  });

  it("should load persona skills alongside global skills", () => {
    const root = makeProjectRoot();
    // Global skill
    writeFileSync(join(root, "skills", "global", "email.md"), `---
name: check-email
description: Check email
triggers: [email]
---
Open gmail.
`);
    // Persona skill
    mkdirSync(join(root, "skills", "trader", "stock"), { recursive: true });
    writeFileSync(join(root, "skills", "trader", "stock", "skill.md"), `---
name: stock-analysis
description: Analyze stocks
triggers: [stock]
---
Analyze the stock.
`);
    const skills = loadSkills(root, "trader");
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["check-email", "stock-analysis"]);
  });

  it("should let persona skills override global skills on name collision", () => {
    const root = makeProjectRoot();
    // Global skill
    const globalDir = join(root, "skills", "global", "screener");
    mkdirSync(globalDir);
    writeFileSync(join(globalDir, "skill.md"), `---
name: screener
description: Basic screener
triggers: [screen]
---
Basic version.
`);
    // Persona skill with same name
    mkdirSync(join(root, "skills", "trader", "screener"), { recursive: true });
    writeFileSync(join(root, "skills", "trader", "screener", "skill.md"), `---
name: screener
description: Advanced trader screener
triggers: [screen, scan]
---
Advanced version.
`);
    const skills = loadSkills(root, "trader");
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Advanced trader screener");
  });

  it("should load only global skills when no persona specified", () => {
    const root = makeProjectRoot();
    writeFileSync(join(root, "skills", "global", "email.md"), `---
name: check-email
description: Check email
triggers: [email]
---
Open gmail.
`);
    mkdirSync(join(root, "skills", "trader", "stock"), { recursive: true });
    writeFileSync(join(root, "skills", "trader", "stock", "skill.md"), `---
name: stock-analysis
description: Analyze stocks
triggers: [stock]
---
Analyze.
`);
    const skills = loadSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("check-email");
  });
});

describe("listPersonas", () => {
  it("should list available personas (non-global dirs under skills/)", () => {
    const root = makeProjectRoot();
    mkdirSync(join(root, "skills", "trader"), { recursive: true });
    mkdirSync(join(root, "skills", "researcher"), { recursive: true });
    const personas = listPersonas(root);
    expect(personas.sort()).toEqual(["researcher", "trader"]);
  });

  it("should return empty for missing skills dir", () => {
    const root = mkdtempSync(join(tmpdir(), "xlens-"));
    expect(listPersonas(root)).toEqual([]);
  });
});

describe("formatSkillsForPrompt", () => {
  it("should format skills into prompt text", () => {
    const skills = [
      { name: "test", description: "A test skill", source: "", triggers: ["test"], instructions: "Do the thing", baseDir: "/tmp", filePath: "/tmp/skill.md" },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("**test**");
    expect(result).toContain("A test skill");
    expect(result).toContain("skill_read");
    // Full instructions are NOT inlined anymore (lazy loaded via skill_read tool)
    expect(result).not.toContain("Do the thing");
  });

  it("should return empty string for no skills", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });
});

describe("formatSkillsForMatching", () => {
  it("should format skills for NLP matching", () => {
    const skills = [
      { name: "email", description: "Check email", source: "", triggers: ["email", "inbox"], instructions: "", baseDir: "", filePath: "" },
    ];
    const result = formatSkillsForMatching(skills);
    expect(result).toContain("email");
    expect(result).toContain("Check email");
    expect(result).toContain("inbox");
  });
});
