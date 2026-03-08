import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  source: string;
  triggers: string[];
  instructions: string;
  baseDir: string;
  filePath: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  source?: string;
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
    if (key === "source") meta.source = value.trim();
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
      source: meta.source || "",
      triggers: meta.triggers || [],
      instructions: body,
      baseDir,
      filePath,
    };
  } catch {
    return null;
  }
}

/**
 * Load skills from a single directory.
 * Supports both `skill.md` (x-lens convention) and `SKILL.md` (tradermonty convention).
 */
function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && entry.endsWith(".md")) {
      // Root-level .md file (e.g., check-email.md)
      const skill = loadSkillFromFile(fullPath, dir);
      if (skill) skills.push(skill);
    } else if (stat.isDirectory()) {
      // Folder skill — check for skill.md or SKILL.md
      const lowercase = join(fullPath, "skill.md");
      const uppercase = join(fullPath, "SKILL.md");
      const skillFile = existsSync(lowercase) ? lowercase : existsSync(uppercase) ? uppercase : null;
      if (skillFile) {
        const skill = loadSkillFromFile(skillFile, fullPath);
        if (skill) skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * List available personas by scanning the personas/ directory.
 */
export function listPersonas(projectRoot: string): string[] {
  const personasDir = join(projectRoot, "personas");
  if (!existsSync(personasDir)) return [];
  return readdirSync(personasDir).filter((entry) => {
    const skillsDir = join(personasDir, entry, "skills");
    return existsSync(skillsDir) && statSync(skillsDir).isDirectory();
  });
}

/**
 * Load skills: global skills + persona-specific skills (if persona specified).
 * Persona skills override global skills on name collision (like mom's channel pattern).
 */
export function loadSkills(projectRoot: string, persona?: string): Skill[] {
  const skillMap = new Map<string, Skill>();

  // Load global skills
  const globalDir = join(projectRoot, "skills");
  for (const skill of loadSkillsFromDir(globalDir)) {
    skillMap.set(skill.name, skill);
  }

  // Load persona-specific skills (override globals on collision)
  if (persona) {
    const personaDir = join(projectRoot, "personas", persona, "skills");
    for (const skill of loadSkillsFromDir(personaDir)) {
      skillMap.set(skill.name, skill);
    }
  }

  return Array.from(skillMap.values());
}

/**
 * Format skills as a compact catalog for the system prompt.
 * Only includes name, description, and triggers — NOT full instructions.
 * The agent uses the skill_read tool to load full instructions on demand.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "## Available Skills",
    "",
    "Use the `skill_read` tool to load a skill's full instructions before following it.",
    "",
  ];

  for (const skill of skills) {
    const triggers = skill.triggers.length > 0 ? ` (triggers: ${skill.triggers.join(", ")})` : "";
    lines.push(`- **${skill.name}**: ${skill.description}${triggers}`);
  }

  return lines.join("\n");
}

export function formatSkillsForMatching(skills: Skill[]): string {
  return skills
    .map((s) => `- name: "${s.name}", description: "${s.description}", triggers: [${s.triggers.join(", ")}]`)
    .join("\n");
}
