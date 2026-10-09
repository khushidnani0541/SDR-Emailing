import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { errorMessage } from "@/lib/concurrency";
import { DEFAULT_TIMEZONE, localDate } from "@/services/cadence/calendar";
import { effectiveSettings } from "@/services/cadence/actions";
import { hasMorningRun, morningRun } from "@/services/cadence/morning";
import { sendScheduledEmail } from "@/services/cadence/send";
import { runUploadPipeline, draftAndStore } from "@/services/cadence/upload";
import { getActiveTemplates } from "@/services/drafting/templates";
import { getAppSettings } from "@/services/cadence/context";
import { getBoss, QUEUES } from "./queue";

function localHHMM(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Starts all background job handlers. Safe to call once per process. */
export async function startWorker(opts: { handleSignals?: boolean } = {}) {
  const boss = await getBoss({ worker: true });

  await boss.work<{ uploadId: string }>(QUEUES.uploadPipeline, async ([job]) => {
    console.log(`[worker] upload pipeline ${job.data.uploadId}`);
    await runUploadPipeline(job.data.uploadId);
  });

  await boss.work<{ emailId: string }>(QUEUES.sendEmail, { localConcurrency: 2 }, async ([job]) => {
    const outcome = await sendScheduledEmail(job.data.emailId);
    console.log(`[worker] send ${job.data.emailId}: ${outcome}`);
  });

  await boss.work<{ userId: string }>(QUEUES.morningRun, async ([job]) => {
    const stats = await morningRun(job.data.userId);
    console.log(`[worker] morning run ${job.data.userId}`, stats);
  });

  await boss.work<{ emailId: string; instruction: string | null }>(QUEUES.regenerate, async ([job]) => {
    const [row] = await db
      .select({ email: schema.emails, prospect: schema.prospects })
      .from(schema.emails)
      .innerJoin(schema.prospects, eq(schema.prospects.id, schema.emails.prospectId))
      .where(eq(schema.emails.id, job.data.emailId));
    if (!row) return;
    await draftAndStore(
      { userId: row.email.userId, prospectId: row.prospect.id },
      row.prospect,
      row.email.day as 1 | 4 | 7 | 12,
      row.email.dueDate,
      await getActiveTemplates(),
      await getAppSettings(),
      job.data.instruction,
    );
  });

  // Every 10 minutes: start today's morning run for each SDR whose local run time has passed.
  await boss.work(QUEUES.morningTick, async () => {
    const users = await db.select().from(schema.users).where(eq(schema.users.gmailConnected, true));
    for (const user of users) {
      try {
        const s = effectiveSettings(user);
        const tz = s.timezone ?? DEFAULT_TIMEZONE;
        const today = localDate(new Date(), tz);
        if (localHHMM(new Date(), tz) < s.morningRunTime) continue;
        if (await hasMorningRun(user.id, today)) continue;
        await boss.send(QUEUES.morningRun, { userId: user.id }, { singletonKey: `morning:${user.id}:${today}` });
      } catch (err) {
        console.error(`[worker] morning tick failed for ${user.email}: ${errorMessage(err)}`);
      }
    }
  });
  await boss.schedule(QUEUES.morningTick, "*/10 * * * *");

  console.log("[worker] ready");
  if (opts.handleSignals) {
    const shutdown = async () => {
      console.log("[worker] shutting down");
      await boss.stop({ graceful: true, timeout: 30_000 });
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}
