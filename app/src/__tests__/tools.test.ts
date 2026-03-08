import { describe, it, expect } from "vitest";
import { createTools } from "../tools.js";
import { BrowserController } from "../browser.js";

describe("createTools", () => {
  it("should create all tools", () => {
    const browser = new BrowserController();
    const tools = createTools(browser, []);
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_scroll");
    expect(names).toContain("browser_evaluate");
    expect(names).toContain("web_search");
    expect(names).toContain("shell");
    expect(names).toContain("fetch");
    expect(names).toContain("memory_read");
    expect(names).toContain("memory_write");
    expect(names).toContain("memory_append");
    expect(names).toContain("skill_read");
    expect(tools.length).toBe(13);
  });

  it("each tool should have name, label, description, parameters, execute", () => {
    const browser = new BrowserController();
    const tools = createTools(browser, []);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("skill_read should return skill instructions", async () => {
    const browser = new BrowserController();
    const skills = [{
      name: "test-skill",
      description: "A test skill",
      source: "test",
      triggers: ["test"],
      instructions: "## Steps\n1. Do the thing",
      baseDir: "/tmp/test-skill",
      filePath: "/tmp/test-skill/SKILL.md",
    }];
    const tools = createTools(browser, skills);
    const skillRead = tools.find((t) => t.name === "skill_read")!;
    const result = await skillRead.execute("call-1", { name: "test-skill" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("test-skill");
    expect(text).toContain("Do the thing");
    expect(text).toContain("/tmp/test-skill");
  });

  it("skill_read should return error for unknown skill", async () => {
    const browser = new BrowserController();
    const tools = createTools(browser, []);
    const skillRead = tools.find((t) => t.name === "skill_read")!;
    const result = await skillRead.execute("call-1", { name: "nonexistent" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("not found");
  });
});
