// Keep this file in your own bot project; never commit a real token.
const API = process.env.RAVAN_API_URL;
const TOKEN = process.env.RAVAN_BOT_TOKEN;

if (!API || !TOKEN) throw new Error("Set RAVAN_API_URL and RAVAN_BOT_TOKEN in your environment.");

async function api(path, init = {}) {
  const response = await fetch(`${API.replace(/\/$/, "")}/api/v1/bot/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error?.code ?? response.status}: ${data.error?.message ?? "request failed"}`);
  return data.result;
}

async function main() {
  const me = await api("me");
  console.log(`Connected as @${me.username}`);

  // Attach this bot to a conversation in the Ravan Bot Studio before sending.
  const updates = await api("updates?offset=0");
  for (const update of updates) {
    if (update.type !== "message") continue;
    const idempotencyKey = crypto.randomUUID();
    await api("messages", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        conversationId: update.data.conversation_id,
        text: `دریافت شد: ${update.data.text}`,
        clientRequestId: idempotencyKey,
      }),
    });
  }
}

main().catch((error) => {
  console.error(error.message); // Do not log the token or request headers.
  process.exitCode = 1;
});
