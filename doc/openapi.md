---
title: Circular Democracy API v1.0.0
language_tabs:
  - shell: Shell
  - http: HTTP
  - javascript: JavaScript
  - ruby: Ruby
  - python: Python
  - php: PHP
  - java: Java
  - go: Go
toc_footers: []
includes: []
search: true
highlight_theme: darkula
headingLevel: 2

---

<!-- Generator: Widdershins v4.0.1 -->

<h1 id="circular-democracy-api">Circular Democracy API v1.0.0</h1>

> Scroll down for code samples, example requests and responses. Select a language for code samples from the tabs above or the mobile navigation menu.

API for processing citizen messages to politicians

Base URLs:

* <a href="https://api.circulardemocracy.org">https://api.circulardemocracy.org</a>

* <a href="http://localhost:8787">http://localhost:8787</a>

<h1 id="circular-democracy-api-messages">Messages</h1>

## post__api_v1_messages

> Code samples

```shell
# You can also use wget
curl -X POST https://api.circulardemocracy.org/api/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json'

```

```http
POST https://api.circulardemocracy.org/api/v1/messages HTTP/1.1
Host: api.circulardemocracy.org
Content-Type: application/json
Accept: application/json

```

```javascript
const inputBody = '{
  "external_id": "string",
  "sender_name": "string",
  "sender_email": "user@example.com",
  "recipient_email": "user@example.com",
  "subject": "string",
  "message": "stringstri",
  "timestamp": "2019-08-24T14:15:22Z",
  "channel_source": "string",
  "campaign_hint": "string"
}';
const headers = {
  'Content-Type':'application/json',
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/messages',
{
  method: 'POST',
  body: inputBody,
  headers: headers
})
.then(function(res) {
    return res.json();
}).then(function(body) {
    console.log(body);
});

```

```ruby
require 'rest-client'
require 'json'

headers = {
  'Content-Type' => 'application/json',
  'Accept' => 'application/json'
}

result = RestClient.post 'https://api.circulardemocracy.org/api/v1/messages',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
}

r = requests.post('https://api.circulardemocracy.org/api/v1/messages', headers = headers)

print(r.json())

```

```php
<?php

require 'vendor/autoload.php';

$headers = array(
    'Content-Type' => 'application/json',
    'Accept' => 'application/json',
);

$client = new \GuzzleHttp\Client();

// Define array of request body.
$request_body = array();

try {
    $response = $client->request('POST','https://api.circulardemocracy.org/api/v1/messages', array(
        'headers' => $headers,
        'json' => $request_body,
       )
    );
    print_r($response->getBody()->getContents());
 }
 catch (\GuzzleHttp\Exception\BadResponseException $e) {
    // handle exception or api errors.
    print_r($e->getMessage());
 }

 // ...

```

```java
URL obj = new URL("https://api.circulardemocracy.org/api/v1/messages");
HttpURLConnection con = (HttpURLConnection) obj.openConnection();
con.setRequestMethod("POST");
int responseCode = con.getResponseCode();
BufferedReader in = new BufferedReader(
    new InputStreamReader(con.getInputStream()));
String inputLine;
StringBuffer response = new StringBuffer();
while ((inputLine = in.readLine()) != null) {
    response.append(inputLine);
}
in.close();
System.out.println(response.toString());

```

```go
package main

import (
       "bytes"
       "net/http"
)

func main() {

    headers := map[string][]string{
        "Content-Type": []string{"application/json"},
        "Accept": []string{"application/json"},
    }

    data := bytes.NewBuffer([]byte{jsonReq})
    req, err := http.NewRequest("POST", "https://api.circulardemocracy.org/api/v1/messages", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`POST /api/v1/messages`

*Process incoming citizen message*

Receives a citizen message, classifies it by campaign, and stores it for politician response

> Body parameter

```json
{
  "external_id": "string",
  "sender_name": "string",
  "sender_email": "user@example.com",
  "recipient_email": "user@example.com",
  "subject": "string",
  "message": "stringstri",
  "timestamp": "2019-08-24T14:15:22Z",
  "channel_source": "string",
  "campaign_hint": "string"
}
```

<h3 id="post__api_v1_messages-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|body|body|object|false|none|
|» external_id|body|string|true|Unique identifier from source system|
|» sender_name|body|string|true|Full name of the message sender|
|» sender_email|body|string(email)|true|Email address of the sender|
|» recipient_email|body|string(email)|true|Email address of the target politician|
|» subject|body|string|true|Message subject line|
|» message|body|string|true|Message body content|
|» timestamp|body|string(date-time)|true|When the message was originally sent (ISO 8601)|
|» channel_source|body|string|false|Source system identifier|
|» campaign_hint|body|string|false|Optional campaign name hint from sender|

> Example responses

> 200 Response

```json
{
  "success": true,
  "message_id": 0,
  "status": "processed",
  "campaign_id": 0,
  "campaign_name": "string",
  "confidence": 1,
  "duplicate_rank": 0,
  "errors": [
    "string"
  ]
}
```

<h3 id="post__api_v1_messages-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Message processed successfully|Inline|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|Invalid input data|Inline|
|404|[Not Found](https://tools.ietf.org/html/rfc7231#section-6.5.4)|Politician not found|Inline|
|409|[Conflict](https://tools.ietf.org/html/rfc7231#section-6.5.8)|Duplicate message|Inline|
|500|[Internal Server Error](https://tools.ietf.org/html/rfc7231#section-6.6.1)|Internal server error|Inline|

<h3 id="post__api_v1_messages-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» success|boolean|true|none|none|
|» message_id|number|false|none|none|
|» status|string|true|none|none|
|» campaign_id|number|false|none|none|
|» campaign_name|string|false|none|none|
|» confidence|number|false|none|none|
|» duplicate_rank|number|false|none|none|
|» errors|[string]|false|none|none|

#### Enumerated Values

|Property|Value|
|---|---|
|status|processed|
|status|failed|
|status|politician_not_found|
|status|duplicate|

Status Code **400**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» success|boolean|true|none|none|
|» error|string|true|none|none|
|» details|string|false|none|none|

Status Code **404**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» success|boolean|true|none|none|
|» message_id|number|false|none|none|
|» status|string|true|none|none|
|» campaign_id|number|false|none|none|
|» campaign_name|string|false|none|none|
|» confidence|number|false|none|none|
|» duplicate_rank|number|false|none|none|
|» errors|[string]|false|none|none|

#### Enumerated Values

|Property|Value|
|---|---|
|status|processed|
|status|failed|
|status|politician_not_found|
|status|duplicate|

Status Code **409**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» success|boolean|true|none|none|
|» message_id|number|false|none|none|
|» status|string|true|none|none|
|» campaign_id|number|false|none|none|
|» campaign_name|string|false|none|none|
|» confidence|number|false|none|none|
|» duplicate_rank|number|false|none|none|
|» errors|[string]|false|none|none|

#### Enumerated Values

|Property|Value|
|---|---|
|status|processed|
|status|failed|
|status|politician_not_found|
|status|duplicate|

Status Code **500**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» success|boolean|true|none|none|
|» error|string|true|none|none|
|» details|string|false|none|none|

<aside class="success">
This operation does not require authentication
</aside>

<h1 id="circular-democracy-api-statistics">Statistics</h1>

## get__api_v1_campaigns_stats

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/campaigns/stats \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/campaigns/stats HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/campaigns/stats',
{
  method: 'GET',

  headers: headers
})
.then(function(res) {
    return res.json();
}).then(function(body) {
    console.log(body);
});

```

```ruby
require 'rest-client'
require 'json'

headers = {
  'Accept' => 'application/json'
}

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/campaigns/stats',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/campaigns/stats', headers = headers)

print(r.json())

```

```php
<?php

require 'vendor/autoload.php';

$headers = array(
    'Accept' => 'application/json',
);

$client = new \GuzzleHttp\Client();

// Define array of request body.
$request_body = array();

try {
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/campaigns/stats', array(
        'headers' => $headers,
        'json' => $request_body,
       )
    );
    print_r($response->getBody()->getContents());
 }
 catch (\GuzzleHttp\Exception\BadResponseException $e) {
    // handle exception or api errors.
    print_r($e->getMessage());
 }

 // ...

```

```java
URL obj = new URL("https://api.circulardemocracy.org/api/v1/campaigns/stats");
HttpURLConnection con = (HttpURLConnection) obj.openConnection();
con.setRequestMethod("GET");
int responseCode = con.getResponseCode();
BufferedReader in = new BufferedReader(
    new InputStreamReader(con.getInputStream()));
String inputLine;
StringBuffer response = new StringBuffer();
while ((inputLine = in.readLine()) != null) {
    response.append(inputLine);
}
in.close();
System.out.println(response.toString());

```

```go
package main

import (
       "bytes"
       "net/http"
)

func main() {

    headers := map[string][]string{
        "Accept": []string{"application/json"},
    }

    data := bytes.NewBuffer([]byte{jsonReq})
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/campaigns/stats", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/campaigns/stats`

*Get campaign statistics*

> Example responses

> 200 Response

```json
{
  "campaigns": [
    {
      "id": 0,
      "name": "string",
      "message_count": 0,
      "recent_count": 0,
      "avg_confidence": 0
    }
  ]
}
```

<h3 id="get__api_v1_campaigns_stats-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Campaign statistics|Inline|

<h3 id="get__api_v1_campaigns_stats-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» campaigns|[object]|true|none|none|
|»» id|number|true|none|none|
|»» name|string|true|none|none|
|»» message_count|number|true|none|none|
|»» recent_count|number|true|none|none|
|»» avg_confidence|number|false|none|none|

<aside class="success">
This operation does not require authentication
</aside>

# Schemas

