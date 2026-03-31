# Circular Democracy API

API for processing citizen messages to politicians

**Version:** 1.0.0

## Endpoints

### /api/v1/messages/analytics

#### GET

**Summary:** /api/v1/messages/analytics

Retrieve message analytics showing hourly message counts grouped by campaign for the last N days (default: 7 days)

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| days | string | query |  |  |

**Responses:**

- **200**: Message analytics grouped by hour and campaign
- **500**: Internal server error

**CLI Example:**

```bash
./cli /api/v1/messages/analytics --days=example
```

---

### /api/v1/messages

#### POST

**Summary:** /api/v1/messages

Receives a citizen message, classifies it by campaign, and stores it for politician response

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| external_id | string | ✓ | Unique identifier from source system |
| sender_name | string | ✓ | Full name of the message sender |
| sender_email | string | ✓ | Email address of the sender |
| recipient_email | string | ✓ | Email address of the target politician |
| subject | string | ✓ | Message subject line |
| message | string | ✓ | Message body content |
| html_content | string |  | HTML version of message content |
| text_content | string |  | Plain text version of message content |
| timestamp | string | ✓ | When the message was originally sent (ISO 8601) |
| channel_source | string |  | Source system identifier |
| campaign_hint | string |  | Optional campaign name hint from sender |

**Responses:**

- **200**: Message processed successfully
- **400**: Invalid input data
- **401**: Unauthorized - Invalid API Key
- **404**: Politician not found
- **409**: Duplicate message
- **500**: Internal server error

**CLI Example:**

```bash
./cli /api/v1/messages --method=POST --name=example --param=value
```

---

### /api/v1/campaigns

#### GET

**Responses:**

- **200**: A list of campaigns

**CLI Example:**

```bash
./cli /api/v1/campaigns
```

---

#### POST

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| name | string | ✓ |  |
| slug | string | ✓ |  |
| description | string |  |  |

**Responses:**

- **201**: The created campaign

**CLI Example:**

```bash
./cli /api/v1/campaigns --method=POST --name=example --param=value
```

---

### /api/v1/campaigns/stats

#### GET

**Summary:** /api/v1/campaigns/stats

**Responses:**

- **200**: Campaign statistics

**CLI Example:**

```bash
./cli /api/v1/campaigns/stats
```

---

### /api/v1/campaigns/{id}

#### GET

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Responses:**

- **200**: A single campaign
- **404**: Campaign not found

**CLI Example:**

```bash
./cli /api/v1/campaigns/--id=123
```

---

### /api/v1/politicians

#### GET

**Responses:**

- **200**: A list of politicians

**CLI Example:**

```bash
./cli /api/v1/politicians
```

---

### /api/v1/politicians/{id}

#### GET

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Responses:**

- **200**: A single politician
- **404**: Politician not found

**CLI Example:**

```bash
./cli /api/v1/politicians/--id=123
```

---

### /api/v1/reply-templates

#### GET

**Summary:** /api/v1/reply-templates

Retrieve a list of all campaign auto-reply templates. Templates define automated email responses sent to supporters.

**Responses:**

- **200**: A list of reply templates

**CLI Example:**

```bash
./cli /api/v1/reply-templates
```

---

#### POST

**Summary:** /api/v1/reply-templates

Create a new auto-reply template for a campaign. The template defines the email content, layout, and scheduling for automated responses to supporters. If active=true, this will deactivate other templates for the same campaign.

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| campaign_id | number | ✓ |  |
| name | string | ✓ |  |
| subject | string | ✓ |  |
| message_body | string | ✓ |  |
| layout_type | string | ✓ |  |
| send_timing | string | ✓ |  |
| scheduled_for | string |  |  |
| active | boolean | ✓ |  |

**Responses:**

- **201**: The created reply template
- **400**: Validation failed - check request body

**CLI Example:**

```bash
./cli /api/v1/reply-templates --method=POST --name=example --param=value
```

---

### /api/v1/reply-templates/{id}

#### GET

**Summary:** /api/v1/reply-templates/{id}

Retrieve detailed information about a specific campaign auto-reply template.

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Responses:**

- **200**: A single reply template
- **404**: Reply template not found

**CLI Example:**

```bash
./cli /api/v1/reply-templates/--id=123
```

---

#### PATCH

**Summary:** /api/v1/reply-templates/{id}

Update an existing auto-reply template. You can modify the subject, message body, layout type, send timing, and active status. Setting active=true will deactivate other templates for the same campaign.

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| name | string |  |  |
| subject | string |  |  |
| message_body | string |  |  |
| layout_type | string |  |  |
| send_timing | string |  |  |
| scheduled_for | string |  |  |
| active | boolean |  |  |

**Responses:**

- **200**: The updated reply template
- **400**: Validation failed - check request body
- **403**: Forbidden - not authorized to update this template
- **404**: Reply template not found

**CLI Example:**

```bash
./cli /api/v1/reply-templates/--id=123 --method=PATCH --name=example --param=value
```

---

#### DELETE

**Summary:** /api/v1/reply-templates/{id}

Permanently delete an auto-reply template. This action cannot be undone.

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Responses:**

- **204**: Reply template deleted successfully
- **403**: Forbidden - not authorized to delete this template
- **404**: Reply template not found

**CLI Example:**

```bash
./cli /api/v1/reply-templates/--id=123 --method=DELETE
```

---

### /api/v1/reply-templates/{id}/toggle-active

#### POST

**Summary:** /api/v1/reply-templates/{id}/toggle-active

Activate or deactivate an auto-reply template. Only one template can be active per campaign. Setting active=true will automatically deactivate other templates for the same campaign.

**Parameters:**

| Name | Type | In | Required | Description |
|------|------|----|---------|--------------|
| id | string | path | ✓ |  |

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| active | boolean | ✓ | Set to true to activate, false to deactivate |

**Responses:**

- **200**: Template activation status updated
- **404**: Reply template not found

**CLI Example:**

```bash
./cli /api/v1/reply-templates/--id=123/toggle-active --method=POST --name=example --param=value
```

---

### /api/v1/login

#### POST

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| email | string | ✓ |  |
| password | string | ✓ |  |

**Responses:**

- **200**: Successful login, returns session object
- **401**: Unauthorized, invalid credentials

**CLI Example:**

```bash
./cli /api/v1/login --method=POST --name=example --param=value
```

---

### /mta-hook

#### POST

**Summary:** /mta-hook

Processes incoming emails and provides routing instructions

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| messageId | string | ✓ | Stalwart internal message ID |
| queueId | string |  | Queue ID for tracking |
| sender | string | ✓ | Envelope sender |
| recipients | array | ✓ | All envelope recipients |
| headers | object | ✓ | All email headers |
| subject | string |  |  |
| body | object |  |  |
| size | number | ✓ | Message size in bytes |
| timestamp | number | ✓ | Unix timestamp when received |
| spf | object |  |  |
| dkim | array |  |  |
| dmarc | object |  |  |

**Responses:**

- **200**: Instructions for message handling
- **500**: Error - default to accept

**CLI Example:**

```bash
./cli /mta-hook --method=POST --name=example --param=value
```

---

