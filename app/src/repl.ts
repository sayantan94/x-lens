export interface ReplOptions {
  visible?: boolean;
  model?: string;
  skillsDir?: string;
}

export async function runInteractive(options: ReplOptions = {}): Promise<void> {
  console.log("[x-lens] REPL mode");
  console.log("[x-lens] Not yet implemented. Coming in Task 7.");
}
