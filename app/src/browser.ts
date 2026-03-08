import {
  chromium,
  type Browser,
  type Page,
  type BrowserContext,
} from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface BrowserConfig {
  headless: boolean;
  profileDir: string;
  executablePath?: string;
}

export interface PageSnapshot {
  screenshot: Buffer;
  accessibilityTree: string;
  url: string;
  title: string;
}

const DEFAULT_PROFILE_DIR = join(homedir(), ".x-lens", "browser-profile");

export class BrowserController {
  readonly config: BrowserConfig;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;

  constructor(opts: Partial<BrowserConfig> = {}) {
    this.config = {
      headless: opts.headless ?? true,
      profileDir: opts.profileDir ?? DEFAULT_PROFILE_DIR,
      executablePath: opts.executablePath,
    };
  }

  isRunning(): boolean {
    return this.context !== null;
  }

  async launch(): Promise<void> {
    if (this.context) return;

    if (!existsSync(this.config.profileDir)) {
      mkdirSync(this.config.profileDir, { recursive: true });
    }

    this.context = await chromium.launchPersistentContext(
      this.config.profileDir,
      {
        headless: this.config.headless,
        executablePath: this.config.executablePath,
        viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
      },
    );

    const pages = this.context.pages();
    this._page = pages.length > 0 ? pages[0] : await this.context.newPage();
  }

  get page(): Page {
    if (!this._page)
      throw new Error("Browser not launched. Call launch() first.");
    return this._page;
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from(await this.page.screenshot({ type: "png" }));
  }

  async accessibilityTree(): Promise<string> {
    try {
      return await this.page.locator(":root").ariaSnapshot({ timeout: 5000 });
    } catch {
      return "(accessibility tree unavailable)";
    }
  }

  async snapshot(): Promise<PageSnapshot> {
    const [screenshotBuf, a11y, url, title] = await Promise.all([
      this.screenshot(),
      this.accessibilityTree(),
      Promise.resolve(this.page.url()),
      this.page.title(),
    ]);
    return { screenshot: screenshotBuf, accessibilityTree: a11y, url, title };
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector, { timeout: 8000 });
  }

  async type(selector: string, text: string): Promise<void> {
    await this.page.fill(selector, text, { timeout: 8000 });
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async scroll(
    direction: "up" | "down",
    amount: number = 500,
  ): Promise<void> {
    const delta = direction === "down" ? amount : -amount;
    await this.page.mouse.wheel(0, delta);
    await this.page.waitForTimeout(300);
  }

  async evaluate(fn: string): Promise<unknown> {
    return await this.page.evaluate(fn);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this._page = null;
    }
  }
}
