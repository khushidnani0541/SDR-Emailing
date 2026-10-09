import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const QUEUES = {
  uploadPipeline: "upload-pipeline", // { uploadId }
  sendEmail: "send-email", // { emailId }
  morningTick: "morning-tick", // cron: starts morning runs for SDRs whose local run time has passed
  morningRun: "morning-run", // { userId, date }
  regenerate: "regenerate-email", // { emailId, instruction }
} as const;

type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

/** Shared pg-boss instance. The web app only enqueues; the worker process also works the queues. */
export function getBoss(opts: { worker?: boolean } = {}): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = (async () => {
      const boss = new PgBoss({
        connectionString: env().DATABASE_URL,
        schema: "pgboss",
        supervise: !!opts.worker,
        schedule: !!opts.worker,
      });
      boss.on("error", (err) => console.error("[queue] error", err));
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        if (!(await boss.getQueue(name))) {
          await boss.createQueue(name, {
            retryLimit: name === QUEUES.sendEmail ? 3 : 1,
            retryDelay: 60,
            expireInSeconds: name === QUEUES.uploadPipeline || name === QUEUES.morningRun ? 3 * 3600 : 15 * 60,
          });
        }
      }
      return boss;
    })().catch((err) => {
      globalForBoss.boss = undefined;
      throw err;
    });
  }
  return globalForBoss.boss;
}

export async function enqueue(name: QueueName, data: object, options: { startAfter?: Date; singletonKey?: string } = {}) {
  const boss = await getBoss();
  return boss.send(name, data, options);
}
