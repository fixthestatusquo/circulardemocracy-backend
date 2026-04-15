// Email Layout Renderer - Renders email templates with different layouts
// Supports text_only and standard_header layouts

import { renderMarkdownToHtml, renderMarkdownToPlainText } from "./markdown";

export type LayoutType = "text_only" | "standard_header";

export interface EmailLayoutInput {
  subject: string;
  markdown_body: string;
  layout_type: LayoutType;
  campaign_name?: string;
  politician_name?: string;
  politician_email?: string;
}

export interface RenderedEmail {
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/**
 * Renders an email with the specified layout
 */
export function renderEmailLayout(input: EmailLayoutInput): RenderedEmail {
  const textBody = renderMarkdownToPlainText(input.markdown_body);

  if (input.layout_type === "text_only") {
    return renderTextOnlyLayout(input.subject, textBody);
  }

  if (input.layout_type === "standard_header") {
    return renderStandardHeaderLayout(input, textBody);
  }

  throw new Error(`Unknown layout type: ${input.layout_type}`);
}

/**
 * Renders text-only layout (plain text email)
 */
function renderTextOnlyLayout(
  subject: string,
  textBody: string,
): RenderedEmail {
  return {
    subject,
    textBody,
    htmlBody: undefined, // No HTML for text-only
  };
}

/**
 * Renders standard header layout with campaign info and HTML
 */
function renderStandardHeaderLayout(
  input: EmailLayoutInput,
  textBody: string,
): RenderedEmail {
  const htmlBody = renderMarkdownToHtml(input.markdown_body);

  // Build header section
  const headerHtml = buildHeaderSection(
    input.campaign_name,
    input.politician_name,
    input.politician_email,
  );

  // Wrap in full email template
  const fullHtml = wrapInEmailTemplate(input.subject, headerHtml, htmlBody);

  // Add header to text version as well
  const headerText = buildHeaderText(
    input.campaign_name,
    input.politician_name,
    input.politician_email,
  );
  const fullTextBody = headerText ? `${headerText}\n\n${textBody}` : textBody;

  return {
    subject: input.subject,
    textBody: fullTextBody,
    htmlBody: fullHtml,
  };
}

/**
 * Builds HTML header section with campaign info
 */
function buildHeaderSection(
  campaignName?: string,
  politicianName?: string,
  politicianEmail?: string,
): string {
  if (!campaignName && !politicianName && !politicianEmail) {
    return "";
  }

  let headerHtml = '<div class="email-header">';

  if (campaignName) {
    headerHtml += `<h2 class="campaign-name">${escapeHtml(campaignName)}</h2>`;
  }

  if (politicianName || politicianEmail) {
    headerHtml += '<div class="contact-info">';

    if (politicianName) {
      headerHtml += `<p class="politician-name">${escapeHtml(politicianName)}</p>`;
    }

    if (politicianEmail) {
      headerHtml += `<p class="politician-email"><a href="mailto:${escapeHtml(politicianEmail)}">${escapeHtml(politicianEmail)}</a></p>`;
    }

    headerHtml += "</div>";
  }

  headerHtml += "</div>";
  headerHtml += '<hr class="header-divider">';

  return headerHtml;
}

/**
 * Builds plain text header section
 */
function buildHeaderText(
  campaignName?: string,
  politicianName?: string,
  politicianEmail?: string,
): string {
  if (!campaignName && !politicianName && !politicianEmail) {
    return "";
  }

  const lines: string[] = [];

  if (campaignName) {
    lines.push(campaignName);
  }

  if (politicianName) {
    lines.push(politicianName);
  }

  if (politicianEmail) {
    lines.push(politicianEmail);
  }

  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n${"-".repeat(50)}`;
}

/**
 * Wraps content in full HTML email template
 */
function wrapInEmailTemplate(
  subject: string,
  headerHtml: string,
  contentHtml: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .email-container {
      background-color: #ffffff;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .email-header {
      margin-bottom: 20px;
    }
    .campaign-name {
      color: #2c3e50;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 10px 0;
    }
    .contact-info {
      color: #666;
      font-size: 14px;
    }
    .politician-name {
      margin: 5px 0;
      font-weight: 500;
    }
    .politician-email {
      margin: 5px 0;
    }
    .politician-email a {
      color: #3498db;
      text-decoration: none;
    }
    .politician-email a:hover {
      text-decoration: underline;
    }
    .header-divider {
      border: none;
      border-top: 2px solid #e0e0e0;
      margin: 20px 0;
    }
    .email-content {
      color: #333;
    }
    .email-content h1,
    .email-content h2,
    .email-content h3 {
      color: #2c3e50;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .email-content h1 {
      font-size: 28px;
    }
    .email-content h2 {
      font-size: 24px;
    }
    .email-content h3 {
      font-size: 20px;
    }
    .email-content p {
      margin: 15px 0;
    }
    .email-content a {
      color: #3498db;
      text-decoration: none;
    }
    .email-content a:hover {
      text-decoration: underline;
    }
    .email-content ul,
    .email-content ol {
      margin: 15px 0;
      padding-left: 30px;
    }
    .email-content li {
      margin: 8px 0;
    }
    .email-content strong {
      font-weight: 600;
    }
    .email-content em {
      font-style: italic;
    }
    .email-content blockquote {
      border-left: 4px solid #e0e0e0;
      padding-left: 15px;
      margin: 15px 0;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="email-container">
    ${headerHtml}
    <div class="email-content">
      ${contentHtml}
    </div>
  </div>
</body>
</html>
  `.trim();
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
