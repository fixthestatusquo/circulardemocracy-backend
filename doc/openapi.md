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

<h1 id="circular-democracy-api-campaigns">Campaigns</h1>

## get__api_v1_campaigns

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/campaigns \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/campaigns HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/campaigns',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/campaigns',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/campaigns', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/campaigns', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/campaigns");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/campaigns", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/campaigns`

> Example responses

> 200 Response

```json
[
  {
    "id": 0,
    "name": "string",
    "slug": "string",
    "description": "string",
    "status": "string",
    "created_at": "string"
  }
]
```

<h3 id="get__api_v1_campaigns-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A list of campaigns|Inline|

<h3 id="get__api_v1_campaigns-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» name|string|true|none|none|
|» slug|string|true|none|none|
|» description|string¦null|true|none|none|
|» status|string|true|none|none|
|» created_at|string|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

## post__api_v1_campaigns

> Code samples

```shell
# You can also use wget
curl -X POST https://api.circulardemocracy.org/api/v1/campaigns \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json'

```

```http
POST https://api.circulardemocracy.org/api/v1/campaigns HTTP/1.1
Host: api.circulardemocracy.org
Content-Type: application/json
Accept: application/json

```

```javascript
const inputBody = '{
  "name": "string",
  "slug": "string",
  "description": "string"
}';
const headers = {
  'Content-Type':'application/json',
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/campaigns',
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

result = RestClient.post 'https://api.circulardemocracy.org/api/v1/campaigns',
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

r = requests.post('https://api.circulardemocracy.org/api/v1/campaigns', headers = headers)

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
    $response = $client->request('POST','https://api.circulardemocracy.org/api/v1/campaigns', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/campaigns");
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
    req, err := http.NewRequest("POST", "https://api.circulardemocracy.org/api/v1/campaigns", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`POST /api/v1/campaigns`

> Body parameter

```json
{
  "name": "string",
  "slug": "string",
  "description": "string"
}
```

<h3 id="post__api_v1_campaigns-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|body|body|object|false|none|
|» name|body|string|true|none|
|» slug|body|string|true|none|
|» description|body|string|false|none|

> Example responses

> 201 Response

```json
{
  "id": 0,
  "name": "string",
  "slug": "string",
  "description": "string",
  "status": "string",
  "created_at": "string"
}
```

<h3 id="post__api_v1_campaigns-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|201|[Created](https://tools.ietf.org/html/rfc7231#section-6.3.2)|The created campaign|Inline|

<h3 id="post__api_v1_campaigns-responseschema">Response Schema</h3>

Status Code **201**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» name|string|true|none|none|
|» slug|string|true|none|none|
|» description|string¦null|true|none|none|
|» status|string|true|none|none|
|» created_at|string|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

## get__api_v1_campaigns_{id}

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/campaigns/{id} \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/campaigns/{id} HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/campaigns/{id}',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/campaigns/{id}',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/campaigns/{id}', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/campaigns/{id}', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/campaigns/{id}");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/campaigns/{id}", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/campaigns/{id}`

<h3 id="get__api_v1_campaigns_{id}-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|id|path|string|true|none|

> Example responses

> 200 Response

```json
{
  "id": 0,
  "name": "string",
  "slug": "string",
  "description": "string",
  "status": "string",
  "created_at": "string"
}
```

<h3 id="get__api_v1_campaigns_{id}-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A single campaign|Inline|
|404|[Not Found](https://tools.ietf.org/html/rfc7231#section-6.5.4)|Campaign not found|None|

<h3 id="get__api_v1_campaigns_{id}-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» name|string|true|none|none|
|» slug|string|true|none|none|
|» description|string¦null|true|none|none|
|» status|string|true|none|none|
|» created_at|string|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

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

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

<h1 id="circular-democracy-api-politicians">Politicians</h1>

## get__api_v1_politicians

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/politicians \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/politicians HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/politicians',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/politicians',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/politicians', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/politicians', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/politicians");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/politicians", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/politicians`

> Example responses

> 200 Response

```json
[
  {
    "id": 0,
    "name": "string",
    "email": "user@example.com",
    "party": "string",
    "country": "string",
    "region": "string",
    "position": "string",
    "active": true
  }
]
```

<h3 id="get__api_v1_politicians-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A list of politicians|Inline|

<h3 id="get__api_v1_politicians-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» name|string|true|none|none|
|» email|string(email)|true|none|none|
|» party|string¦null|true|none|none|
|» country|string¦null|true|none|none|
|» region|string¦null|true|none|none|
|» position|string¦null|true|none|none|
|» active|boolean|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

## get__api_v1_politicians_{id}

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/politicians/{id} \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/politicians/{id} HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/politicians/{id}',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/politicians/{id}',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/politicians/{id}', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/politicians/{id}', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/politicians/{id}");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/politicians/{id}", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/politicians/{id}`

<h3 id="get__api_v1_politicians_{id}-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|id|path|string|true|none|

> Example responses

> 200 Response

```json
{
  "id": 0,
  "name": "string",
  "email": "user@example.com",
  "party": "string",
  "country": "string",
  "region": "string",
  "position": "string",
  "active": true
}
```

<h3 id="get__api_v1_politicians_{id}-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A single politician|Inline|
|404|[Not Found](https://tools.ietf.org/html/rfc7231#section-6.5.4)|Politician not found|None|

<h3 id="get__api_v1_politicians_{id}-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» name|string|true|none|none|
|» email|string(email)|true|none|none|
|» party|string¦null|true|none|none|
|» country|string¦null|true|none|none|
|» region|string¦null|true|none|none|
|» position|string¦null|true|none|none|
|» active|boolean|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

<h1 id="circular-democracy-api-reply-templates">Reply Templates</h1>

## get__api_v1_reply-templates

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/reply-templates \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/reply-templates HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/reply-templates',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/reply-templates',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/reply-templates', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/reply-templates', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/reply-templates");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/reply-templates", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/reply-templates`

> Example responses

> 200 Response

```json
[
  {
    "id": 0,
    "politician_id": 0,
    "campaign_id": 0,
    "name": "string",
    "subject": "string",
    "body": "string",
    "active": true
  }
]
```

<h3 id="get__api_v1_reply-templates-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A list of reply templates|Inline|

<h3 id="get__api_v1_reply-templates-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» politician_id|number|true|none|none|
|» campaign_id|number|true|none|none|
|» name|string|true|none|none|
|» subject|string|true|none|none|
|» body|string|true|none|none|
|» active|boolean|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

## post__api_v1_reply-templates

> Code samples

```shell
# You can also use wget
curl -X POST https://api.circulardemocracy.org/api/v1/reply-templates \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json'

```

```http
POST https://api.circulardemocracy.org/api/v1/reply-templates HTTP/1.1
Host: api.circulardemocracy.org
Content-Type: application/json
Accept: application/json

```

```javascript
const inputBody = '{
  "politician_id": 0,
  "campaign_id": 0,
  "name": "string",
  "subject": "string",
  "body": "string"
}';
const headers = {
  'Content-Type':'application/json',
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/reply-templates',
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

result = RestClient.post 'https://api.circulardemocracy.org/api/v1/reply-templates',
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

r = requests.post('https://api.circulardemocracy.org/api/v1/reply-templates', headers = headers)

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
    $response = $client->request('POST','https://api.circulardemocracy.org/api/v1/reply-templates', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/reply-templates");
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
    req, err := http.NewRequest("POST", "https://api.circulardemocracy.org/api/v1/reply-templates", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`POST /api/v1/reply-templates`

> Body parameter

```json
{
  "politician_id": 0,
  "campaign_id": 0,
  "name": "string",
  "subject": "string",
  "body": "string"
}
```

<h3 id="post__api_v1_reply-templates-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|body|body|object|false|none|
|» politician_id|body|number|true|none|
|» campaign_id|body|number|true|none|
|» name|body|string|true|none|
|» subject|body|string|true|none|
|» body|body|string|true|none|

> Example responses

> 201 Response

```json
{
  "id": 0,
  "politician_id": 0,
  "campaign_id": 0,
  "name": "string",
  "subject": "string",
  "body": "string",
  "active": true
}
```

<h3 id="post__api_v1_reply-templates-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|201|[Created](https://tools.ietf.org/html/rfc7231#section-6.3.2)|The created reply template|Inline|

<h3 id="post__api_v1_reply-templates-responseschema">Response Schema</h3>

Status Code **201**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» politician_id|number|true|none|none|
|» campaign_id|number|true|none|none|
|» name|string|true|none|none|
|» subject|string|true|none|none|
|» body|string|true|none|none|
|» active|boolean|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

## get__api_v1_reply-templates_{id}

> Code samples

```shell
# You can also use wget
curl -X GET https://api.circulardemocracy.org/api/v1/reply-templates/{id} \
  -H 'Accept: application/json'

```

```http
GET https://api.circulardemocracy.org/api/v1/reply-templates/{id} HTTP/1.1
Host: api.circulardemocracy.org
Accept: application/json

```

```javascript

const headers = {
  'Accept':'application/json'
};

fetch('https://api.circulardemocracy.org/api/v1/reply-templates/{id}',
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

result = RestClient.get 'https://api.circulardemocracy.org/api/v1/reply-templates/{id}',
  params: {
  }, headers: headers

p JSON.parse(result)

```

```python
import requests
headers = {
  'Accept': 'application/json'
}

r = requests.get('https://api.circulardemocracy.org/api/v1/reply-templates/{id}', headers = headers)

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
    $response = $client->request('GET','https://api.circulardemocracy.org/api/v1/reply-templates/{id}', array(
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
URL obj = new URL("https://api.circulardemocracy.org/api/v1/reply-templates/{id}");
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
    req, err := http.NewRequest("GET", "https://api.circulardemocracy.org/api/v1/reply-templates/{id}", data)
    req.Header = headers

    client := &http.Client{}
    resp, err := client.Do(req)
    // ...
}

```

`GET /api/v1/reply-templates/{id}`

<h3 id="get__api_v1_reply-templates_{id}-parameters">Parameters</h3>

|Name|In|Type|Required|Description|
|---|---|---|---|---|
|id|path|string|true|none|

> Example responses

> 200 Response

```json
{
  "id": 0,
  "politician_id": 0,
  "campaign_id": 0,
  "name": "string",
  "subject": "string",
  "body": "string",
  "active": true
}
```

<h3 id="get__api_v1_reply-templates_{id}-responses">Responses</h3>

|Status|Meaning|Description|Schema|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|A single reply template|Inline|
|404|[Not Found](https://tools.ietf.org/html/rfc7231#section-6.5.4)|Reply template not found|None|

<h3 id="get__api_v1_reply-templates_{id}-responseschema">Response Schema</h3>

Status Code **200**

|Name|Type|Required|Restrictions|Description|
|---|---|---|---|---|
|» id|number|true|none|none|
|» politician_id|number|true|none|none|
|» campaign_id|number|true|none|none|
|» name|string|true|none|none|
|» subject|string|true|none|none|
|» body|string|true|none|none|
|» active|boolean|true|none|none|

<aside class="warning">
To perform this operation, you must be authenticated by means of one of the following methods:
None
</aside>

# Schemas

