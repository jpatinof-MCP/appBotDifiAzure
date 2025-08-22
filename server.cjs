// CommonJS para máxima compatibilidad en App Service Linux
const express = require("express");
const helmet = require("helmet");

// -------------------- Config Azure / Puertos --------------------
const PORT =
  Number(process.env.PORT) ||
  Number(process.env.WEBSITE_PORT) ||
  Number(process.env.WEBSITES_PORT) ||
  3000;
const HOST = process.env.HOST || "0.0.0.0";

// -------------------- Datos en duro (según tu pedido) --------------------
const DIFY_BASE_URL = "http://101.44.8.170/v1";
const DIFY_CHAT_MESSAGES_URL = `${DIFY_BASE_URL}/chat-messages`;
const DIFY_BEARER = "app-IfzyJ1rKmtXMc6YMlKWm6mck"; // Authorization: Bearer <esto>

const MICROSOFT_APP_ID = "ddfb3278-c7dc-4592-b7cf-e844de19ef47";
const MICROSOFT_APP_PASSWORD = "nmY8Q~CEf~Cdz22dhpD7.zb8zW8.JNxaZu1qHamH";

// tiempo de red/keep-alive
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 65000);
const KEEPALIVE_TIMEOUT_MS = Number(process.env.KEEPALIVE_TIMEOUT_MS || 65000);
const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS || 66000);

// -------------------- App --------------------
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: "1mb" }));

// Limpia <details>...</details> (incluye saltos de línea) y devuelve el resto
function stripDetails(html = "") {
  if (typeof html !== "string") return "";
  const cleaned = html.replace(/<details[\s\S]*?<\/details>\s*/i, "").trim();
  return cleaned;
}

// -------------------- Rutas --------------------

// Healthcheck (configúralo en Azure si quieres usar Health Check)
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    port: PORT,
    ms_app_id: MICROSOFT_APP_ID ? "present" : "missing",
    dify_url: DIFY_CHAT_MESSAGES_URL,
  });
});

// Llamada genérica: POST /api/chat { message?: string, user?: string }
app.post("/api/chat", async (req, res) => {
  try {
    const message =
      (req.body && typeof req.body.message === "string" && req.body.message.trim()) ||
      "cuales son los procesos de afiliacion?";
    const user = (req.body && req.body.user) || "ms-teams-demo";

    const payload = {
      query: message,
      inputs: {},                 // en duro para esta prueba
      response_mode: "blocking",  // respuesta directa
      user: user
    };

    const r = await fetch(DIFY_CHAT_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DIFY_BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({
        error: "Dify devolvió un error",
        status: r.status,
        body: text,
      });
    }

    const data = await r.json();
    const rawAnswer = data?.answer || "";
    const reply = stripDetails(rawAnswer);

    return res.json({
      reply,            // <-- solo lo que te interesa
      // opcionalmente retornamos debug por ahora:
      raw_answer: rawAnswer,
      from: "dify",
    });
  } catch (err) {
    console.error("ERROR /api/chat:", err?.stack || err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Ruta de prueba rápida en duro (GET) -> dispara la misma consulta que tú pegaste
app.get("/api/test", async (_req, res) => {
  try {
    const payload = {
      query: "cuales son los procesos de afiliacion?",
      inputs: {},
      response_mode: "blocking",
      user: "ms-teams-demo"
    };

    const r = await fetch(DIFY_CHAT_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DIFY_BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({
        error: "Dify devolvió un error",
        status: r.status,
        body: text,
      });
    }

    const data = await r.json();
    const rawAnswer = data?.answer || "";
    const reply = stripDetails(rawAnswer);

    return res.json({ reply, raw_answer: rawAnswer, from: "dify" });
  } catch (err) {
    console.error("ERROR /api/test:", err?.stack || err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Raíz simple para warmup
app.get("/", (_req, res) => res.type("text/plain").send("up"));

// -------------------- Arranque --------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`[startup] listening on http://${HOST}:${PORT}`);
  console.log(`[startup] dify: ${DIFY_CHAT_MESSAGES_URL}`);
});

server.keepAliveTimeout = KEEPALIVE_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
