// index.js
// Bridge Azure Bot Framework -> Dify Advanced Chat App API (Express)

const express = require('express');
const { BotFrameworkAdapter } = require('botbuilder');
const axios = require('axios');

const DIFY_BASE = (process.env.DIFY_API_BASE || '').replace(/\/+$/, '');
const DIFY_KEY = process.env.DIFY_API_KEY || '';

const MICROSOFT_APP_ID = process.env.MicrosoftAppId || '';
const MICROSOFT_APP_PASSWORD = process.env.MicrosoftAppPassword || '';

const PORT = parseInt(process.env.PORT || '8080', 10);

// --- Logs de arranque y guardarraíles ---
console.log('[BOOT] Node:', process.version);
console.log('[BOOT] Port:', PORT);
console.log('[BOOT] MicrosoftAppId present:', !!MICROSOFT_APP_ID);
console.log('[BOOT] DIFY_BASE:', DIFY_BASE || '(no-config)');
console.log('[BOOT] DIFY_KEY prefix/len:', DIFY_KEY ? `${DIFY_KEY.slice(0, 6)} / ${DIFY_KEY.length}` : '(no-config)');

process.on('unhandledRejection', (r) => {
  console.error('[UNHANDLED_REJECTION]', r);
});
process.on('uncaughtException', (e) => {
  console.error('[UNCAUGHT_EXCEPTION]', e);
});

// --- Adapter Bot Framework ---
const adapter = new BotFrameworkAdapter({
  appId: MICROSOFT_APP_ID,
  appPassword: MICROSOFT_APP_PASSWORD,
});

adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError]', error);
  try { await context.sendActivity('Lo siento, ocurrió un error procesando tu mensaje.'); } catch {}
};

// --- Express app ---
const app = express();
app.use(express.json());

// Health y raíz (para warmup/pings de Azure)
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'dify-bot-bridge', node: process.version }));
app.get('/', (_req, res) => res.status(200).json({ ok: true, hint: 'POST /api/messages desde Azure Bot Service' }));

// Endpoint Bot Framework
app.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    if (context.activity?.type === 'message') {
      const text = (context.activity.text || '').trim();
      const userId = context.activity?.from?.id || 'user';

      if (!DIFY_BASE || !DIFY_KEY) {
        await context.sendActivity('Falta DIFY_API_BASE o DIFY_API_KEY en App Settings.');
        return;
      }

      try {
        const { data } = await axios.post(
          `${DIFY_BASE}/chat-messages`,
          {
            inputs: {},
            query: text,
            response_mode: 'blocking',
            user: userId,
            conversation_id: userId,
          },
          {
            headers: { Authorization: `Bearer ${DIFY_KEY}`, 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );

        const answer = data?.answer || data?.output_text || 'Sin respuesta desde Dify.';
        await context.sendActivity(answer);
      } catch (err) {
        console.error('[Dify error]', err?.response?.status, err?.response?.data || err.message);
        await context.sendActivity('Error consultando la API de Dify. Revisa logs del Web App.');
      }
    } else {
      await context.sendActivity(`[${context.activity?.type}] recibido.`);
    }
  });
});

// Ajustes para Azure App Service (evitar timeouts internos de Node)
const server = app.listen(PORT, () => console.log(`[BOOT] HTTP server escuchando en :${PORT}`));
server.keepAliveTimeout = 65000;   // > 60s
server.headersTimeout = 66000;
