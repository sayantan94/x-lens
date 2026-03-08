import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Job {
  id: string;
  persona: string;
  prompt: string;
  type: "cron" | "interval" | "continuous";
  schedule?: string;
  interval_minutes?: number;
  pause_seconds?: number;
  enabled: boolean;
  notify: boolean;
  created_at: string;
  last_run?: string;
  last_result_summary?: string;
  run_count: number;
}

export type CreateJobInput = Omit<Job, "enabled" | "created_at" | "run_count" | "last_run" | "last_result_summary">;

const X_LENS_DIR = join(homedir(), ".x-lens");
const JOBS_FILE = join(X_LENS_DIR, "jobs.json");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class JobStore {
  private jobs: Job[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    ensureDir(X_LENS_DIR);
    if (!existsSync(JOBS_FILE)) {
      this.jobs = [];
      return;
    }
    try {
      const data = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
      this.jobs = data.jobs ?? [];
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    ensureDir(X_LENS_DIR);
    writeFileSync(JOBS_FILE, JSON.stringify({ jobs: this.jobs }, null, 2), "utf-8");
  }

  list(): Job[] {
    return [...this.jobs];
  }

  get(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  create(input: CreateJobInput): Job {
    if (this.jobs.some((j) => j.id === input.id)) {
      throw new Error(`Job "${input.id}" already exists`);
    }
    const job: Job = {
      ...input,
      enabled: true,
      created_at: new Date().toISOString(),
      run_count: 0,
    };
    this.jobs.push(job);
    this.save();
    return job;
  }

  delete(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  recordRun(id: string, timestamp: string, resultSummary: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.last_run = timestamp;
    job.last_result_summary = resultSummary;
    job.run_count += 1;
    this.save();
  }
}
