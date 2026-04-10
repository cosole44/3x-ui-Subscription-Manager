// ═══════════════════════════════════════════════════════════════════════════════
// Конфигурация
// ═══════════════════════════════════════════════════════════════════════════════

const HOST             = Deno.env.get("HOST")             || "0.0.0.0";
const PORT             = Number(Deno.env.get("PORT")       || 3000);
const FETCH_TIMEOUT_MS = Number(Deno.env.get("FETCH_TIMEOUT_MS") || 8000);
const SESSION_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // 7 дней

// Учётные данные и токен — ОБЯЗАТЕЛЬНО задать через env
const ADMIN_USER  = Deno.env.get("ADMIN_USER")  || "admin";
const ADMIN_PASS  = Deno.env.get("ADMIN_PASS")  || "changeme";
const SUB_TOKEN   = Deno.env.get("SUB_TOKEN")   || "";   // токен для /subscribe
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") || "change-this-secret";

if (!SUB_TOKEN) {
  console.warn("[WARN] SUB_TOKEN не задан — эндпоинт /subscribe будет недоступен!");
}
if (ADMIN_PASS === "changeme") {
  console.warn("[WARN] Используется пароль по умолчанию. Задайте ADMIN_PASS в .env!");
}

const ROOT       = Deno.cwd();
const DATA_DIR   = `${ROOT}/data`;
const DATA_FILE  = `${DATA_DIR}/sources.json`;
const PUBLIC_DIR = `${ROOT}/public`;

const MIME_TYPES = {
  css:  "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js:   "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png:  "image/png",
  svg:  "image/svg+xml",
  txt:  "text/plain; charset=utf-8",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ═══════════════════════════════════════════════════════════════════════════════
// Сессии (in-memory, хватает для одного пользователя)
// ═══════════════════════════════════════════════════════════════════════════════

const sessions = new Map(); // sessionId → expiresAt

function createSession() {
  const id        = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(id, expiresAt);
  return { id, expiresAt };
}

function isValidSession(id) {
  if (!id) return false;
  const exp = sessions.get(id);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function deleteSession(id) {
  sessions.delete(id);
}

// Чистим просроченные сессии раз в час
setInterval(() => {
  const now = Date.now();
  for (const [id, exp] of sessions) {
    if (now > exp) sessions.delete(id);
  }
}, 60 * 60 * 1000);

function getSessionId(request) {
  const cookie = request.headers.get("cookie") || "";
  const match  = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return match ? match[1] : null;
}

function sessionCookie(id, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `sid=${id}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

function clearCookie() {
  return `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Хранилище
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureDataFile() {
  await Deno.mkdir(DATA_DIR, { recursive: true });
  try {
    await Deno.stat(DATA_FILE);
  } catch {
    await Deno.writeTextFile(DATA_FILE, "[]\n");
  }
}

async function readSources() {
  await ensureDataFile();
  const raw = await Deno.readTextFile(DATA_FILE);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("sources.json должен содержать массив");
    return parsed;
  } catch (err) {
    throw new Error(`Не удалось прочитать sources.json: ${err.message}`);
  }
}

async function writeSources(sources) {
  await ensureDataFile();
  await Deno.writeTextFile(DATA_FILE, `${JSON.stringify(sources, null, 2)}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP-ответы
// ═══════════════════════════════════════════════════════════════════════════════

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options":        "SAMEORIGIN",
  "Referrer-Policy":        "strict-origin-when-cross-origin",
};

function mergeHeaders(base, extra = {}) {
  return { ...base, ...SECURITY_HEADERS, ...extra };
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: mergeHeaders({ "content-type": "application/json; charset=utf-8" }, extra),
  });
}

function text(payload, status = 200, extra = {}) {
  return new Response(payload, {
    status,
    headers: mergeHeaders({ "content-type": "text/plain; charset=utf-8" }, extra),
  });
}

function empty(status = 204, extra = {}) {
  return new Response(null, { status, headers: mergeHeaders({}, extra) });
}

function redirect(location, extra = {}) {
  return new Response(null, {
    status: 302,
    headers: mergeHeaders({ location }, extra),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Валидация
// ═══════════════════════════════════════════════════════════════════════════════

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;

function validateSource(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Ожидается JSON-объект.");
  }
  const source = {
    name:   String(payload.name   ?? "").trim(),
    domain: String(payload.domain ?? "").trim(),
    port:   String(payload.port   ?? "").trim(),
    path:   String(payload.path   ?? "").trim().replace(/^\/+|\/+$/g, ""),
  };

  if (!source.name || !source.domain || !source.port || !source.path) {
    throw new Error("Поля name, domain, port и path обязательны.");
  }
  if (source.name.length > 100) throw new Error("Название не должно превышать 100 символов.");
  if (!DOMAIN_RE.test(source.domain))  throw new Error(`Некорректный домен: "${source.domain}".`);
  if (!/^\d{1,5}$/.test(source.port))  throw new Error("Порт должен содержать только цифры.");

  const portNum = Number(source.port);
  if (portNum < 1 || portNum > 65535)  throw new Error("Порт должен быть в диапазоне 1–65535.");

  return source;
}

function validateUsername(raw) {
  const username = String(raw ?? "").trim();
  if (!username)           throw new Error("Имя клиента обязательно.");
  if (username.length > 200) throw new Error("Имя клиента слишком длинное.");
  return username;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Логика подписок (всегда в реальном времени)
// ═══════════════════════════════════════════════════════════════════════════════

function buildSubscriptionUrl(source, username) {
  return `https://${source.domain}:${source.port}/${source.path}/${encodeURIComponent(username)}`;
}

function maybeDecodeBase64(input) {
  const compact = input.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  try {
    const binary  = atob(compact);
    const bytes   = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoded = decoder.decode(bytes);
    return decoded.includes("://") ? decoded : null;
  } catch {
    return null;
  }
}

function encodeBase64Utf8(input) {
  const bytes = encoder.encode(input);
  let binary  = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function withServerName(config, serverName) {
  const clean = config.trim();
  if (!clean) return clean;
  const [withoutFragment] = clean.split("#");
  return `${withoutFragment}#${encodeURIComponent(serverName)}`;
}

function extractConfigs(payload) {
  const trimmed = payload.trim();
  if (!trimmed) return [];
  const normalized = maybeDecodeBase64(trimmed) ?? trimmed;
  return normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes("://"));
}

async function fetchSourceConfigs(source, username) {
  const url = buildSubscriptionUrl(source, username);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "3x-ui-subscription-manager/1.0",
        accept:       "text/plain,application/json;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body    = await response.text();
    const configs = extractConfigs(body).map((c) => withServerName(c, source.name));
    return { sourceId: source.id, sourceName: source.name, url, ok: true, count: configs.length, configs };
  } catch (error) {
    const message = error.name === "TimeoutError"
      ? `Таймаут (>${FETCH_TIMEOUT_MS} мс)`
      : error.message;
    return { sourceId: source.id, sourceName: source.name, url, ok: false, count: 0, configs: [], error: message };
  }
}

// Основная функция — вызывается при каждом запросе, данные всегда свежие
async function aggregateSubscriptions(username) {
  const cleanUsername = validateUsername(username);
  const sources       = await readSources();

  if (!sources.length) {
    throw new Error("Серверы не добавлены. Сначала добавьте хотя бы один источник.");
  }

  const results = await Promise.all(sources.map((s) => fetchSourceConfigs(s, cleanUsername)));

  const seen          = new Set();
  const uniqueConfigs = results
    .flatMap((r) => r.configs)
    .filter((c) => (seen.has(c) ? false : seen.add(c)));

  const raw = uniqueConfigs.join("\n");

  return {
    username:         cleanUsername,
    generatedAt:      new Date().toISOString(),
    totalSources:     sources.length,
    reachableSources: results.filter((r) => r.ok).length,
    totalConfigs:     uniqueConfigs.length,
    raw,
    base64:           encodeBase64Utf8(raw),
    results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Статика
// ═══════════════════════════════════════════════════════════════════════════════

async function serveStatic(pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;

  if (normalizedPath.includes("..") || normalizedPath.includes("\0")) {
    return text("Forbidden", 403);
  }

  const filePath = `${PUBLIC_DIR}${normalizedPath}`;
  if (!filePath.startsWith(`${PUBLIC_DIR}/`)) return text("Forbidden", 403);

  try {
    const body = await Deno.readFile(filePath);
    const ext  = filePath.split(".").pop() ?? "txt";
    return new Response(body, {
      status:  200,
      headers: mergeHeaders({ "content-type": MIME_TYPES[ext] ?? "application/octet-stream" }),
    });
  } catch {
    return text("Not found", 404);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Роутер
// ═══════════════════════════════════════════════════════════════════════════════

function extractSegment(pathname, prefix) {
  const raw = pathname.slice(prefix.length);
  return raw ? decodeURIComponent(raw) : null;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    const err = new Error("Некорректный JSON в теле запроса.");
    err.httpStatus = 400;
    throw err;
  }
}

// Страница логина (отдаём отдельный HTML без layout'а панели)
async function serveLogin(error = "") {
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Вход — 3x-ui Manager</title>
  <link rel="stylesheet" href="/styles.css"/>
  <script>
    (function() {
      const saved = localStorage.getItem('theme');
      const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (saved === 'dark' || (!saved && sysDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
</head>
<body class="login-page">
  <div class="login-card">
    <p class="eyebrow">3x-ui Aggregator</p>
    <h1>Вход</h1>
    ${error ? `<p class="login-error">${error}</p>` : ""}
    <form method="POST" action="/auth/login" class="stack">
      <label>
        <span>Логин</span>
        <input name="username" type="text" autocomplete="username" required autofocus/>
      </label>
      <label>
        <span>Пароль</span>
        <input name="password" type="password" autocomplete="current-password" required/>
      </label>
      <button type="submit" class="primary">Войти</button>
    </form>
  </div>

  <!-- Кнопка переключения темы (фиксированная, нижний правый угол) -->
  <button type="button" class="theme-toggle login-theme-toggle" id="login-theme-toggle" aria-label="Сменить тему">
    <span class="icon-sun">☀️</span>
    <span class="icon-moon">🌙</span>
  </button>

  <script>
    document.getElementById('login-theme-toggle').addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: mergeHeaders({ "content-type": "text/html; charset=utf-8" }),
  });
}

async function router(request) {
  const url      = new URL(request.url);
  const method   = request.method;
  const pathname = url.pathname;

  // ── Публичный маршрут: подписка по токену ───────────────────────────────────
  // VPN-клиент дёргает этот URL при каждом обновлении → всегда свежие конфиги
  if (method === "GET" && pathname.startsWith("/subscribe/")) {
    const token = url.searchParams.get("token");
    if (!SUB_TOKEN || token !== SUB_TOKEN) {
      return text("Unauthorized", 401);
    }

    const username = extractSegment(pathname, "/subscribe/");
    if (!username) return text("Имя клиента не указано.", 400);

    const format = (url.searchParams.get("format") ?? "base64").toLowerCase();
    if (!["raw", "base64"].includes(format)) {
      return text("Параметр format должен быть raw или base64.", 400);
    }

    const result = await aggregateSubscriptions(username);
    return text(format === "raw" ? result.raw : result.base64);
  }

  // ── Авторизация ─────────────────────────────────────────────────────────────

  if (method === "GET" && pathname === "/auth/login") {
    const sid = getSessionId(request);
    if (isValidSession(sid)) return redirect("/");
    return serveLogin();
  }

  if (method === "POST" && pathname === "/auth/login") {
    const form = await request.formData().catch(() => null);
    const user = form?.get("username")?.toString().trim() ?? "";
    const pass = form?.get("password")?.toString()        ?? "";

    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
      return serveLogin("Неверный логин или пароль.");
    }

    const { id, expiresAt } = createSession();
    return redirect("/", { "set-cookie": sessionCookie(id, expiresAt) });
  }

  if (method === "POST" && pathname === "/auth/logout") {
    const sid = getSessionId(request);
    if (sid) deleteSession(sid);
    return redirect("/auth/login", { "set-cookie": clearCookie() });
  }

  // ── Защита: всё ниже требует авторизации ────────────────────────────────────

  const sid = getSessionId(request);
  if (!isValidSession(sid)) {
    // API-запросы — JSON-ошибка
    if (pathname.startsWith("/api/")) return json({ error: "Unauthorized" }, 401);
    // Страницы — редирект на логин
    return redirect("/auth/login");
  }

  // ── Статика (панель) ─────────────────────────────────────────────────────────

  if (method === "GET" && !pathname.startsWith("/api/")) {
    return serveStatic(pathname);
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  // GET /api/sources
  if (method === "GET" && pathname === "/api/sources") {
    return json(await readSources());
  }

  // GET /api/config  — возвращает публичный SUB_TOKEN для показа в UI
  if (method === "GET" && pathname === "/api/config") {
    return json({ subToken: SUB_TOKEN });
  }

  // POST /api/sources
  if (method === "POST" && pathname === "/api/sources") {
    const body    = await parseJsonBody(request);
    const payload = validateSource(body);
    const sources = await readSources();
    const created = { id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString() };
    sources.push(created);
    await writeSources(sources);
    return json(created, 201);
  }

  // PUT /api/sources/:id
  if (method === "PUT" && pathname.startsWith("/api/sources/")) {
    const id      = extractSegment(pathname, "/api/sources/");
    if (!id)      return json({ error: "ID не указан." }, 400);
    const body    = await parseJsonBody(request);
    const payload = validateSource(body);
    const sources = await readSources();
    const index   = sources.findIndex((s) => s.id === id);
    if (index === -1) return json({ error: "Источник не найден." }, 404);
    sources[index] = { ...sources[index], ...payload, updatedAt: new Date().toISOString() };
    await writeSources(sources);
    return json(sources[index]);
  }

  // DELETE /api/sources/:id
  if (method === "DELETE" && pathname.startsWith("/api/sources/")) {
    const id       = extractSegment(pathname, "/api/sources/");
    if (!id)       return json({ error: "ID не указан." }, 400);
    const sources  = await readSources();
    const filtered = sources.filter((s) => s.id !== id);
    if (filtered.length === sources.length) return json({ error: "Источник не найден." }, 404);
    await writeSources(filtered);
    return empty(204);
  }

  // GET /api/aggregate/:username
  if (method === "GET" && pathname.startsWith("/api/aggregate/")) {
    const username = extractSegment(pathname, "/api/aggregate/");
    if (!username) return json({ error: "Имя клиента не указано." }, 400);
    return json(await aggregateSubscriptions(username));
  }

  return text("Not found", 404);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Запуск
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve({ hostname: HOST, port: PORT }, async (request) => {
  try {
    return await router(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неожиданная ошибка.";
    const status  = error.httpStatus ?? 400;
    return json({ error: message }, status);
  }
});

console.log(`3x-ui subscription manager → http://${HOST}:${PORT}`);
