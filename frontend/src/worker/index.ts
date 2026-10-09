// Standalone worker process (`npm run worker`). In production the same handlers
// also start inside the Next server via src/instrumentation.ts.
import "@/lib/scripts-env";
import { startWorker } from "./run";

startWorker({ handleSignals: true }).catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
