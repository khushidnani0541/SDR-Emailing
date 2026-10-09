import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    // Research turns with web search can run for minutes.
    client = new Anthropic({ apiKey: key, timeout: 5 * 60_000, maxRetries: 3 });
  }
  return client;
}
