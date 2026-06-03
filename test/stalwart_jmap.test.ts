import { describe, expect, it } from "vitest";
import {
  buildStalwartImpersonationLogin,
  emailHostedOnDomain,
  encodeBasicAuth,
  normalizeMailDomain,
  resolveJmapAdminCredentials,
} from "../src/stalwart_jmap";

describe("encodeBasicAuth", () => {
  it("builds a Basic header", () => {
    expect(encodeBasicAuth("alice", "p")).toBe(
      `Basic ${Buffer.from("alice:p").toString("base64")}`,
    );
  });
});

describe("buildStalwartImpersonationLogin", () => {
  it("joins target and admin with %", () => {
    expect(
      buildStalwartImpersonationLogin("admin@example.com", "user@example.com"),
    ).toBe("user@example.com%admin@example.com");
  });
});

describe("resolveJmapAdminCredentials", () => {
  it("returns admin email and password from env", () => {
    expect(
      resolveJmapAdminCredentials({
        JMAP_ADMIN_EMAIL: "admin@example.com",
        JMAP_ADMIN_PASSWORD: "admin-pass",
      }),
    ).toEqual({
      adminEmail: "admin@example.com",
      adminPassword: "admin-pass",
    });
  });

  it("returns null when admin credentials are missing", () => {
    expect(resolveJmapAdminCredentials({})).toBeNull();
  });
});

describe("normalizeMailDomain / emailHostedOnDomain", () => {
  it("normalizes domains", () => {
    expect(normalizeMailDomain("@Example.ORG")).toBe("example.org");
  });

  it("detects hosted email", () => {
    expect(emailHostedOnDomain("Rep@Example.ORG", "example.org")).toBe(true);
    expect(emailHostedOnDomain("x@other.org", "example.org")).toBe(false);
  });
});
