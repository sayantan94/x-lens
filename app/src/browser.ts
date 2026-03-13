import {
  chromium,
  type Browser,
  type Page,
  type BrowserContext,
} from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  headless: boolean;
  profileDir: string;
  executablePath?: string;
}

export interface PageSnapshot {
  screenshot: Buffer;
  /** AI-optimised snapshot (from _snapshotForAI) or aria fallback. */
  snapshot: string;
  /** Which method produced the snapshot text. */
  snapshotMode: "ai" | "aria";
  url: string;
  title: string;
}

export interface DomNode {
  ref: string;
  parentRef: string | null;
  depth: number;
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
  type?: string;
  value?: string;
}

/** Playwright exposes _snapshotForAI on Page but it's not in public types. */
interface PageWithAI extends Page {
  _snapshotForAI?: (opts: {
    timeout: number;
    track?: string;
  }) => Promise<{ full?: string } | undefined>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE_DIR = join(homedir(), ".x-lens", "browser-profile");

/** Max chars for AI/aria snapshot text sent to LLM. */
const MAX_SNAPSHOT_CHARS = 300_000;

/** Efficient mode limit — used for quick tool results. */
const EFFICIENT_SNAPSHOT_CHARS = 30_000;

/** Max nodes for DOM snapshot extraction. */
const DOM_SNAPSHOT_LIMIT = 800;

/** Max text per DOM element. */
const DOM_MAX_TEXT_CHARS = 220;

// ---------------------------------------------------------------------------
// BrowserController
// ---------------------------------------------------------------------------

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
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-sync",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-features=Translate,MediaRouter",
          "--disable-session-crashed-bubble",
          "--hide-crash-restore-bubble",
          "--password-store=basic",
          ...(process.platform === "linux"
            ? ["--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"]
            : []),
        ],
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

  // -------------------------------------------------------------------------
  // Navigation & actions
  // -------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
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

  // -------------------------------------------------------------------------
  // Screenshot
  // -------------------------------------------------------------------------

  async screenshot(): Promise<Buffer> {
    return Buffer.from(await this.page.screenshot({ type: "png" }));
  }

  // -------------------------------------------------------------------------
  // Snapshot methods (matching openclaw's multi-method approach)
  // -------------------------------------------------------------------------

  /**
   * AI-optimised snapshot via Playwright's private `_snapshotForAI()` API.
   * Returns a hybrid representation combining visual structure + semantics,
   * purpose-built for LLM consumption. Best option when available.
   */
  async snapshotForAI(maxChars = MAX_SNAPSHOT_CHARS): Promise<string | null> {
    const maybe = this.page as PageWithAI;
    if (!maybe._snapshotForAI) return null;

    try {
      const result = await maybe._snapshotForAI({
        timeout: 5000,
        track: "response",
      });
      let text = String(result?.full ?? "");
      if (maxChars && text.length > maxChars) {
        text = `${text.slice(0, maxChars)}\n\n[...TRUNCATED - page too large]`;
      }
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Accessibility tree via Playwright's `ariaSnapshot()`.
   * Fallback when `_snapshotForAI` is unavailable.
   */
  async accessibilityTree(): Promise<string> {
    try {
      return await this.page.locator(":root").ariaSnapshot({ timeout: 5000 });
    } catch {
      return "(accessibility tree unavailable)";
    }
  }

  /**
   * DOM snapshot via JavaScript evaluation.
   * Extracts tag names, IDs, classes, text, links, ARIA attributes.
   * Use for low-level DOM navigation and complex selectors.
   */
  async domSnapshot(
    limit = DOM_SNAPSHOT_LIMIT,
    maxTextChars = DOM_MAX_TEXT_CHARS,
  ): Promise<DomNode[]> {
    const expression = `(() => {
      const maxNodes = ${JSON.stringify(limit)};
      const maxText = ${JSON.stringify(maxTextChars)};
      const nodes = [];
      const root = document.documentElement;
      if (!root) return { nodes };
      const stack = [{ el: root, depth: 0, parentRef: null }];
      while (stack.length && nodes.length < maxNodes) {
        const cur = stack.pop();
        const el = cur.el;
        if (!el || el.nodeType !== 1) continue;
        const ref = "n" + String(nodes.length + 1);
        const tag = (el.tagName || "").toLowerCase();
        const id = el.id ? String(el.id) : undefined;
        const className = el.className ? String(el.className).slice(0, 300) : undefined;
        const role = el.getAttribute && el.getAttribute("role") ? String(el.getAttribute("role")) : undefined;
        const name = el.getAttribute && el.getAttribute("aria-label") ? String(el.getAttribute("aria-label")) : undefined;
        let text = "";
        try { text = String(el.innerText || "").trim(); } catch {}
        if (maxText && text.length > maxText) text = text.slice(0, maxText) + "…";
        const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
        const type = (el.type !== undefined && el.type !== null) ? String(el.type) : undefined;
        const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;
        nodes.push({
          ref,
          parentRef: cur.parentRef,
          depth: cur.depth,
          tag,
          ...(id ? { id } : {}),
          ...(className ? { className } : {}),
          ...(role ? { role } : {}),
          ...(name ? { name } : {}),
          ...(text ? { text } : {}),
          ...(href ? { href } : {}),
          ...(type ? { type } : {}),
          ...(value ? { value } : {}),
        });
        const children = el.children ? Array.from(el.children) : [];
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ el: children[i], depth: cur.depth + 1, parentRef: ref });
        }
      }
      return { nodes };
    })()`;

    try {
      const result = (await this.page.evaluate(expression)) as {
        nodes?: DomNode[];
      };
      return Array.isArray(result?.nodes) ? result.nodes : [];
    } catch {
      return [];
    }
  }

  /**
   * Get raw HTML or innerText from page or a selector.
   */
  async getDomText(
    format: "html" | "text",
    selector?: string,
    maxChars = 200_000,
  ): Promise<string> {
    const selectorExpr = selector ? JSON.stringify(selector) : "null";
    const expression = `(() => {
      const fmt = ${JSON.stringify(format)};
      const max = ${JSON.stringify(maxChars)};
      const sel = ${selectorExpr};
      const pick = sel ? document.querySelector(sel) : null;
      let out = "";
      if (fmt === "text") {
        const el = pick || document.body || document.documentElement;
        try { out = String(el && el.innerText ? el.innerText : ""); } catch { out = ""; }
      } else {
        const el = pick || document.documentElement;
        try { out = String(el && el.outerHTML ? el.outerHTML : ""); } catch { out = ""; }
      }
      if (max && out.length > max) out = out.slice(0, max) + "\\n<!-- …truncated… -->";
      return out;
    })()`;

    try {
      const result = await this.page.evaluate(expression);
      return typeof result === "string" ? result : "";
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------------------
  // Combined snapshot — tries best method, falls back gracefully
  // -------------------------------------------------------------------------

  /**
   * Full page snapshot for LLM consumption.
   * Tries `_snapshotForAI()` first (best), falls back to `ariaSnapshot()`.
   * Always includes screenshot alongside text.
   */
  async snapshot(efficient = true): Promise<PageSnapshot> {
    const maxChars = efficient ? EFFICIENT_SNAPSHOT_CHARS : MAX_SNAPSHOT_CHARS;

    const [screenshotBuf, url, title] = await Promise.all([
      this.screenshot(),
      Promise.resolve(this.page.url()),
      this.page.title(),
    ]);

    // Try AI snapshot first (best for LLMs)
    const aiSnapshot = await this.snapshotForAI(maxChars);
    if (aiSnapshot) {
      return {
        screenshot: screenshotBuf,
        snapshot: aiSnapshot,
        snapshotMode: "ai",
        url,
        title,
      };
    }

    // Fallback to accessibility tree
    let ariaText = await this.accessibilityTree();
    if (maxChars && ariaText.length > maxChars) {
      ariaText = `${ariaText.slice(0, maxChars)}\n\n[...TRUNCATED - page too large]`;
    }

    return {
      screenshot: screenshotBuf,
      snapshot: ariaText,
      snapshotMode: "aria",
      url,
      title,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this._page = null;
    }
  }
}
