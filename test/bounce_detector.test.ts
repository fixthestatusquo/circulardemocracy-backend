import { describe, expect, it } from "vitest";
import { encode32 } from "dxid";
import { extractBouncedMessageId, isBounceEmail } from "../src/bounce_detector";

describe("isBounceEmail", () => {
  it("returns true when from is mailer-daemon", () => {
    expect(
      isBounceEmail({
        from: [{ email: "mailer-daemon@example.org", name: "Mail Delivery Subsystem" }],
        subject: "Undelivered: Your message",
      }),
    ).toBe(true);
  });

  it("returns true when from name contains Mail Delivery Subsystem", () => {
    expect(
      isBounceEmail({
        from: [{ email: "noreply@example.org", name: "Mail Delivery Subsystem" }],
        subject: "Delivery Status Notification",
      }),
    ).toBe(true);
  });

  it("returns true when from is postmaster", () => {
    expect(
      isBounceEmail({
        from: [{ email: "postmaster@mx.example.com", name: "" }],
        subject: "failure notice",
      }),
    ).toBe(true);
  });

  it("returns true for subject-based detection when from is generic", () => {
    expect(
      isBounceEmail({
        from: [{ email: "noreply@server.com", name: "Mailer" }],
        subject: "Undelivered Mail Returned to Sender",
      }),
    ).toBe(true);
  });

  it("returns true for 'delivery failure' subject", () => {
    expect(
      isBounceEmail({
        from: [{ email: "somesystem@example.com", name: "" }],
        subject: "Delivery Failure: Your message could not be delivered",
      }),
    ).toBe(true);
  });

  it("returns true for 'returned to sender' subject", () => {
    expect(
      isBounceEmail({
        from: [{ email: "system@example.com", name: "" }],
        subject: "Returned to sender: mailbox full",
      }),
    ).toBe(true);
  });

  it("returns true for 'bounce' subject", () => {
    expect(
      isBounceEmail({
        from: [{ email: "nobody@example.com", name: "" }],
        subject: "Bounce: address unknown",
      }),
    ).toBe(true);
  });

  it("returns false for a normal constituent email", () => {
    expect(
      isBounceEmail({
        from: [{ email: "constituent@gmail.com", name: "Jane Doe" }],
        subject: "Support climate action bill",
      }),
    ).toBe(false);
  });

  it("returns false for a campaign tool email", () => {
    expect(
      isBounceEmail({
        from: [{ email: "campaign-tool@action.org", name: "Action Campaign" }],
        subject: "Please sign the petition",
      }),
    ).toBe(false);
  });

  it("returns false when from is empty", () => {
    expect(
      isBounceEmail({
        from: undefined,
        subject: "Hello",
      }),
    ).toBe(false);
  });

  it("returns false when subject is empty", () => {
    expect(
      isBounceEmail({
        from: [{ email: "user@example.com", name: "" }],
        subject: undefined,
      }),
    ).toBe(false);
  });
});

describe("extractBouncedMessageId", () => {
  it("extracts message id from a standard email header blob", () => {
    const blob = [
      "Return-Path: <sender@example.com>",
      "Received: from mx.example.com by mail.example.com",
      `Message-ID: <reply-${encode32(12345)}@circulardemocracy.org>`,
      "From: Campaign Tool <campaign@tool.com>",
      "To: constituent@example.com",
      "Subject: Your message was received",
      "",
      "Hello, thanks for your message.",
    ].join("\n");

    expect(extractBouncedMessageId(blob)).toBe(12345);
  });

  it("extracts message id from a full RFC 2822 raw email", () => {
    const blob = [
      "Delivered-To: replies@circulardemocracy.org",
      "Received: by 2002:a17:90b:1234:0:0:0:0 with SMTP",
      `Message-ID: <reply-${encode32(999999)}@circulardemocracy.org>`,
      "Date: Mon, 10 Jun 2025 10:00:00 +0000",
      "From: Office <office@mp.gov>",
      "To: constituent@example.com",
      "In-Reply-To: <original-msg-id@mail.gmail.com>",
      "Subject: Re: Your support",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Thank you for contacting my office.",
    ].join("\n");

    expect(extractBouncedMessageId(blob)).toBe(999999);
  });

  it("returns null when no reply- Message-ID is present", () => {
    const blob = [
      "Message-ID: <some-other-id@example.com>",
      "From: someone@example.com",
      "Subject: Hello",
    ].join("\n");

    expect(extractBouncedMessageId(blob)).toBeNull();
  });

  it("returns null when Message-ID has wrong format", () => {
    const blob = [
      "Message-ID: <reply-abc@example.com>",
      "From: someone@example.com",
    ].join("\n");

    // "abc" is not a valid dxid → should return null
    expect(extractBouncedMessageId(blob)).toBeNull();
  });

  it("returns null on empty blob", () => {
    expect(extractBouncedMessageId("")).toBeNull();
  });

  it("returns null on blob with only whitespace", () => {
    expect(extractBouncedMessageId("   \n  \n  ")).toBeNull();
  });

  it("handles Message-ID with different domain", () => {
    const blob = [
      `Message-ID: <reply-${encode32(777)}@other-domain.com>`,
      "From: system@other.com",
    ].join("\n");

    expect(extractBouncedMessageId(blob)).toBe(777);
  });

  it("handles multiline headers before Message-ID", () => {
    const blob = [
      "Received: from mail.example.com",
      " by relay.example.com with ESMTP",
      " for <recipient@example.com>;",
      " Mon, 10 Jun 2025 12:00:00 +0000",
      `Message-ID: <reply-${encode32(42)}@example.org>`,
      "From: test@example.org",
    ].join("\n");

    expect(extractBouncedMessageId(blob)).toBe(42);
  });
});
