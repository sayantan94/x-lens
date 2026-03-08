import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  baseDir: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  triggers?: string[];
}

function parseFrontmatter(content: string): { meta: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].trim();
  const meta: SkillFrontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    if (key === "name") meta.name = value.trim();
    if (key === "description") meta.description = value.trim();
    if (key === "triggers") {
      const arrayMatch = value.match(/\[([^\]]*)\]/);
      if (arrayMatch) {
        meta.triggers = arrayMatch[1].split(",").map((s) => s.trim());
      }
    }
  }

  return { meta, body };
}

function loadSkillFromFile(filePath: string, baseDir: string): Skill | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(content);
    if (!meta.name) return null;

    return {
      name: meta.name,
      description: meta.description || "",
      triggers: meta.triggers || [],
      instructions: body,
      baseDir,
    };
  } catch {
    return null;
  }
}

export function loadSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];
  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const fullPath = join(skillsDir, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && entry.endsWith(".md")) {
      const skill = loadSkillFromFile(fullPath, skillsDir);
      if (skill) skills.push(skill);
    } else if (stat.isDirectory()) {
      const skillMd = join(fullPath, "skill.md");
      if (existsSync(skillMd)) {
        const skill = loadSkillFromFile(skillMd, fullPath);
        if (skill) skills.push(skill);
      }
    }
  }

  return skills;
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = ["## Available Skills\n"];
  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    lines.push(`${skill.description}`);
    if (skill.baseDir) lines.push(`Scripts directory: ${skill.baseDir}`);
    lines.push("");
    lines.push(skill.instructions);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatSkillsForMatching(skills: Skill[]): string {
  return skills
    .map((s) => `- name: "${s.name}", description: "${s.description}", triggers: [${s.triggers.join(", ")}]`)
    .join("\n");
}
