# AI Redeem API

Base URL:
- `https://ai-redeem.cc`

Content type:
- `application/json`

## Redeem Endpoints

### `POST /redeem/check`
Checks whether a redeem code is used.

Request:
```json
{
  "code": "GPT-ABCD1234EFGH5678"
}
```

Success:
```json
{
  "used": false,
  "app_name": "ChatGPT Plus 1 Month",
  "app_product_name": "ChatGPT Plus 1 Month"
}
```

Used:
```json
{
  "used": true,
  "app_name": "ChatGPT Plus 1 Month",
  "app_product_name": "ChatGPT Plus 1 Month"
}
```

Error:
```json
{
  "message": "cdk not found"
}
```

### `POST /redeem/outstock`
Starts redeeming a code.

Request:
```json
{
  "cdk": "GPT-ABCD1234EFGH5678",
  "user": "{\"user\":{\"email\":\"name@example.com\"},\"accessToken\":\"token_here\"}"
}
```

Success:
```json
{
  "task_id": "9f3b89b2-5f24-4a7e-8d0a-93c14a1f0c31"
}
```

Error:
```json
{
  "message": "Request failed."
}
```

### `GET /redeem/tasks/{taskId}`
Checks redeem task status.

Pending:
```json
{
  "status": "processing"
}
```

Done:
```json
{
  "status": "done",
  "message": "success"
}
```

Failed:
```json
{
  "status": "failed",
  "message": "session invalid"
}
```

### `POST /redeem/check-usage`
Checks multiple codes.

Request:
```json
{
  "codes": "GPT-AAAA1111BBBB2222,GPT-CCCC3333DDDD4444"
}
```

Response:
```json
[
  {
    "code": "GPT-AAAA1111BBBB2222",
    "used": true,
    "user": "user1@example.com",
    "redeem_time": "2026-04-13 12:10:00"
  },
  {
    "code": "GPT-CCCC3333DDDD4444",
    "used": false,
    "user": "-",
    "redeem_time": "-"
  }
]
```

## CDK Activation Endpoints

### `POST /cdk-activation/check`
Checks key status.

Request:
```json
{
  "code": "ABCD1234EFGH5678"
}
```

Unused:
```json
{
  "used": false,
  "status": "available",
  "app_name": "CHATGPT PLUS 30D",
  "app_product_name": "CHATGPT PLUS 30D",
  "key": {
    "code": "ABCD1234EFGH5678",
    "status": "available",
    "key_type": "personal",
    "subscription_hours": 0,
    "activated_email": null,
    "activated_at": null,
    "subscription_ends_at": null,
    "plan": "plus",
    "term": "30d",
    "service": "chatgpt"
  }
}
```

Used:
```json
{
  "used": true,
  "status": "activated",
  "app_name": "CHATGPT PLUS 30D",
  "app_product_name": "CHATGPT PLUS 30D",
  "key": {
    "code": "ABCD1234EFGH5678",
    "status": "activated",
    "key_type": "team",
    "subscription_hours": 720,
    "activated_email": "user@example.com",
    "activated_at": 1776074400,
    "subscription_ends_at": 1778666400,
    "plan": "plus",
    "term": "30d",
    "service": "chatgpt"
  }
}
```

### `POST /cdk-activation/outstock`
Activates a key using either session JSON or email.

Session request:
```json
{
  "cdk": "ABCD1234EFGH5678",
  "user": "{\"accessToken\":\"token_here\",\"user\":{\"id\":\"user_123\",\"email\":\"name@example.com\"}}"
}
```

Async response:
```json
{
  "task_id": "ABCD1234EFGH5678",
  "status": "started"
}
```

Immediate success:
```json
{
  "pending": false,
  "success": true,
  "status": "subscription_sent",
  "activation_type": "new",
  "message": "Activated for name@example.com",
  "key": {
    "code": "ABCD1234EFGH5678",
    "status": "activated",
    "activated_email": "name@example.com"
  }
}
```

Email request:
```json
{
  "cdk": "ABCD1234EFGH5678",
  "user": "name@example.com"
}
```

Email success:
```json
{
  "pending": false,
  "success": true,
  "status": "subscription_sent",
  "activation_type": "renew",
  "message": "Renewed for name@example.com",
  "key": {
    "code": "ABCD1234EFGH5678",
    "status": "activated",
    "activated_email": "name@example.com"
  }
}
```

### `GET /cdk-activation/tasks/{taskId}`
Checks activation status.

Pending:
```json
{
  "pending": true,
  "status": "account_found",
  "message": "Account found"
}
```

Success:
```json
{
  "pending": false,
  "success": true,
  "status": "subscription_sent",
  "activation_type": "new",
  "message": "Activated for name@example.com",
  "key": {
    "code": "ABCD1234EFGH5678",
    "status": "activated",
    "activated_email": "name@example.com"
  }
}
```

Failed:
```json
{
  "pending": false,
  "success": false,
  "status": "error",
  "message": "session_invalid",
  "key": null
}
```

### `POST /cdk-activation/check-usage`
Checks multiple keys.

Request:
```json
{
  "codes": "ABCD1234EFGH5678,ZXCV9876QWER5432"
}
```

Response:
```json
[
  {
    "code": "ABCD1234EFGH5678",
    "used": true,
    "user": "name@example.com",
    "redeem_time": "2026-04-13 12:10:00",
    "status": "activated"
  },
  {
    "code": "ZXCV9876QWER5432",
    "used": false,
    "user": "-",
    "redeem_time": "-",
    "status": "available"
  }
]
```