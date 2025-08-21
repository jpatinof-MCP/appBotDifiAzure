// server.js
// Servidor Express listo para Azure App Service (Linux, Node 20)
// Modo chatbot: DIFY o AZURE_OPENAI según env CHAT_PROVIDER
// Endpoints: GET /healthz, GET /, POST /api/chat

import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import http from "http";

// ------- Utilidades -------
const required = (name) => {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing env: ${name}`);
  return v;
};

const toBool = (v, def = false) => {
  if (v == null) return def;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};

// ------- App base -------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));

app.use(express.json({ limit: process.env.JSON_LIMIT || "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan(process.env.LOG_FORMAT || "tiny"));

// ------- Endpoints básicos -------
app.get("/", (_req, res) => res.status(200).send("up"));
app.get("/healthz", (_req, res) => {
  const provider = (process.env.CHAT_PROVIDER || "DIFY").toUpperCase();
  const ok = validateProviderConfig(provider, false);
  res.status(ok ? 200 : 500).json({
    ok,
    provider,
    node: process.version,
    instance: process.env.WEBSITE_INSTANCE_ID || null
  });
});

// ------- Validación de config por proveedor -------
function validateProviderConfig(provider, throwOnError = true) {
  try {
    if (provider === "DIFY") {
      required("DIFY_API_BASE");       // ej: https://api.dify.ai
      required("DIFY_API_KEY");        // Bearer <key>
      // Opcional: DIFY_APP_ID (si tu backend lo requiere para ruteo), no siempre es necesario
    } else if (provider === "AZURE_OPENAI") {
      required("AZURE_OPENAI_ENDPOINT");     // https://<resource>.openai.azure.com
      required("AZURE_OPENAI_API_KEY");
      required("AZURE_OPENAI_DEPLOYMENT");   // nombre del deployment (modelo)
      required("AZURE_OPENAI_API_VERSION");  // ej: 2024-06-01
    } else {
      throw new Error(`CHAT_PROVIDER no soportado: ${provider}`);
    }
    return true;
  } catch (err) {
    if (throwOnError) throw err;
    return false;
  }
}

// ------- Handler principal del chatbot -------
// Request body esperado:
// { userId?: string, message: string, metadata?: object, inputs?: object, stream?: boolean }
// Respuesta: { answer, provider, raw }
app.post("/api/chat", async (req, res) => {
  const provider = (process.env.CHAT_PROVIDER || "DIFY").toUpperCase();
  try {
    validateProviderConfig(provider, true);

    const {
      message,
      userId = req.headers["x-user-id"] || "anonymous",
      metadata = {},
      inputs = {},
      stream = false // stream=false (bloqueante) para simplicidad en App Service
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Campo 'message' es requerido" });
    }

    if (provider === "DIFY") {
      const payload = {
        inputs,                    // variables de tu app Dify, si aplica
        query: message,            // texto del usuario
        user: String(userId),      // id de usuario para hilo/contesto
        response_mode: stream ? "streaming" : "blocking"
      };

      const r = await fetch(`${process.env.DIFY_API_BASE.replace(/\/+$/, "")}/v1/chat-messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.DIFY_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        // Nota: si usas streaming real, aquí manejarías el body como stream SSE
      });

      const raw = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: "Dify API error", details: raw });
      }

      // Dify "blocking" suele devolver { answer, ... }
      const answer = raw.answer ?? raw.output ?? raw.data ?? "";
      return res.json({ answer, provider: "DIFY", raw });

    } else if (provider === "AZURE_OPENAI") {
      // Build mensajes de chat
      const sysPrompt = process.env.SYSTEM_PROMPT || "Eres un asistente útil.";
      const messages = [
        { role: "system", content: sysPrompt },
        ...(Array.isArray(metadata?.history) ? metadata.history : []).filter(Boolean),
        { role: "user", content: message }
      ];

      const url = `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "")}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}`;

      const body = {
        messages,
        temperature: Number(process.env.OAI_TEMPERATURE ?? 0.2),
        max_tokens: Number(process.env.OAI_MAX_TOKENS ?? 800),
        top_p: Number(process.env.OAI_TOP_P ?? 1),
        stream: false // mantener simple para App Service
      };

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": process.env.AZURE_OPENAI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const raw = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: "Azure OpenAI API error", details: raw });
      }

      const choice = (raw.choices && raw.choices[0]) || {};
      const answer = choice.message?.content ?? "";
      return res.json({ answer, provider: "AZURE_OPENAI", raw });
    }

    return res.status(500).json({ error: "Proveedor no manejado", provider });
  } catch (err) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// ------- Servidor HTTP -------
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const server = http.createServer(app);
server.headersTimeout = 65_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 20_000;

server.listen(PORT, HOST, () => {
  console.log(
    `[startup] Listening on http://${HOST}:${PORT} | PROVIDER=${(process.env.CHAT_PROVIDER || "DIFY").toUpperCase()} | NODE_ENV=${process.env.NODE_ENV || "undefined"}`
  );
});

// Apagado limpio
const shutdown = (signal) => {
  console.warn(`[shutdown] ${signal} recibido. Cerrando...`);
  server.close((err) => {
    if (err) {
      console.error("[shutdown] Error en server.close:", err);
      process.exit(1);
    }
    console.log("[shutdown] Cerrado limpio.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[shutdown] Salida forzada tras timeout.");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (r) => console.error("[fatal] UnhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("[fatal] UncaughtException:", e));
