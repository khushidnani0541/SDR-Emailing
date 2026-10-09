import { google, type gmail_v1 } from "googleapis";
import { clientForUser } from "@/auth/google";
import { buildMime, classifyThread, toRaw, type OutgoingEmail } from "./mime";

async function gmailFor(userId: string): Promise<gmail_v1.Gmail> {
  return google.gmail({ version: "v1", auth: await clientForUser(userId) });
}

function status(err: unknown): number | undefined {
  return (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
}

/** Creates (or replaces) a draft in the SDR's Gmail. Follow-ups pass the Day 1 threadId. */
export async function upsertDraft(
  userId: string,
  email: OutgoingEmail,
  opts: { threadId?: string | null; existingDraftId?: string | null } = {},
): Promise<{ draftId: string; threadId: string | null }> {
  const gmail = await gmailFor(userId);
  const message = { raw: toRaw(buildMime(email)), threadId: opts.threadId ?? undefined };
  if (opts.existingDraftId) {
    try {
      const { data } = await gmail.users.drafts.update({ userId: "me", id: opts.existingDraftId, requestBody: { id: opts.existingDraftId, message } });
      return { draftId: data.id!, threadId: data.message?.threadId ?? null };
    } catch (err) {
      if (status(err) !== 404) throw err; // deleted in Gmail -> create a fresh one
    }
  }
  const { data } = await gmail.users.drafts.create({ userId: "me", requestBody: { message } });
  return { draftId: data.id!, threadId: data.message?.threadId ?? null };
}

export async function deleteDraft(userId: string, draftId: string): Promise<void> {
  const gmail = await gmailFor(userId);
  try {
    await gmail.users.drafts.delete({ userId: "me", id: draftId });
  } catch (err) {
    if (status(err) !== 404) throw err;
  }
}

export type SendResult =
  | { ok: true; messageId: string; threadId: string; rfcMessageId: string | null }
  | { ok: false; reason: "draft_deleted" };

/** Sends an existing draft (whatever the SDR may have edited in Gmail) and returns its RFC Message-ID for threading. */
export async function sendDraft(userId: string, draftId: string): Promise<SendResult> {
  const gmail = await gmailFor(userId);
  let sent: gmail_v1.Schema$Message;
  try {
    ({ data: sent } = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } }));
  } catch (err) {
    if (status(err) === 404) return { ok: false, reason: "draft_deleted" };
    throw err;
  }
  const { data: meta } = await gmail.users.messages.get({
    userId: "me",
    id: sent.id!,
    format: "metadata",
    metadataHeaders: ["Message-ID", "Message-Id"],
  });
  const rfcMessageId = meta.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? null;
  return { ok: true, messageId: sent.id!, threadId: sent.threadId!, rfcMessageId };
}

/** Looks at the Day 1 thread for a prospect reply or a bounce. */
export async function checkThread(userId: string, sdrEmail: string, threadId: string): Promise<"none" | "replied" | "bounced"> {
  const gmail = await gmailFor(userId);
  try {
    const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "metadata", metadataHeaders: ["From", "Subject"] });
    const messages = (data.messages ?? [])
      .filter((m) => !(m.labelIds ?? []).includes("DRAFT"))
      .map((m) => {
        const h = m.payload?.headers ?? [];
        return {
          from: h.find((x) => x.name?.toLowerCase() === "from")?.value ?? "",
          subject: h.find((x) => x.name?.toLowerCase() === "subject")?.value ?? "",
        };
      });
    return classifyThread(sdrEmail, messages);
  } catch (err) {
    if (status(err) === 404) return "none";
    throw err;
  }
}
