# Circular Democracy API

API for processing citizen messages to politicians

**Version:** 1.0.0

## Endpoints

### /api/v1/messages

#### POST

**Summary:** Process incoming citizen message

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
| timestamp | string | ✓ | When the message was originally sent (ISO 8601) |
| channel_source | string |  | Source system identifier |
| campaign_hint | string |  | Optional campaign name hint from sender |

**Responses:**

- **200**: Message processed successfully
- **400**: Invalid input data
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

### /api/v1/campaigns/stats

#### GET

**Summary:** Get campaign statistics

**Responses:**

- **200**: Campaign statistics

**CLI Example:**

```bash
./cli /api/v1/campaigns/stats
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

