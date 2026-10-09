// Loads env files for standalone Node processes (worker, scripts). Next.js loads them itself.
// First file wins per variable, matching Next's precedence.
import { config } from "dotenv";
if (process.env.NODE_ENV === "production") config({ path: ".env.production.local", quiet: true });
config({ path: ".env.local", quiet: true });
