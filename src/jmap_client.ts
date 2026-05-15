// JMAP Client for sending emails via Stalwart mail server
// JMAP (JSON Meta Application Protocol) is a modern email protocol

/**
 * JMAP session document URL from `JMAP_URL` (trimmed, no trailing slash) + `/.well-known/jmap`.
 */
export function jmapWellKnownSessionUrl(
  env: Record<string, string | undefined | null>,
): string | null {
  const base = String(env.JMAP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  return `${base}/.well-known/jmap`;
}

export interface JMAPConfig {
  apiUrl: string;
  accountId: string;
  bearerToken: string;
}

export interface EmailMessage {
  from: string;
  /** Display name for the From header (politician-facing identity). */
  fromName?: string;
  to: string[];
  replyTo?: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
}

export interface JMAPSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

interface IdentityGetResponse {
  list?: Array<{ id: string; email?: string | null }>;
}

export function resolveMailAccountIdFromSession(session: {
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}): string {
  const primaryMailAccount =
    session.primaryAccounts?.["urn:ietf:params:jmap:mail"];
  if (primaryMailAccount) {
    return primaryMailAccount;
  }
  const firstAccountId = Object.keys(session.accounts || {})[0];
  if (firstAccountId) {
    return firstAccountId;
  }
  throw new Error("No JMAP mail account found in session response");
}

/**
 * JMAP Client for sending emails
 */
export class JMAPClient {
  private config: JMAPConfig;
  /** Cached POST endpoint (from session when config uses `.well-known/jmap`). */
  private resolvedPostApiUrl: string | null = null;
  /** Cached Sent mailbox id (JMAP requires opaque ids, not the label "Sent"). */
  private sentMailboxId: string | null = null;
  /** Single service identity id used for all outbound submissions. */
  private serviceIdentityId: string | null = null;

  constructor(config: JMAPConfig) {
    this.config = config;
  }

  private authHeader(): string {
    const token = this.config.bearerToken.trim();
    if (token) {
      return `Bearer ${token}`;
    }
    throw new Error("JMAP bearer token is required");
  }

  /**
   * Stalwart (and most servers) expose a session URL at `/.well-known/jmap`;
   * JSON `apiUrl` must be used for method calls.
   */
  private async resolvePostApiUrl(): Promise<string> {
    if (this.resolvedPostApiUrl) {
      return this.resolvedPostApiUrl;
    }
    const configured = this.config.apiUrl.trim();
    if (!configured.includes(".well-known/jmap")) {
      this.resolvedPostApiUrl = configured;
      return this.resolvedPostApiUrl;
    }
    const authHeader = this.authHeader();
    const response = await fetch(configured, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`JMAP session GET failed (${response.status})`);
    }
    const session = (await response.json()) as JmapSessionResponse;
    if (!session?.apiUrl) {
      throw new Error("JMAP session response missing apiUrl");
    }
    this.resolvedPostApiUrl = session.apiUrl;
    return this.resolvedPostApiUrl;
  }

  private async jmapPost(
    apiUrl: string,
    authHeader: string,
    methodCalls: unknown[],
  ): Promise<{ methodResponses?: unknown[][] }> {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        using: [
          "urn:ietf:params:jmap:core",
          "urn:ietf:params:jmap:mail",
          "urn:ietf:params:jmap:submission",
        ],
        methodCalls,
      }),
    });
    if (!response.ok) {
      throw new Error(`JMAP API request failed (${response.status})`);
    }
    return (await response.json()) as { methodResponses?: unknown[][] };
  }

  private getMethodResponse(
    methodResponses: unknown[][],
    methodName: string,
    callId: string,
  ): unknown {
    const row = methodResponses.find(
      (entry) =>
        Array.isArray(entry) && entry[0] === methodName && entry[2] === callId,
    );
    if (!row) {
      throw new Error(
        `JMAP response missing ${methodName} for callId=${callId}`,
      );
    }
    return row[1];
  }

  /** Resolve the mailbox id for role `sent` (e.g. Stalwart "Sent Items"). */
  private async resolveSentMailboxId(
    apiUrl: string,
    authHeader: string,
  ): Promise<string> {
    if (this.sentMailboxId) {
      return this.sentMailboxId;
    }
    const json = await this.jmapPost(apiUrl, authHeader, [
      [
        "Mailbox/query",
        {
          accountId: this.config.accountId,
          filter: { role: "sent" },
          limit: 5,
        },
        "sentQuery",
      ],
    ]);
    const responses = json.methodResponses;
    if (!responses) {
      throw new Error("Invalid JMAP response: missing methodResponses");
    }
    let queryResult = this.getMethodResponse(
      responses,
      "Mailbox/query",
      "sentQuery",
    ) as { ids?: string[] };
    let id = queryResult.ids?.[0];
    if (!id) {
      const json2 = await this.jmapPost(apiUrl, authHeader, [
        [
          "Mailbox/query",
          {
            accountId: this.config.accountId,
            filter: { name: "Sent Items" },
            limit: 5,
          },
          "sentByName",
        ],
      ]);
      const responses2 = json2.methodResponses;
      if (!responses2) {
        throw new Error("Invalid JMAP response: missing methodResponses");
      }
      queryResult = this.getMethodResponse(
        responses2,
        "Mailbox/query",
        "sentByName",
      ) as { ids?: string[] };
      id = queryResult.ids?.[0];
    }
    if (!id) {
      throw new Error(
        'No Sent mailbox found (tried role "sent" and name "Sent Items").',
      );
    }
    this.sentMailboxId = id;
    return id;
  }

  /**
   * Resolve a single service identity for all submissions.
   * Outbound header impersonation is supported via MIME headers only.
   */
  private async resolveServiceIdentityId(
    apiUrl: string,
    authHeader: string,
  ): Promise<string> {
    if (this.serviceIdentityId) {
      return this.serviceIdentityId;
    }
    const json = await this.jmapPost(apiUrl, authHeader, [
      [
        "Identity/get",
        {
          accountId: this.config.accountId,
          ids: null,
        },
        "identityGet",
      ],
    ]);
    const responses = json.methodResponses;
    if (!responses) {
      throw new Error("Invalid JMAP response: missing methodResponses");
    }
    const body = this.getMethodResponse(
      responses,
      "Identity/get",
      "identityGet",
    ) as IdentityGetResponse;

    const firstIdentity = body.list?.[0];
    if (!firstIdentity?.id) {
      throw new Error(
        "No JMAP service identity found for relay account; configure at least one identity.",
      );
    }

    this.serviceIdentityId = firstIdentity.id;
    return this.serviceIdentityId;
  }

  /**
   * Sends an email using JMAP protocol
   */
  async sendEmail(email: EmailMessage): Promise<JMAPSendResult> {
    try {
      const authHeader = this.authHeader();
      const apiUrl = await this.resolvePostApiUrl();
      const sentMailboxId = await this.resolveSentMailboxId(apiUrl, authHeader);
      const identityId = await this.resolveServiceIdentityId(apiUrl, authHeader);

      const emailObject = this.buildEmailObject(email, sentMailboxId);

      // Two HTTP calls: batched result references are rejected by some JMAP servers (e.g. Stalwart).
      const createResult = await this.jmapPost(apiUrl, authHeader, [
        [
          "Email/set",
          {
            accountId: this.config.accountId,
            create: {
              outbound: emailObject,
            },
          },
          "createEmail",
        ],
      ]);

      if (!createResult.methodResponses?.[0]) {
        throw new Error("Unexpected JMAP response format");
      }
      const emailSetResponse = createResult.methodResponses[0];
      if (emailSetResponse[0] !== "Email/set") {
        throw new Error("Unexpected JMAP response format");
      }
      const notCreated = (
        emailSetResponse[1] as {
          notCreated?: Record<string, { type?: string; description?: string }>;
        }
      ).notCreated;
      if (notCreated) {
        const errorKey = Object.keys(notCreated)[0];
        const err = notCreated[errorKey];
        throw new Error(
          `JMAP Email/set failed: ${err?.type ?? "unknown"} - ${err?.description ?? errorKey}`,
        );
      }
      const created = (
        emailSetResponse[1] as { created?: { outbound?: { id: string } } }
      ).created;
      if (!created?.outbound?.id) {
        throw new Error("Unexpected JMAP response format");
      }
      const messageId = created.outbound.id;

      const submitResult = await this.jmapPost(apiUrl, authHeader, [
        [
          "EmailSubmission/set",
          {
            accountId: this.config.accountId,
            create: {
              sendIt: {
                identityId,
                emailId: messageId,
                envelope: {
                  mailFrom: {
                    email: email.from,
                  },
                  rcptTo: email.to.map((addr) => ({ email: addr })),
                },
              },
            },
          },
          "submitEmail",
        ],
      ]);

      if (!submitResult.methodResponses?.[0]) {
        throw new Error("Unexpected JMAP response format");
      }
      const submissionResponse = submitResult.methodResponses[0];
      if (submissionResponse[0] !== "EmailSubmission/set") {
        throw new Error("Unexpected JMAP response format");
      }
      const subBody = submissionResponse[1] as {
        created?: { sendIt?: unknown };
        notCreated?: Record<string, { type?: string; description?: string }>;
      };
      if (subBody.notCreated) {
        const sk = Object.keys(subBody.notCreated)[0];
        const err = subBody.notCreated[sk];
        throw new Error(
          `JMAP EmailSubmission/set failed: ${err?.type ?? "unknown"} - ${err?.description ?? sk}`,
        );
      }
      if (subBody.created?.sendIt) {
        return {
          success: true,
          messageId,
        };
      }

      throw new Error("Unexpected JMAP response format");
    } catch (_error) {
      console.error("JMAP send failed");
      return {
        success: false,
        error: "JMAP send failed",
      };
    }
  }

  /**
   * Builds a JMAP email object from our simplified EmailMessage format
   */
  private buildEmailObject(email: EmailMessage, sentMailboxId: string): any {
    const fromEntry: { email: string; name?: string } = { email: email.from };
    if (email.fromName?.trim()) {
      fromEntry.name = email.fromName.trim();
    }
    const emailObj: any = {
      mailboxIds: {
        [sentMailboxId]: true,
      },
      from: [fromEntry],
      to: email.to.map((addr) => ({ email: addr })),
      subject: email.subject,
    };

    // Add Reply-To if specified
    if (email.replyTo) {
      emailObj.replyTo = [{ email: email.replyTo }];
    }

    // Build body parts
    const bodyParts: any[] = [];

    // Add text part if provided
    if (email.textBody) {
      bodyParts.push({
        type: "text/plain",
        partId: "text",
      });
    }

    // Add HTML part if provided
    if (email.htmlBody) {
      bodyParts.push({
        type: "text/html",
        partId: "html",
      });
    }

    // If both text and HTML, use multipart/alternative
    if (email.textBody && email.htmlBody) {
      emailObj.bodyStructure = {
        type: "multipart/alternative",
        subParts: bodyParts,
      };
      emailObj.bodyValues = {
        text: {
          value: email.textBody,
        },
        html: {
          value: email.htmlBody,
        },
      };
    } else if (email.htmlBody) {
      emailObj.bodyStructure = bodyParts[0];
      emailObj.bodyValues = {
        html: {
          value: email.htmlBody,
        },
      };
    } else if (email.textBody) {
      emailObj.bodyStructure = bodyParts[0];
      emailObj.bodyValues = {
        text: {
          value: email.textBody,
        },
      };
    }

    return emailObj;
  }

  /**
   * Tests the JMAP connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const authHeader = this.authHeader();
      const apiUrl = await this.resolvePostApiUrl();
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core"],
          methodCalls: [
            [
              "Core/echo",
              {
                hello: "world",
              },
              "0",
            ],
          ],
        }),
      });

      return response.ok;
    } catch (error) {
      console.error("JMAP connection test failed:", error);
      return false;
    }
  }
}
