// ═══════════════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════════════

const sourceForm       = document.getElementById("source-form");
const sourceIdInput    = document.getElementById("source-id");
const saveButton       = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit");
const sourcesList      = document.getElementById("sources-list");
const aggregateForm    = document.getElementById("aggregate-form");
const aggregateButton  = document.getElementById("aggregate-button");
const subscriptionPanel = document.getElementById("subscription-panel");
const subscriptionLink  = document.getElementById("subscription-link");
const totalConfigs      = document.getElementById("total-configs");
const rawOutput         = document.getElementById("raw-output");
const copyRawButton     = document.getElementById("copy-raw");
const copyLinkButton    = document.getElementById("copy-link");
const qrContainer       = document.getElementById("qr-container");
const statusList        = document.getElementById("status-list");
const logoutButton      = document.getElementById("logout-button");
const sourceTemplate    = document.getElementById("source-item-template");
const statusTemplate    = document.getElementById("status-item-template");

let sources  = [];
let subToken = "";

// ═══════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (response.status === 401) {
    window.location.href = "/auth/login";
    return null;
  }
  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({ error: "Неверный ответ сервера." }));
  if (!response.ok) throw new Error(payload.error || `Ошибка ${response.status}.`);
  return payload;
}

// ═══════════════════════════════════════════════════════
// Форма источника
// ═══════════════════════════════════════════════════════

function getFormPayload() {
  return {
    name:   document.getElementById("name").value.trim(),
    domain: document.getElementById("domain").value.trim(),
    port:   document.getElementById("port").value.trim(),
    path:   document.getElementById("path").value.trim(),
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
  document.getElementById("name").value   = source.name;
  document.getElementById("domain").value = source.domain;
  document.getElementById("port").value   = source.port;
  document.getElementById("path").value   = source.path;
  saveButton.textContent = "Обновить сервер";
  cancelEditButton.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ═══════════════════════════════════════════════════════
// Рендеринг
// ═══════════════════════════════════════════════════════

function renderSources() {
  if (!sources.length) {
    sourcesList.innerHTML = '<div class="empty">Серверы ещё не добавлены.</div>';
    return;
  }
  sourcesList.innerHTML = "";

  for (const source of sources) {
    const fragment = sourceTemplate.content.cloneNode(true);
    fragment.querySelector(".source-name").textContent = source.name;
    fragment.querySelector(".source-meta").textContent = `${source.domain}:${source.port}`;
    fragment.querySelector(".source-url").textContent  =
      `https://${source.domain}:${source.port}/${source.path}/USERNAME`;

    fragment.querySelector(".edit-source").addEventListener("click", () => fillForm(source));
    fragment.querySelector(".delete-source").addEventListener("click", async () => {
      if (!window.confirm(`Удалить источник «${source.name}»?`)) return;
      try {
        await apiRequest(`/api/sources/${source.id}`, { method: "DELETE" });
        await loadSources();
      } catch (err) {
        showError(err.message);
      }
    });

    sourcesList.appendChild(fragment);
  }
}

function renderStatuses(result) {
  if (!result) {
    statusList.textContent  = "Нет данных. Выполните сборку подписки.";
    statusList.className    = "status-list empty";
    return;
  }
  statusList.className = "status-list";
  statusList.innerHTML = "";

  for (const item of result.results) {
    const fragment = statusTemplate.content.cloneNode(true);
    fragment.querySelector(".status-name").textContent = item.sourceName;
    fragment.querySelector(".status-url").textContent  = item.url;

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

// ═══════════════════════════════════════════════════════
// QR-код
// ═══════════════════════════════════════════════════════

function renderQr(url) {
  qrContainer.innerHTML = "";

  // Используем QRCode.js (подключён в index.html через CDN)
  // deno/браузер — просто вызываем глобальный QRCode
  try {
    new QRCode(qrContainer, {
      text:          url,
      width:         200,
      height:        200,
      colorDark:     "#2c221c",
      colorLight:    "#fffcf7",
      correctLevel:  QRCode.CorrectLevel.M,
    });
  } catch {
    qrContainer.textContent = "QR недоступен";
  }
}

// ═══════════════════════════════════════════════════════
// UI утилиты
// ═══════════════════════════════════════════════════════

function showError(msg) {
  window.alert(`Ошибка: ${msg}`);
}

function setLoading(btn, loading, label) {
  btn.disabled    = loading;
  btn.textContent = loading ? "Загрузка…" : label;
}

async function copyText(str, btn) {
  try {
    await navigator.clipboard.writeText(str);
    const orig = btn.textContent;
    btn.textContent = "Скопировано ✓";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    showError("Не удалось скопировать.");
  }
}

// ═══════════════════════════════════════════════════════
// Загрузка
// ═══════════════════════════════════════════════════════

async function loadSources() {
  try {
    sources = await apiRequest("/api/sources") ?? [];
    renderSources();
  } catch (err) {
    sourcesList.innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

async function loadConfig() {
  try {
    const cfg = await apiRequest("/api/config");
    subToken = cfg?.subToken ?? "";
  } catch { /* non-critical */ }
}

// ═══════════════════════════════════════════════════════
// Обработчики
// ═══════════════════════════════════════════════════════

sourceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id     = sourceIdInput.value;
  const isEdit = Boolean(id);
  const label  = isEdit ? "Обновить сервер" : "Сохранить сервер";
  setLoading(saveButton, true, label);
  try {
    if (isEdit) {
      await apiRequest(`/api/sources/${id}`, { method: "PUT",  body: JSON.stringify(getFormPayload()) });
    } else {
      await apiRequest("/api/sources",        { method: "POST", body: JSON.stringify(getFormPayload()) });
    }
    resetForm();
    await loadSources();
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(saveButton, false, label);
  }
});

cancelEditButton.addEventListener("click", resetForm);

aggregateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  if (!username) return;

  setLoading(aggregateButton, true, "Собрать подписку");

  try {
    const result   = await apiRequest(`/api/aggregate/${encodeURIComponent(username)}`);
    if (!result) return;

    // Строим публичную ссылку подписки с токеном
    const shareUrl = subToken
      ? `${window.location.origin}/subscribe/${encodeURIComponent(username)}?token=${encodeURIComponent(subToken)}`
      : null;

    subscriptionPanel.classList.remove("hidden");

    if (shareUrl) {
      subscriptionLink.href        = shareUrl;
      subscriptionLink.textContent = shareUrl;
      renderQr(shareUrl);
      qrContainer.parentElement.classList.remove("hidden");
    } else {
      subscriptionLink.textContent = "SUB_TOKEN не настроен на сервере";
      qrContainer.parentElement.classList.add("hidden");
    }

    totalConfigs.textContent = String(result.totalConfigs);
    rawOutput.value          = result.raw;
    renderStatuses(result);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(aggregateButton, false, "Собрать подписку");
  }
});

copyRawButton?.addEventListener("click",  () => copyText(rawOutput.value, copyRawButton));
copyLinkButton?.addEventListener("click", () => copyText(subscriptionLink.href, copyLinkButton));

logoutButton?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/auth/login";
});

// ═══════════════════════════════════════════════════════
// Инициализация
// ═══════════════════════════════════════════════════════

Promise.all([loadSources(), loadConfig()]);
