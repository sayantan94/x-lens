export interface RunOptions {
  visible?: boolean;
  model?: string;
  skillsDir?: string;
}

export async function runOnce(prompt: string, options: RunOptions = {}): Promise<void> {
  console.log(`[x-lens] Command mode — prompt: "${prompt}"`);
  console.log("[x-lens] Not yet implemented. Coming in Task 6.");
}
