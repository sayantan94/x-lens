/**
 * Simple API key resolver using environment variables.
 * Replaces the previous OAuth-based resolver.
 */
import { getEnvApiKey } from "../src/env-api-keys.js";

export async function resolveApiKey(provider: string): Promise<string | undefined> {
	return getEnvApiKey(provider);
}
