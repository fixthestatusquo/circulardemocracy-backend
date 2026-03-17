# Circular Democracy API

API for processing citizen messages to politicians

**Version:** 1.0.0

## Endpoints

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

**Responses:**

- **200**: A list of reply templates

**CLI Example:**

```bash
./cli /api/v1/reply-templates
```

---

#### POST

**Request Body:**

Content-Type: `application/json`

| Property | Type | Required | Description |
|----------|------|----------|--------------|
| politician_id | number | ✓ |  |
| campaign_id | number | ✓ |  |
| name | string | ✓ |  |
| subject | string | ✓ |  |
| body | string | ✓ |  |

**Responses:**

- **201**: The created reply template

**CLI Example:**

```bash
./cli /api/v1/reply-templates --method=POST --name=example --param=value
```

---

### /api/v1/reply-templates/{id}

#### GET

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

