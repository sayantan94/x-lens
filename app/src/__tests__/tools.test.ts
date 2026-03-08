import { describe, it, expect } from "vitest";
import { createBrowserTools } from "../tools.js";
import { BrowserController } from "../browser.js";

describe("createBrowserTools", () => {
  it("should create all tools", () => {
    const browser = new BrowserController();
    const tools = createBrowserTools(browser);
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_scroll");
    expect(names).toContain("browser_evaluate");
    expect(names).toContain("shell");
    expect(names).toContain("fetch");
    expect(tools.length).toBe(8);
  });

  it("each tool should have name, label, description, parameters, execute", () => {
    const browser = new BrowserController();
    const tools = createBrowserTools(browser);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });
});
