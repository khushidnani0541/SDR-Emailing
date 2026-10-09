// Pure RFC 2822 message builder for Gmail's `raw` field.

export type OutgoingEmail = {
  from: { name: string | null; email: string };
  to: { name: string; email: string };
  subject: string;
  body: string; // plain text, already including signature
  inReplyTo?: string | null; // Message-ID of the Day 1 email, for threading
};

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word for non-ASCII header values.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function address(name: string | null, email: string): string {
  if (!name) return email;
  const safe = name.replace(/["\\\r\n]/g, "");
  return /^[\x20-\x7e]*$/.test(safe) ? `"${safe}" <${email}>` : `${encodeHeader(safe)} <${email}>`;
}

export function replySubject(day1Subject: string): string {
  return /^re:/i.test(day1Subject.trim()) ? day1Subject.trim() : `Re: ${day1Subject.trim()}`;
}

export function buildMime(msg: OutgoingEmail): string {
  const headers = [
    `From: ${address(msg.from.name, msg.from.email)}`,
    `To: ${address(msg.to.name, msg.to.email)}`,
    `Subject: ${encodeHeader(msg.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${msg.inReplyTo}`, `References: ${msg.inReplyTo}`);
  const body = Buffer.from(msg.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export function toRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

export function withSignature(body: string, signature: string | null | undefined, fallbackName: string | null): string {
  const sig = signature?.trim() || fallbackName || "";
  return sig ? `${body.trim()}\n${sig}` : body.trim();
}

/** Classifies other participants' messages in a thread. */
export function classifyThread(
  sdrEmail: string,
  messages: { from: string; subject: string }[],
): "none" | "replied" | "bounced" {
  let result: "none" | "replied" | "bounced" = "none";
  for (const m of messages) {
    const from = m.from.toLowerCase();
    if (from.includes(sdrEmail.toLowerCase())) continue;
    if (/mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(from) || /delivery status notification|undeliverable|delivery has failed|address not found/i.test(m.subject)) {
      result = "bounced";
      continue;
    }
    return "replied"; // a human reply wins over a bounce notice
  }
  return result;
}
