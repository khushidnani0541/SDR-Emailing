// Runs once when the Next.js server starts. Starts the background worker in-process so a
// single `npm start` (how AI Studio Manager deploys apps) runs research, morning runs and sends.
// Set RUN_WORKER_IN_APP=false when running `npm run worker` as a separate process instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER_IN_APP === "false") return;
  const { startWorker } = await import("./worker/run");
  // Don't block server start-up on the queue; log failures loudly instead.
  startWorker().catch((err) => console.error("[worker] failed to start in-app", err));
}
