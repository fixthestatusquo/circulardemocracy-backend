import { describe, expect, it } from "vitest";
import { normalizeEmailSubject } from "../src/email_subject";

describe("normalizeEmailSubject", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeEmailSubject("  Thank you  ")).toBe("Thank you");
  });

  it("leaves plain ASCII subjects unchanged", () => {
    expect(normalizeEmailSubject("Thank you for sending")).toBe(
      "Thank you for sending",
    );
  });

  it("decodes us-ascii Q encoded-words and trims", () => {
    expect(
      normalizeEmailSubject("=?us-ascii?Q?thank_you_for_sending_?="),
    ).toBe("thank you for sending");
  });

  it("decodes folded encoded-words", () => {
    const folded =
      "=?us-ascii?Q?thank_?=\r\n =?us-ascii?Q?you_?=";
    expect(normalizeEmailSubject(folded)).toBe("thank you");
  });

  it("decodes base64 utf-8 encoded-words", () => {
    expect(normalizeEmailSubject("=?UTF-8?B?YWN0aW9uIG5vdw==?=")).toBe(
      "action now",
    );
  });
});
