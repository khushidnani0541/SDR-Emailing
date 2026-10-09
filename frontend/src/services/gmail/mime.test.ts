import { describe, expect, it } from "vitest";
import { buildMime, classifyThread, replySubject, withSignature } from "./mime";

describe("MIME builder", () => {
  it("adds threading headers for follow-ups and encodes UTF-8", () => {
    const mime = buildMime({
      from: { name: "Ria Sen", email: "ria@faclon.com" },
      to: { name: "Asha Rao", email: "asha@acme.com" },
      subject: replySubject("Kiln energy at Dolvi"),
      body: "Hi Asha,\nSaving ₹ on power.\nBest,",
      inReplyTo: "<abc@mail.gmail.com>",
    });
    expect(mime).toContain('From: "Ria Sen" <ria@faclon.com>');
    expect(mime).toContain("Subject: Re: Kiln energy at Dolvi");
    expect(mime).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(mime).toContain("References: <abc@mail.gmail.com>");
    const body = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Hi Asha,\r\nSaving ₹ on power.\r\nBest,");
  });
  it("does not double the Re: prefix", () => {
    expect(replySubject("Re: hello")).toBe("Re: hello");
  });
  it("encodes non-ASCII subjects", () => {
    expect(buildMime({ from: { name: null, email: "a@b.co" }, to: { name: "X", email: "x@y.co" }, subject: "Café", body: "x" })).toContain(
      "Subject: =?UTF-8?B?",
    );
  });
  it("appends the signature", () => {
    expect(withSignature("Hi\nBest,", "Ria Sen\nFaclon Labs", null)).toBe("Hi\nBest,\nRia Sen\nFaclon Labs");
  });
});

describe("thread classification", () => {
  it("detects replies and bounces", () => {
    const sdr = "ria@faclon.com";
    expect(classifyThread(sdr, [{ from: "Ria <ria@faclon.com>", subject: "Hi" }])).toBe("none");
    expect(classifyThread(sdr, [{ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)" }])).toBe("bounced");
    expect(classifyThread(sdr, [{ from: "Asha <asha@acme.com>", subject: "Re: Hi" }])).toBe("replied");
  });
});
