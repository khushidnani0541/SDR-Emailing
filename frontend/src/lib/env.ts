import { z } from "zod";

// Validated server-side configuration. Never import this from client components.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  LIBRARIAN_MCP_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "64 hex chars (32 bytes)"),
  ALLOWED_EMAIL_DOMAIN: z.string().optional(),
  SEND_MODE: z.enum(["draft_only", "live"]).default("draft_only"),
  MODEL_RESEARCH: z.string().default("claude-sonnet-5"),
  MODEL_DRAFT: z.string().default("claude-sonnet-5"),
  MODEL_CLASSIFY: z.string().default("claude-haiku-4-5"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
