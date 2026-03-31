// Template Service - Business logic for reply template management
import type { DatabaseClient, ReplyTemplate } from "./database";
import { validateMarkdownForEmail } from "./markdown";

export interface TemplateValidationError {
  field: string;
  message: string;
}

export interface CreateTemplateInput {
  campaign_id: number;
  name: string;
  subject: string;
  body: string;
  layout_type: "text_only" | "standard_header";
  send_timing: "immediate" | "office_hours" | "scheduled";
  scheduled_for?: string;
  active: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  subject?: string;
  body?: string;
  layout_type?: "text_only" | "standard_header";
  send_timing?: "immediate" | "office_hours" | "scheduled";
  scheduled_for?: string;
  active?: boolean;
}

/**
 * Validates template data before creation or update
 */
export function validateTemplateData(
  data: CreateTemplateInput | UpdateTemplateInput,
): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  // Validate markdown body if present
  if ("body" in data && data.body) {
    const markdownErrors = validateMarkdownForEmail(data.body);
    for (const error of markdownErrors) {
      errors.push({ field: "body", message: error });
    }
  }

  // Validate scheduled_for is provided when send_timing is 'scheduled'
  if ("send_timing" in data && data.send_timing === "scheduled") {
    if (!("scheduled_for" in data) || !data.scheduled_for) {
      errors.push({
        field: "scheduled_for",
        message: "scheduled_for is required when send_timing is 'scheduled'",
      });
    }
  }

  // Validate scheduled_for is in the future
  if ("scheduled_for" in data && data.scheduled_for) {
    const scheduledDate = new Date(data.scheduled_for);
    const now = new Date();
    if (scheduledDate <= now) {
      errors.push({
        field: "scheduled_for",
        message: "scheduled_for must be in the future",
      });
    }
  }

  return errors;
}

/**
 * Creates a new reply template with validation
 */
export async function createReplyTemplate(
  db: DatabaseClient,
  data: CreateTemplateInput,
): Promise<{ success: true; template: ReplyTemplate } | { success: false; errors: TemplateValidationError[] }> {
  // Validate input data
  const validationErrors = validateTemplateData(data);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  try {
    // If this template is being set as active, deactivate other templates for this campaign
    if (data.active) {
      await db.deactivateOtherTemplates(data.campaign_id);
    }

    // Create the template using Supabase client
    const template = await db.request<ReplyTemplate[]>("/reply_templates", {
      method: "POST",
      body: JSON.stringify(data),
    });

    return { success: true, template: template[0] };
  } catch (error) {
    console.error("Error creating template:", error);
    return {
      success: false,
      errors: [
        {
          field: "general",
          message: error instanceof Error ? error.message : "Failed to create template",
        },
      ],
    };
  }
}

/**
 * Updates an existing reply template with validation
 */
export async function updateReplyTemplate(
  db: DatabaseClient,
  templateId: number,
  updates: UpdateTemplateInput,
): Promise<{ success: true; template: ReplyTemplate } | { success: false; errors: TemplateValidationError[] }> {
  // Validate input data
  const validationErrors = validateTemplateData(updates);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  try {
    // Get existing template
    const existingTemplate = await db.getReplyTemplateById(templateId);
    if (!existingTemplate) {
      return {
        success: false,
        errors: [{ field: "id", message: "Template not found" }],
      };
    }

    // If activating this template, deactivate others for the same campaign
    if (updates.active === true) {
      await db.deactivateOtherTemplates(
        existingTemplate.campaign_id,
        templateId,
      );
    }

    // Update the template
    const updatedTemplate = await db.updateReplyTemplate(templateId, updates);
    return { success: true, template: updatedTemplate };
  } catch (error) {
    console.error("Error updating template:", error);
    return {
      success: false,
      errors: [
        {
          field: "general",
          message: error instanceof Error ? error.message : "Failed to update template",
        },
      ],
    };
  }
}

/**
 * Ensures only one template is active per politician-campaign pair
 */
export async function ensureSingleActiveTemplate(
  db: DatabaseClient,
  campaignId: number,
  activeTemplateId: number,
): Promise<void> {
  await db.deactivateOtherTemplates(campaignId, activeTemplateId);
}

/**
 * Gets the active template for a specific politician and campaign
 */
export async function getActiveTemplate(
  db: DatabaseClient,
  campaignId: number,
): Promise<ReplyTemplate | null> {
  return await db.getActiveTemplateForCampaign(campaignId);
}

/**
 * Validates that a politician owns a template (for authorization)
 */
export async function validateTemplateOwnership(
  db: DatabaseClient,
  templateId: number,
): Promise<boolean> {
  return await db.verifyPoliticianOwnsTemplate(templateId);
}
