import { describe, it, expect } from "vitest";
import { BrowserController } from "../browser.js";

describe("BrowserController", () => {
  it("should create with default config", () => {
    const browser = new BrowserController();
    expect(browser).toBeDefined();
    expect(browser.isRunning()).toBe(false);
  });

  it("should create with custom config", () => {
    const browser = new BrowserController({
      headless: false,
      profileDir: "/tmp/test-profile",
    });
    expect(browser.config.headless).toBe(false);
    expect(browser.config.profileDir).toBe("/tmp/test-profile");
  });

  it("should throw if page accessed before launch", () => {
    const browser = new BrowserController();
    expect(() => browser.page).toThrow("Browser not launched");
  });
});
