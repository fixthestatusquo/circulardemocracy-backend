// JMAP Client for sending emails via Stalwart mail server
// JMAP (JSON Meta Application Protocol) is a modern email protocol

export interface JMAPConfig {
  apiUrl: string;
  accountId: string;
  username: string;
  password: string;
}

export interface EmailMessage {
  from: string;
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

/**
 * JMAP Client for sending emails
 */
export class JMAPClient {
  private config: JMAPConfig;

  constructor(config: JMAPConfig) {
    this.config = config;
  }

  /**
   * Sends an email using JMAP protocol
   */
  async sendEmail(email: EmailMessage): Promise<JMAPSendResult> {
    try {
      // JMAP requires authentication
      const authHeader = `Basic ${btoa(`${this.config.username}:${this.config.password}`)}`;

      // Step 1: Create the email object
      const emailObject = this.buildEmailObject(email);

      // Step 2: Send via JMAP Email/set method
      const response = await fetch(this.config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
          methodCalls: [
            [
              "Email/set",
              {
                accountId: this.config.accountId,
                create: {
                  draft: emailObject,
                },
              },
              "0",
            ],
            [
              "EmailSubmission/set",
              {
                accountId: this.config.accountId,
                create: {
                  submission: {
                    emailId: "#draft",
                    envelope: {
                      mailFrom: {
                        email: email.from,
                      },
                      rcptTo: email.to.map((addr) => ({ email: addr })),
                    },
                  },
                },
              },
              "1",
            ],
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`JMAP request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Check for errors in JMAP response
      if (result.methodResponses) {
        const emailSetResponse = result.methodResponses[0];
        const submissionResponse = result.methodResponses[1];

        if (emailSetResponse[0] === "Email/set") {
          const created = emailSetResponse[1].created;
          if (created && created.draft) {
            const messageId = created.draft.id;

            // Check submission success
            if (submissionResponse[0] === "EmailSubmission/set") {
              const submissionCreated = submissionResponse[1].created;
              if (submissionCreated && submissionCreated.submission) {
                return {
                  success: true,
                  messageId: messageId,
                };
              }
            }
          }
        }

        // Check for errors
        const notCreated = emailSetResponse[1].notCreated;
        if (notCreated) {
          const errorKey = Object.keys(notCreated)[0];
          const error = notCreated[errorKey];
          throw new Error(`JMAP Email/set failed: ${error.type} - ${error.description}`);
        }
      }

      throw new Error("Unexpected JMAP response format");
    } catch (error) {
      console.error("JMAP send error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Builds a JMAP email object from our simplified EmailMessage format
   */
  private buildEmailObject(email: EmailMessage): any {
    const emailObj: any = {
      mailboxIds: {
        Sent: true, // Store in Sent folder
      },
      from: [{ email: email.from }],
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
        charset: "utf-8",
        partId: "text",
      });
    }

    // Add HTML part if provided
    if (email.htmlBody) {
      bodyParts.push({
        type: "text/html",
        charset: "utf-8",
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
      const authHeader = `Basic ${btoa(`${this.config.username}:${this.config.password}`)}`;

      const response = await fetch(this.config.apiUrl, {
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
