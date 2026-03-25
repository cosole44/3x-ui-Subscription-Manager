const sourceForm = document.getElementById("source-form");
const sourceIdInput = document.getElementById("source-id");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit");
const sourcesList = document.getElementById("sources-list");
const aggregateForm = document.getElementById("aggregate-form");
const subscriptionPanel = document.getElementById("subscription-panel");
const subscriptionLink = document.getElementById("subscription-link");
const totalConfigs = document.getElementById("total-configs");
const rawOutput = document.getElementById("raw-output");
const statusList = document.getElementById("status-list");
const sourceTemplate = document.getElementById("source-item-template");
const statusTemplate = document.getElementById("status-item-template");

let sources = [];

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error || "Request failed.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function getFormPayload() {
  return {
    name: document.getElementById("name").value.trim(),
    domain: document.getElementById("domain").value.trim(),
    port: document.getElementById("port").value.trim(),
    path: document.getElementById("path").value.trim(),
  };
}

function resetForm() {
  sourceForm.reset();
  sourceIdInput.value = "";
  saveButton.textContent = "Сохранить сервер";
  cancelEditButton.classList.add("hidden");
}

function fillForm(source) {
  sourceIdInput.value = source.id;
  document.getElementById("name").value = source.name;
  document.getElementById("domain").value = source.domain;
  document.getElementById("port").value = source.port;
  document.getElementById("path").value = source.path;
  saveButton.textContent = "Обновить сервер";
  cancelEditButton.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSources() {
  if (!sources.length) {
    sourcesList.innerHTML = '<div class="empty">Серверы еще не добавлены.</div>';
    return;
  }

  sourcesList.innerHTML = "";

  for (const source of sources) {
    const fragment = sourceTemplate.content.cloneNode(true);
    fragment.querySelector(".source-name").textContent = source.name;
    fragment.querySelector(".source-meta").textContent = `${source.domain}:${source.port}`;
    fragment.querySelector(".source-url").textContent = `https://${source.domain}:${source.port}/${source.path}/USERNAME`;
    fragment.querySelector(".edit-source").addEventListener("click", () => fillForm(source));
    fragment.querySelector(".delete-source").addEventListener("click", async () => {
      if (!window.confirm(`Удалить источник "${source.name}"?`)) {
        return;
      }

      await request(`/api/sources/${source.id}`, { method: "DELETE" });
      await loadSources();
    });

    sourcesList.appendChild(fragment);
  }
}

function renderStatuses(result) {
  if (!result) {
    statusList.textContent = "Пока нет данных. Выполните сборку подписки.";
    statusList.className = "status-list empty";
    return;
  }

  statusList.className = "status-list";
  statusList.innerHTML = "";

  for (const item of result.results) {
    const fragment = statusTemplate.content.cloneNode(true);
    fragment.querySelector(".status-name").textContent = item.sourceName;
    fragment.querySelector(".status-url").textContent = item.url;

    const badge = fragment.querySelector(".status-badge");
    if (item.ok) {
      badge.textContent = `${item.count} конфигов`;
      badge.classList.add("ok");
    } else {
      badge.textContent = item.error || "Ошибка";
      badge.classList.add("error");
    }

    statusList.appendChild(fragment);
  }
}

async function loadSources() {
  sources = await request("/api/sources");
  renderSources();
}

sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const id = sourceIdInput.value;
    const payload = getFormPayload();

    if (id) {
      await request(`/api/sources/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await request("/api/sources", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    resetForm();
    await loadSources();
  } catch (error) {
    window.alert(error.message);
  }
});

cancelEditButton.addEventListener("click", resetForm);

aggregateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.getElementById("username").value.trim();

  if (!username) {
    return;
  }

  try {
    const result = await request(`/api/aggregate/${encodeURIComponent(username)}`);
    const shareUrl = `${window.location.origin}/subscribe/${encodeURIComponent(username)}`;

    subscriptionPanel.classList.remove("hidden");
    subscriptionLink.href = shareUrl;
    subscriptionLink.textContent = shareUrl;
    totalConfigs.textContent = String(result.totalConfigs);
    rawOutput.value = result.raw;
    renderStatuses(result);
  } catch (error) {
    window.alert(error.message);
  }
});

loadSources().catch((error) => {
  sourcesList.innerHTML = `<div class="empty">${error.message}</div>`;
});
