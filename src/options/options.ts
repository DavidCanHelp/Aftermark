const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const saveBtn = document.getElementById("save")!;
const statusEl = document.getElementById("status")!;

chrome.storage.local.get("anthropicApiKey", (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey as string;
  }
});

saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  chrome.storage.local.set({ anthropicApiKey: key }, () => {
    statusEl.textContent = "Saved.";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2000);
  });
});
