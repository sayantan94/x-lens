import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StatusServer } from "../status-server.js";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TEST_PORT = 13457;
const JSONL_DIR = join(homedir(), ".x-lens");
const JSONL_PATH = join(JSONL_DIR, "linkedin-posts.jsonl");

describe("/api/jobs endpoint", () => {
  let server: StatusServer;
  let originalContent: string | null = null;

  beforeAll(async () => {
    if (existsSync(JSONL_PATH)) {
      originalContent = readFileSync(JSONL_PATH, "utf-8");
    }
    server = new StatusServer();
    await server.start(TEST_PORT);
  });

  afterAll(async () => {
    await server.stop();
    if (originalContent !== null) {
      writeFileSync(JSONL_PATH, originalContent);
    }
  });

  it("should return empty array when JSONL file does not exist", async () => {
    const backup = existsSync(JSONL_PATH) ? readFileSync(JSONL_PATH, "utf-8") : null;
    if (existsSync(JSONL_PATH)) rmSync(JSONL_PATH);

    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(data).toEqual([]);
    } finally {
      if (backup !== null) writeFileSync(JSONL_PATH, backup);
    }
  });

  it("should return parsed posts from JSONL file", async () => {
    mkdirSync(JSONL_DIR, { recursive: true });
    const post1 = JSON.stringify({ id: "abc123", author: "Jane", company: "Google", relevanceScore: 0.87, url: "https://linkedin.com/post/1" });
    const post2 = JSON.stringify({ id: "def456", author: "Bob", company: "Meta", relevanceScore: 0.65, url: "https://linkedin.com/post/2" });
    writeFileSync(JSONL_PATH, post1 + "\n" + post2 + "\n");

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data: any = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].author).toBe("Jane");
    expect(data[1].author).toBe("Bob");
  });

  it("should skip malformed JSONL lines", async () => {
    mkdirSync(JSONL_DIR, { recursive: true });
    const good = JSON.stringify({ id: "abc", author: "Jane", relevanceScore: 0.8 });
    writeFileSync(JSONL_PATH, good + "\nnot json\n\n" + good + "\n");

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("should serve HTML page at /jobs", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/jobs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("x-lens");
    expect(html).toContain("Jobs");
    expect(html).toContain("/api/jobs");
  });
});
