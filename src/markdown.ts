// Markdown utility for rendering email templates
// Uses the 'marked' library for reliable markdown parsing

import { marked } from "marked";

export interface MarkdownRenderOptions {
  sanitize?: boolean;
}

/**
 * Converts markdown text to HTML suitable for email rendering
 * Uses the marked library for standards-compliant markdown parsing
 */
export function renderMarkdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
): string {
  if (!markdown) {
    return "";
  }

  // Configure marked options
  marked.setOptions({
    breaks: true, // Convert \n to <br>
    gfm: true, // GitHub Flavored Markdown
  });

  // Parse markdown to HTML
  const html = marked.parse(markdown) as string;

  // Optionally sanitize (remove dangerous HTML)
  if (options.sanitize) {
    return sanitizeHtml(html);
  }

  return html;
}

/**
 * Converts markdown to plain text (strips all formatting)
 * Useful for text-only email layouts
 */
export function renderMarkdownToPlainText(markdown: string): string {
  if (!markdown) {
    return "";
  }

  // First convert to HTML using marked
  const html = marked.parse(markdown) as string;

  // Strip all HTML tags
  let text = html.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/ {2,}/g, " ");

  return text.trim();
}

/**
 * Sanitizes HTML by removing potentially dangerous elements
 * Basic implementation - for production, consider using a library like DOMPurify
 */
function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let sanitized = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    "",
  );

  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "");
  sanitized = sanitized.replace(/\son\w+\s*=\s*[^\s>]*/gi, "");

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, "");

  return sanitized;
}

/**
 * Validates markdown content for email safety
 * Returns array of validation errors, empty if valid
 */
export function validateMarkdownForEmail(markdown: string): string[] {
  const errors: string[] = [];

  if (!markdown || markdown.trim().length === 0) {
    errors.push("Markdown content cannot be empty");
    return errors;
  }

  if (markdown.length > 50000) {
    errors.push("Markdown content exceeds maximum length of 50,000 characters");
  }

  // Check for potentially dangerous patterns in the raw markdown
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /<iframe/i,
    /<embed/i,
    /<object/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(markdown)) {
      errors.push("Markdown contains potentially unsafe content");
      break;
    }
  }

  return errors;
}
