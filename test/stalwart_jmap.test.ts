import { describe, expect, it } from "vitest";
import {
  buildStalwartImpersonationLogin,
  emailHostedOnDomain,
  encodeBasicAuth,
  normalizeMailDomain,
  resolveRelayImpersonationCredentials,
} from "../src/stalwart_jmap";

describe("encodeBasicAuth", () => {
  it("builds a Basic header", () => {
    expect(encodeBasicAuth("alice", "p")).toBe(
      `Basic ${Buffer.from("alice:p").toString("base64")}`,
    );
  });
});

describe("buildStalwartImpersonationLogin", () => {
  it("joins target and relay with %", () => {
    expect(
      buildStalwartImpersonationLogin(
        "relay@example.com",
        "user@example.com",
      ),
    ).toBe("user@example.com%relay@example.com");
  });
});

describe("resolveRelayImpersonationCredentials", () => {
  it("returns relay email and password from env", () => {
    expect(
      resolveRelayImpersonationCredentials({
        RELAY_SERVICE_ACCOUNT_EMAIL: "relay@example.com",
        RELAY_SERVICE_ACCOUNT_PASSWORD: "relay-pass",
      }),
    ).toEqual({
      relayEmail: "relay@example.com",
      relayPassword: "relay-pass",
    });
  });

  it("returns null when relay credentials are missing", () => {
    expect(resolveRelayImpersonationCredentials({})).toBeNull();
  });
});

describe("normalizeMailDomain / emailHostedOnDomain", () => {
  it("normalizes domains", () => {
    expect(normalizeMailDomain("@Example.ORG")).toBe("example.org");
  });

  it("detects hosted email", () => {
    expect(
      emailHostedOnDomain("Rep@Example.ORG", "example.org"),
    ).toBe(true);
    expect(emailHostedOnDomain("x@other.org", "example.org")).toBe(false);
  });
});
