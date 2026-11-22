const origin = "https://YOUR-GATEWAY.onrender.com";

async function call(path, payload, token) {
  const response = await fetch(origin + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    credentials: "omit",
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok && !result.fill) throw new Error(result.detail || "Gateway request failed");
  return result;
}

async function handle(message) {
  if (message.action === "pair") {
    const result = await call("/api/v1/extension/redeem", { code: message.code });
    await chrome.storage.session.set({
      credential: { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 },
    });
    return { paired: true };
  }
  if (["analyze", "answer", "profiles"].includes(message.action)) {
    const { credential } = await chrome.storage.session.get("credential");
    if (!credential || credential.expiresAt <= Date.now()) throw new Error("Pair this browser again.");
    if (message.action === "profiles") return call("/api/v1/profiles", undefined, credential.token);
    const path = message.action === "analyze" ? "analyze-form" : "answer-fields";
    return call("/api/v1/" + path, message.form, credential.token);
  }
  throw new Error("Unknown action");
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  handle(message).then(data => reply({ data })).catch(error => reply({ error: error.message }));
  return true;
});
