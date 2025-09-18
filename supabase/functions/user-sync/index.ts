
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { Hono } from 'https://deno.land/x/hono@v3.12.0/mod.ts'

// Define the structure of the incoming webhook payload from Supabase
interface SupabaseAuthWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: {
    id: string;
    email?: string;
    // Other user fields...
  };
  old_record: {
    id: string;
  } | null;
}

// Initialize Hono app
const app = new Hono()

// Define the webhook endpoint
app.post('/user-sync', async (c) => {
  const payload = await c.req.json<SupabaseAuthWebhookPayload>();

  // --- Get Secrets ---
  // These must be set in your Supabase project's environment variables
  const stalwartApiUrl = Deno.env.get('STALWART_API_URL');
  const stalwartApiToken = Deno.env.get('STALWART_API_TOKEN');

  if (!stalwartApiUrl || !stalwartApiToken) {
    console.error('Stalwart API URL or Token not configured.');
    return c.json({ error: 'Server configuration missing' }, 500);
  }

  try {
    switch (payload.type) {
      case 'INSERT':
        console.log(`Received user created event for: ${payload.record.email}`);
        // TODO: Implement the logic to create a user in Stalwart
        // This is a placeholder for the actual API call.
        // You would typically make a POST request to a Stalwart API endpoint.
        /*
        await fetch(`${stalwartApiUrl}/users`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stalwartApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: payload.record.email,
            // You might need to generate a password here or handle it based on your security model
          })
        });
        */
        console.log('Placeholder: User would be created in Stalwart.');
        break;

      case 'UPDATE':
        console.log(`Received user updated event for ID: ${payload.record.id}`);
        // TODO: Implement user update logic if necessary (e.g., password change)
        // Note: Supabase webhooks for password changes are more complex to set up.
        console.log('Placeholder: User would be updated in Stalwart.');
        break;

      case 'DELETE':
        console.log(`Received user deleted event for ID: ${payload.old_record?.id}`);
        // TODO: Implement user deletion in Stalwart
        /*
        await fetch(`${stalwartApiUrl}/users/${payload.old_record?.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${stalwartApiToken}` }
        });
        */
        console.log('Placeholder: User would be deleted in Stalwart.');
        break;

      default:
        console.warn(`Received unhandled event type: ${payload.type}`);
    }

    return c.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('Failed to process webhook:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Start the Deno server
serve(app.fetch);
