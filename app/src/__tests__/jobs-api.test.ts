import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StatusServer } from "../status-server.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_PORT = 13457;
const TEST_DIR = join(tmpdir(), "x-lens-test-jobs-" + process.pid);
const JSONL_PATH = join(TEST_DIR, "linkedin-posts.jsonl");

describe("/api/jobs endpoint", () => {
  let server: StatusServer;

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    server = new StatusServer(TEST_DIR);
    await server.start(TEST_PORT);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should return empty array when no JSONL files exist", async () => {
    // Remove any files from previous tests
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("should return parsed posts from JSONL file", async () => {
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
    const good = JSON.stringify({ id: "abc", author: "Jane", relevanceScore: 0.8 });
    writeFileSync(JSONL_PATH, good + "\nnot json\n\n" + good + "\n");

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("should read from all JSONL files in the directory", async () => {
    const post1 = JSON.stringify({ id: "a1", author: "Alice" });
    const post2 = JSON.stringify({ id: "b1", author: "Bob" });
    writeFileSync(join(TEST_DIR, "search-1.jsonl"), post1 + "\n");
    writeFileSync(join(TEST_DIR, "search-2.jsonl"), post2 + "\n");
    // Remove the previous test file
    rmSync(JSONL_PATH, { force: true });

    const res = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    const data: any = await res.json();
    expect(data).toHaveLength(2);
    const authors = data.map((p: any) => p.author);
    expect(authors).toContain("Alice");
    expect(authors).toContain("Bob");
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
