const HOST = Deno.env.get("HOST") || "0.0.0.0";
const PORT = Number(Deno.env.get("PORT") || 3000);
const ROOT = Deno.cwd();
const DATA_DIR = `${ROOT}/data`;
const DATA_FILE = `${DATA_DIR}/sources.json`;
const PUBLIC_DIR = `${ROOT}/public`;

const MIME_TYPES = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  return JSON.parse(raw);
}

async function writeSources(sources) {
  await ensureDataFile();
  await Deno.writeTextFile(DATA_FILE, `${JSON.stringify(sources, null, 2)}\n`);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function text(payload, status = 200) {
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function empty(status = 204) {
  return new Response(null, { status });
}

function validateSource(payload) {
  const source = {
    name: String(payload.name || "").trim(),
    domain: String(payload.domain || "").trim(),
    port: String(payload.port || "").trim(),
    path: String(payload.path || "").trim().replace(/^\/+|\/+$/g, ""),
  };

  if (!source.name || !source.domain || !source.port || !source.path) {
    throw new Error("Fields name, domain, port and path are required.");
  }

  if (!/^\d+$/.test(source.port)) {
    throw new Error("Port must contain only digits.");
  }

  return source;
}

function buildSubscriptionUrl(source, username) {
  return `https://${source.domain}:${source.port}/${source.path}/${encodeURIComponent(username.trim())}`;
}

function maybeDecodeBase64(input) {
  const compact = input.replace(/\s+/g, "");

  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return null;
  }

  try {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = decoder.decode(bytes);
    return decoded.includes("://") ? decoded : null;
  } catch {
    return null;
  }
}

function encodeBase64Utf8(input) {
  const bytes = encoder.encode(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function withServerName(config, serverName) {
  const cleanConfig = config.trim();

  if (!cleanConfig) {
    return cleanConfig;
  }

  const [withoutFragment] = cleanConfig.split("#");
  return `${withoutFragment}#${encodeURIComponent(serverName)}`;
}

function extractConfigs(payload) {
  const textPayload = payload.trim();

  if (!textPayload) {
    return [];
  }

  const normalized = maybeDecodeBase64(textPayload) || textPayload;

  return normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("://"));
}

async function aggregateSubscriptions(username) {
  const cleanUsername = String(username || "").trim();

  if (!cleanUsername) {
    throw new Error("Username is required.");
  }

  const sources = await readSources();
  const results = await Promise.all(
    sources.map(async (source) => {
      const url = buildSubscriptionUrl(source, cleanUsername);

      try {
        const response = await fetch(url, {
          headers: {
            "user-agent": "3x-ui-subscription-manager/1.0",
            accept: "text/plain,application/json;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = await response.text();
        const configs = extractConfigs(body).map((config) => withServerName(config, source.name));

        return {
          sourceId: source.id,
          sourceName: source.name,
          url,
          ok: true,
          count: configs.length,
          configs,
        };
      } catch (error) {
        return {
          sourceId: source.id,
          sourceName: source.name,
          url,
          ok: false,
          count: 0,
          configs: [],
          error: error.message,
        };
      }
    })
  );

  const uniqueConfigs = [...new Set(results.flatMap((item) => item.configs))];
  const raw = uniqueConfigs.join("\n");
  const base64 = encodeBase64Utf8(raw);

  return {
    username: cleanUsername,
    generatedAt: new Date().toISOString(),
    totalSources: sources.length,
    reachableSources: results.filter((item) => item.ok).length,
    totalConfigs: uniqueConfigs.length,
    raw,
    base64,
    results,
  };
}

async function serveStatic(pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  if (normalizedPath.includes("..")) {
    return text("Forbidden", 403);
  }

  const filePath = `${PUBLIC_DIR}${normalizedPath}`;

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return text("Forbidden", 403);
  }

  try {
    const body = await Deno.readFile(filePath);
    const ext = filePath.split(".").pop() || "txt";

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": MIME_TYPES[ext] || "application/octet-stream",
      },
    });
  } catch {
    return text("Not found", 404);
  }
}

Deno.serve({ hostname: HOST, port: PORT }, async (request) => {
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.pathname === "/api/sources") {
      return json(await readSources());
    }

    if (request.method === "POST" && url.pathname === "/api/sources") {
      const payload = validateSource(await request.json());
      const sources = await readSources();

      const created = {
        id: crypto.randomUUID(),
        ...payload,
        createdAt: new Date().toISOString(),
      };

      sources.push(created);
      await writeSources(sources);
      return json(created, 201);
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/sources/")) {
      const id = decodeURIComponent(url.pathname.replace("/api/sources/", ""));
      const payload = validateSource(await request.json());
      const sources = await readSources();
      const index = sources.findIndex((item) => item.id === id);

      if (index === -1) {
        return json({ error: "Source not found." }, 404);
      }

      sources[index] = {
        ...sources[index],
        ...payload,
        updatedAt: new Date().toISOString(),
      };

      await writeSources(sources);
      return json(sources[index]);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/sources/")) {
      const id = decodeURIComponent(url.pathname.replace("/api/sources/", ""));
      const sources = await readSources();
      const filtered = sources.filter((item) => item.id !== id);

      if (filtered.length === sources.length) {
        return json({ error: "Source not found." }, 404);
      }

      await writeSources(filtered);
      return empty(204);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/aggregate/")) {
      const username = decodeURIComponent(url.pathname.replace("/api/aggregate/", ""));
      return json(await aggregateSubscriptions(username));
    }

    if (request.method === "GET" && url.pathname.startsWith("/subscribe/")) {
      const username = decodeURIComponent(url.pathname.replace("/subscribe/", ""));
      const format = (url.searchParams.get("format") || "base64").toLowerCase();
      const result = await aggregateSubscriptions(username);

      return format === "raw" ? text(result.raw) : text(result.base64);
    }

    return await serveStatic(url.pathname);
  } catch (error) {
    return json({ error: error.message || "Unexpected error." }, 400);
  }
});

console.log(`3x-ui subscription manager running at http://${HOST}:${PORT}`);
