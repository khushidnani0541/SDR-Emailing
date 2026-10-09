// Pre-provisions the SDR roster (idempotent). Gmail is connected when each SDR first signs in.
import "@/lib/scripts-env";
import { db, pool, schema } from "@/db";
import { SDR_ROSTER } from "@/lib/sdr-roster";
import { DEFAULT_SETTINGS } from "@/services/cadence/actions";

async function main() {
  for (const sdr of SDR_ROSTER) {
    await db
      .insert(schema.users)
      .values({ email: sdr.email, name: sdr.name, settings: { ...DEFAULT_SETTINGS } })
      .onConflictDoUpdate({ target: schema.users.email, set: { name: sdr.name } });
    console.log(`SDR ready: ${sdr.name} <${sdr.email}>`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
