// CommonJS para máxima compatibilidad en App Service Linux
const express = require("express");
const helmet = require("helmet");

// PUERTO: Azure inyecta PORT o WEBSITES_PORT y espera escuchar en 8080.
// Tomamos PORT, luego WEBSITE_PORT/WEBSITES_PORT y por defecto 8080 (recomendado).
const PORT =
  Number(process.env.PORT) ||
  Number(process.env.WEBSITE_PORT) ||
  Number(process.env.WEBSITES_PORT) ||
  8080;

// Opcional: host explícito (recomendado en contenedores)
const HOST = process.env.HOST || "0.0.0.0";

// Proveedor por defecto: dify | azure (Azure OpenAI)
const PROVIDER = (process.env.PROVIDER || "dify").toLowerCase();

const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false, // no bloquees por defecto
  })
);
app.use(express.json({ limit: "1mb" }));

// --------- Utilidades ----------
function hasAzureOpenAI() {
  return (
    !!process.env.AZURE_OPENAI_ENDPOINT &&
    !!process.env.AZURE_OPENAI_DEPLOYMENT &&
    !!process.env.AZURE_OPENAI_API_KEY
  );
}

function hasDify() {
  // Uno de los dos: App Key o HTTP Bearer Key
  return !!(process.env.DIFY_API_KEY || process.env.DIFY_BEARER);
}

function providerOK() {
  if (PROVIDER === "azure") return hasAzureOpenAI();
  return hasDify(); // dify por defecto
}

function errMissingVars() {
  if (PROVIDER === "azure") {
    return (
      "Faltan variables para Azure OpenAI: " +
      "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY"
    );
  }
  return "Faltan variables para Dify: DIFY_API_KEY (o DIFY_BEARER)";
}

// --------- Rutas básicas ----------
app.get("/", (_req, res) => {
  res.type("text/plain").send("up");
});

// Health de arranque MUY rápido (Azure hace warmup/ping)
// No valida credenciales para no romper el arranque.
app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    provider: PROVIDER,
    port: PORT,
    ready: true,
  });
});

// --------- Chat endpoint ----------
app.post("/api/chat", async (req, res) => {
  try {
    if (!providerOK()) {
      return res.status(500).json({ error: errMissingVars(), provider: PROVIDER });
    }

    const { message, user } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Falta 'message' (string)." });
    }

    // Selección de proveedor
    if (PROVIDER === "azure") {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT; // p.ej. https://tu-recurso.openai.azure.com
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT; // nombre de tu deployment (gpt-4o, gpt-35-turbo, etc.)
      const apiKey = process.env.AZURE_OPENAI_API_KEY;

      // API 2024-02-15-preview (chat/completions)
      const url = `${endpoint}/openai/deployments/${encodeURIComponent(
        deployment
      )}/chat/completions?api-version=2024-02-15-preview`;

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Eres un asistente útil." },
            { role: "user", content: message },
          ],
          temperature: Number(process.env.TEMPERATURE || 0.2),
          max_tokens: Number(process.env.MAX_TOKENS || 512),
        }),
        // timeout conservador
        signal: AbortSignal.timeout(Number(process.env.UPSTREAM_TIMEOUT_MS || 65000)),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return res.status(502).json({
          error: "Azure OpenAI devolvió un error",
          status: r.status,
          body: text,
        });
      }

      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content || "";
      return res.json({ reply: content });
    }

    // --- Dify (por defecto) ---
    // Puedes usar API Key (DIFY_API_KEY) o Bearer (DIFY_BEARER);
    // La URL suele ser https://api.dify.ai/v1 o la de tu instancia.
    const baseUrl = process.env.DIFY_BASE_URL || "https://api.dify.ai/v1";
    const appKey = process.env.DIFY_API_KEY || "";
    const bearer = process.env.DIFY_BEARER || "";

    const headers = { "Content-Type": "application/json" };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (appKey) headers["Authorization"] = `Bearer ${appKey}`; // si defines ambos, App Key tiene prioridad

    // endpoint de mensajes (modo no streaming)
    const url = `${baseUrl.replace(/\/+$/, "")}/chat-messages`;

    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: {},
        response_mode: "blocking",
        query: message,
        user: user || "azure-appservice",
      }),
      signal: AbortSignal.timeout(Number(process.env.UPSTREAM_TIMEOUT_MS || 65000)),
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
    const answer =
      data?.answer ||
      data?.data?.outputs?.answer ||
      data?.outputs?.answer ||
      "";
    return res.json({ reply: answer });
  } catch (err) {
    console.error("ERROR /api/chat:", err?.stack || err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// --------- Arranque del servidor ----------
const server = app.listen(PORT, HOST, () => {
  console.log(`[startup] listening on http://${HOST}:${PORT} provider=${PROVIDER}`);
});

// Tiempos de keep-alive generosos (evita corte de pings de plataforma)
server.keepAliveTimeout = Number(process.env.KEEPALIVE_TIMEOUT_MS || 65000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000);
