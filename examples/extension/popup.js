const output = document.querySelector("#result");
const profile = document.querySelector("#profile");

async function refreshProfiles() {
  const { data, error } = await chrome.runtime.sendMessage({ action: "profiles" });
  if (error) return false;
  const { savedProfileId } = await chrome.storage.session.get("savedProfileId");
  profile.replaceChildren(new Option("Gateway default", ""));
  for (const row of data) profile.add(new Option(row.name + (row.is_default ? " (default)" : ""), row.id));
  profile.value = data.some(row => row.id === savedProfileId) ? savedProfileId : "";
  return data.length > 0;
}

async function send(payload) {
  output.textContent = "Working…";
  try {
    const result = await chrome.runtime.sendMessage(payload);
    if (result.data?.paired) {
      output.textContent = await refreshProfiles()
        ? "Paired. Select a knowledge profile." : "Paired. Grant this key access in Knowledge Base.";
    } else {
      output.textContent = result.error || JSON.stringify(result.data, null, 2);
    }
  } catch (error) {
    output.textContent = error.message;
  }
}

document.querySelector("#pair").addEventListener("submit", event => {
  event.preventDefault();
  const code = document.querySelector("#code");
  void send({ action: "pair", code: code.value.trim() });
  code.value = "";
});

document.querySelector("#run").addEventListener("click", () => void send({
  action: "analyze",
  form: {
    fields: [{ id: "company", label: "Name of your company", type: "text" }],
    ...(profile.value && { profile_id: profile.value }),
  },
}));

profile.addEventListener("change", () => void chrome.storage.session.set({ savedProfileId: profile.value }));
void refreshProfiles().catch(() => { output.textContent = "Could not load profiles."; });
