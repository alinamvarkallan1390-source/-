# Ravan Bot API v1

Base URL: `https://<your-deployment>/api/v1/bot`

Bots are API/Webhook clients, not server-side scripts. Ravan never evaluates user code. For this release, **polling** is implemented; outbound Webhook delivery is not.

## Authentication

Create a bot in the signed-in Bot Studio and copy its token once. Send it in an HTTPS `Authorization` header. Never put the token in a URL, browser bundle, Git repository, or log.

```http
Authorization: Bearer rvn_<bot-id>_<secret>
Content-Type: application/json
```

The database stores only a SHA-256 digest. Rotating a token immediately revokes the previous token. Calls are rate-limited per bot.

## Read bot identity

```sh
curl -H "Authorization: Bearer $RAVAN_BOT_TOKEN" \
  "$RAVAN_API_URL/api/v1/bot/me"
```

## Send a message

First attach the bot to a conversation in Bot Studio. Channel bots can send only when an authorized channel owner/admin attached them. `clientRequestId` is a UUID and makes retries idempotent.

```sh
curl -X POST "$RAVAN_API_URL/api/v1/bot/messages" \
  -H "Authorization: Bearer $RAVAN_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 99eec7dd-2e9d-4d16-baf4-7c991f43dd8d" \
  -d '{"conversationId":"<conversation-uuid>","text":"سلام!","clientRequestId":"99eec7dd-2e9d-4d16-baf4-7c991f43dd8d"}'
```

## Poll for updates

Persist the last `update_id` you have processed. Pass it as `offset` on the next request. Events are ordered, bounded to 100 per response, and have a stable `event_key` for deduplication.

```sh
curl -H "Authorization: Bearer $RAVAN_BOT_TOKEN" \
  "$RAVAN_API_URL/api/v1/bot/updates?offset=0"
```

```python
import os, time, requests

api = os.environ["RAVAN_API_URL"].rstrip("/") + "/api/v1/bot"
headers = {"Authorization": "Bearer " + os.environ["RAVAN_BOT_TOKEN"]}
offset = 0
while True:  # run this loop in your own worker, not inside Ravan/Vercel
    response = requests.get(api + "/updates", params={"offset": offset}, headers=headers, timeout=20)
    response.raise_for_status()
    for update in response.json()["result"]:
        offset = int(update["update_id"])
        if update["type"] == "message":
            print(update["data"].get("text", ""))
    time.sleep(2)
```

```ts
const response = await fetch(`${process.env.RAVAN_API_URL}/api/v1/bot/updates?offset=${offset}`, {
  headers: { Authorization: `Bearer ${process.env.RAVAN_BOT_TOKEN}` },
  cache: "no-store",
});
if (!response.ok) throw new Error(`Bot API returned ${response.status}`);
const { result } = await response.json();
for (const update of result) {
  // Persist only after processing; use event_key to make your handler idempotent.
  offset = BigInt(update.update_id);
}
```

## Errors

Errors use `{ "error": { "code": "...", "message": "..." } }` with standard HTTP status codes. Retry `429` after a delay; do not retry `400`, `401`, or `403` without changing the request. A `5xx` can be retried with the same idempotency UUID.
