/* global browser, HNCS */
const form = document.getElementById("form");

function showMethod() {
  const method = form.method.value;
  for (const fs of document.querySelectorAll("fieldset[data-method]")) {
    fs.hidden = fs.dataset.method !== method;
  }
}

async function load() {
  const { settings } = await browser.storage.local.get("settings");
  const s = Object.assign({}, HNCS.DEFAULT_SETTINGS, settings);
  form.method.value = s.method;
  form.restUrl.value = s.restUrl;
  form.apiKey.value = s.apiKey;
  form.vault.value = s.vault;
  form.folder.value = s.folder;
  form.autoSync.checked = s.autoSync;
  form.collapsed.checked = s.collapsed;
  showMethod();
}

function read() {
  return {
    method: form.method.value || "rest",
    restUrl: form.restUrl.value.trim() || HNCS.DEFAULT_SETTINGS.restUrl,
    apiKey: form.apiKey.value.trim(),
    vault: form.vault.value.trim(),
    folder: form.folder.value.trim(),
    autoSync: form.autoSync.checked,
    collapsed: form.collapsed.checked,
  };
}

async function save() {
  await browser.storage.local.set({ settings: read() });
}

form.addEventListener("change", showMethod);
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await save();
  const el = document.getElementById("saved");
  el.textContent = "Saved.";
  el.className = "ok";
  setTimeout(() => (el.textContent = ""), 2000);
});

document.getElementById("test").addEventListener("click", async () => {
  const out = document.getElementById("testResult");
  out.textContent = "Testing…";
  out.className = "";
  await save();
  const res = await browser.runtime.sendMessage({ type: "testConnection" });
  out.textContent = res.message;
  out.className = res.ok ? "ok" : "err";
});

load();
