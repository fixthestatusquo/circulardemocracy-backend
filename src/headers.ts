/**
 * Email Headers - Defines different header styles for outgoing emails.
 */

export interface HeaderInput {
  campaignName?: string;
  politicianName?: string;
  politicianEmail?: string;
  politicianPosition?: string;
  politicianParty?: string;
}

export interface RenderedHeader {
  html: string;
  text: string;
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Standard Header Layout - Used for general campaigns.
 */
export function renderStandardHeader(input: HeaderInput): RenderedHeader {
  const { campaignName, politicianName, politicianEmail } = input;

  // HTML
  let html = '<div class="email-header">';
  if (campaignName) {
    html += `<h2 class="campaign-name">${escapeHtml(campaignName)}</h2>`;
  }
  if (politicianName || politicianEmail) {
    html += '<div class="contact-info">';
    if (politicianName) {
      html += `<p class="politician-name">${escapeHtml(politicianName)}</p>`;
    }
    if (politicianEmail) {
      html += `<p class="politician-email"><a href="mailto:${escapeHtml(politicianEmail)}">${escapeHtml(politicianEmail)}</a></p>`;
    }
    html += "</div>";
  }
  html += "</div>";
  html += '<hr class="header-divider">';

  // Text
  const lines: string[] = [];
  if (campaignName) lines.push(campaignName);
  if (politicianName) lines.push(politicianName);
  if (politicianEmail) lines.push(politicianEmail);
  const text = lines.length > 0 ? `${lines.join("\n")}\n${"-".repeat(50)}` : "";

  return { html, text };
}

/**
 * European Parliament (EP) Header Layout - Title with EU flag and politician name.
 */
export function renderEPHeader(input: HeaderInput): RenderedHeader {
  const { politicianName } = input;
  const title = input.politicianPosition
    ? `🇪🇺 ${input.politicianPosition}`
    : "";

  // HTML
  const html = `
<div class="email-header ep-header">
  <h2 class="politician-title">${escapeHtml(politicianName || "MEP")}</h2>
  <h3 class="title">${escapeHtml(title)}</h3>
</div>
<hr class="header-divider">`.trim();

  // Text
  const text = `${title}\n${"=".repeat(50)}`;

  return { html, text };
}
