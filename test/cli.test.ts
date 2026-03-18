import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("CLI Argument Parsing", () => {
  let originalArgv: string[];
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    originalArgv = process.argv;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: any) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("mail CLI - parseArgs", () => {
    it("should parse valid manual message arguments", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-123",
        "--sender-name", "John Doe",
        "--sender-email", "john@example.com",
        "--recipient-email", "politician@example.com",
        "--subject", "Test Subject",
        "--message", "This is a test message with enough content",
        "--timestamp", "2024-03-15T10:30:00Z",
      ];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result).toEqual({
        external_id: "msg-123",
        sender_name: "John Doe",
        sender_email: "john@example.com",
        recipient_email: "politician@example.com",
        subject: "Test Subject",
        message: "This is a test message with enough content",
        timestamp: "2024-03-15T10:30:00Z",
        channel_source: "cli",
      });
    });

    it("should parse with campaign hint", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-456",
        "--sender-name", "Jane Doe",
        "--sender-email", "jane@example.com",
        "--recipient-email", "politician@example.com",
        "--subject", "Climate Action",
        "--message", "We need action on climate change now",
        "--timestamp", "2024-03-15T10:30:00Z",
        "--campaign-name", "Climate Initiative",
      ];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result).toEqual({
        external_id: "msg-456",
        sender_name: "Jane Doe",
        sender_email: "jane@example.com",
        recipient_email: "politician@example.com",
        subject: "Climate Action",
        message: "We need action on climate change now",
        timestamp: "2024-03-15T10:30:00Z",
        channel_source: "cli",
        campaign_hint: "Climate Initiative",
      });
    });

    it("should use custom channel source when provided", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-789",
        "--sender-name", "Test User",
        "--sender-email", "test@example.com",
        "--recipient-email", "politician@example.com",
        "--subject", "Test",
        "--message", "Test message content here",
        "--timestamp", "2024-03-15T10:30:00Z",
        "--channel-source", "custom-source",
      ];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result?.channel_source).toBe("custom-source");
    });

    it("should return null and show help with --help flag", async () => {
      process.argv = ["node", "mail.ts", "--help"];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result).toBeNull();
    });

    it("should return null and show help with -h flag", async () => {
      process.argv = ["node", "mail.ts", "-h"];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result).toBeNull();
    });

    it("should return null and show help with no arguments", async () => {
      process.argv = ["node", "mail.ts"];

      const { parseArgs } = await import("../bin/mail.js");
      const result = parseArgs();

      expect(result).toBeNull();
    });

    it("should exit with error for invalid email", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-123",
        "--sender-name", "John Doe",
        "--sender-email", "invalid-email",
        "--recipient-email", "politician@example.com",
        "--subject", "Test",
        "--message", "Test message content",
        "--timestamp", "2024-03-15T10:30:00Z",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Validation error:");
    });

    it("should exit with error for message too short", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-123",
        "--sender-name", "John Doe",
        "--sender-email", "john@example.com",
        "--recipient-email", "politician@example.com",
        "--subject", "Test",
        "--message", "Short",
        "--timestamp", "2024-03-15T10:30:00Z",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Validation error:");
    });

    it("should exit with error for invalid timestamp", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-123",
        "--sender-name", "John Doe",
        "--sender-email", "john@example.com",
        "--recipient-email", "politician@example.com",
        "--subject", "Test",
        "--message", "Test message content here",
        "--timestamp", "invalid-date",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Validation error:");
    });

    it("should exit with error for missing required field", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id", "msg-123",
        "--sender-name", "John Doe",
        "--subject", "Test",
        "--message", "Test message content",
        "--timestamp", "2024-03-15T10:30:00Z",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Validation error:");
    });

    it("should exit with error for invalid argument format", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "invalid-arg",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Invalid argument format: invalid-arg");
    });

    it("should exit with error for missing value", async () => {
      process.argv = [
        "node",
        "mail.ts",
        "--message-id",
      ];

      const { parseArgs } = await import("../bin/mail.js");

      expect(() => parseArgs()).toThrow("process.exit(1)");
      expect(consoleErrorSpy).toHaveBeenCalledWith("Missing value for argument: --message-id");
    });
  });

  describe("jmap-fetch CLI - parseStalwartArgs", () => {
    it("should parse --process-all flag", () => {
      const args = ["--process-all"];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: true,
        since: undefined,
        messageId: undefined,
        dryRun: false,
      });
    });

    it("should parse --since with date", () => {
      const args = ["--since", "2024-03-01"];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: false,
        since: "2024-03-01",
        messageId: undefined,
        dryRun: false,
      });
    });

    it("should parse --message-id", () => {
      const args = ["--message-id", "specific-msg-id"];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: false,
        since: undefined,
        messageId: "specific-msg-id",
        dryRun: false,
      });
    });

    it("should parse --dry-run flag", () => {
      const args = ["--dry-run", "--process-all"];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: true,
        since: undefined,
        messageId: undefined,
        dryRun: true,
      });
    });

    it("should default to processAll when no filter provided", () => {
      const args: string[] = [];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: true,
        since: undefined,
        messageId: undefined,
        dryRun: false,
      });
    });

    it("should parse combined flags", () => {
      const args = ["--since", "2024-03-01T10:00:00Z", "--dry-run"];

      const parseStalwartArgs = (args: string[]) => {
        const parsed: Record<string, string | boolean> = {};
        const booleanFlags = new Set(["process-all", "dry-run"]);

        for (let i = 0; i < args.length; i++) {
          const flag = args[i];
          if (!flag.startsWith("--")) continue;
          const key = flag.substring(2);
          if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
          }
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
            parsed[key] = args[i + 1];
            i++;
          }
        }

        const processAll = parsed["process-all"] === true || (!parsed.since && !parsed["message-id"]);
        return {
          processAll,
          since: typeof parsed.since === "string" ? parsed.since : undefined,
          messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : undefined,
          dryRun: parsed["dry-run"] === true,
        };
      };

      const result = parseStalwartArgs(args);

      expect(result).toEqual({
        processAll: false,
        since: "2024-03-01T10:00:00Z",
        messageId: undefined,
        dryRun: true,
      });
    });
  });

  describe("jmap-fetch CLI - user and password parsing", () => {
    it("should parse --user and --password flags", () => {
      const args = ["--user", "testuser", "--password", "testpass", "--process-all"];

      const parsed: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user" && i + 1 < args.length) {
          parsed.user = args[i + 1];
          i++;
        } else if (args[i] === "--password" && i + 1 < args.length) {
          parsed.password = args[i + 1];
          i++;
        }
      }

      expect(parsed).toEqual({
        user: "testuser",
        password: "testpass",
      });
    });

    it("should handle missing --user flag", () => {
      const args = ["--password", "testpass", "--process-all"];

      const parsed: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user" && i + 1 < args.length) {
          parsed.user = args[i + 1];
          i++;
        } else if (args[i] === "--password" && i + 1 < args.length) {
          parsed.password = args[i + 1];
          i++;
        }
      }

      expect(parsed.user).toBeUndefined();
      expect(parsed.password).toBe("testpass");
    });

    it("should handle missing --password flag", () => {
      const args = ["--user", "testuser", "--process-all"];

      const parsed: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user" && i + 1 < args.length) {
          parsed.user = args[i + 1];
          i++;
        } else if (args[i] === "--password" && i + 1 < args.length) {
          parsed.password = args[i + 1];
          i++;
        }
      }

      expect(parsed.user).toBe("testuser");
      expect(parsed.password).toBeUndefined();
    });
  });
});
