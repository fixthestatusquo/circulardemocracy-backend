// Shared JMAP query helpers for CLI scripts (bin/fetch.ts, bin/fix-delayed-bounces.ts, etc.)

import { JmapClient } from "jmap-cli";

export interface JmapQueryResult {
  emails: any[];
  total: number;
  position: number;
}

/**
 * Query JMAP Email/query + Email/get with configurable properties.
 * Defaults to the full fetch property set.
 */
export async function jmapQueryWithBodies(
  client: JmapClient,
  filter: Record<string, unknown> | null,
  limit = 50,
  position?: number,
  properties?: string[],
): Promise<JmapQueryResult> {
  const session = await (client as any)._discoverSession();
  const accountId = client.getAccountId(session);
  const queryArgs: Record<string, unknown> = { accountId, limit };
  if (filter) queryArgs.filter = filter;
  if (position !== undefined) queryArgs.position = position;

  const props = properties ?? [
    "id", "messageId", "receivedAt", "mailboxIds",
    "subject", "from", "to", "cc", "replyTo",
    "preview", "textBody", "htmlBody", "bodyValues", "attachments", "headers",
  ];

  const json = await (client as any)._requestJson(session.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        ["Email/query", queryArgs, "q"],
        ["Email/get", {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: props,
          ...(properties ? {} : { fetchTextBodyValues: true, fetchHTMLBodyValues: true }),
        }, "g"],
      ],
    }),
  });

  const queryResp = json.methodResponses?.find((r: any[]) => r[0] === "Email/query");
  const getResp = json.methodResponses?.find((r: any[]) => r[0] === "Email/get");

  const emails = Array.isArray(getResp?.[1]?.list) ? getResp[1].list : [];
  const total = queryResp?.[1]?.total ?? 0;
  const respPosition = queryResp?.[1]?.position ?? 0;

  return { emails, total, position: respPosition };
}
