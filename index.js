// index.js
// Bridge Azure Bot Framework -> Dify Advanced Chat App API

const restify = require('restify');
const { BotFrameworkAdapter } = require('botbuilder');
const axios = require('axios');

// === Variables de entorno (exactamente como están en tu Web App) ===
const DIFY_BASE = (process.env.DIFY_API_BASE || '').replace(/\/+$/, ''); // sin / final
const DIFY_KEY = process.env.DIFY_API_KEY || '';

const MICROSOFT_APP_ID = process.env.MicrosoftAppId || '';
const MICROSOFT_APP_PASSWORD = process.env.MicrosoftAppPassword || '';

const PORT = process.env.PORT || 8080;

// Validaciones mínimas para ver en logs
console.log('[BOOT] Node:', process.version);
console.log('[BOOT] Port:', PORT);
console.log('[BOOT] MicrosoftAppId present:', !!MICROSOFT_APP_ID);
console.log('[BOOT] DIFY_BASE:', DIFY_BASE || '(no-config)');
console.log('[BOOT] DIFY_KEY prefix/len:', DIFY_KEY ? `${DIFY_KEY.slice(0, 6)} / ${DIFY_KEY.length}` : '(no-config)');

// === Adapter de Bot Framework ===
const adapter = new BotFrameworkAdapter({
  appId: MICROSOFT_APP_ID,
  appPassword: MICROSOFT_APP_PASSWORD,
});

// Manejo de errores del adapter
adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError]', error);
  try {
    await context.sendActivity('Lo siento, ocurrió un error procesando tu mensaje.');
  } catch (e) {
    console.error('Error enviando notificación al usuario:', e);
  }
};

// === Servidor Restify ===
const server = restify.createServer();

// Body parser para JSON
server.use(restify.plugins.bodyParser());

// Healthcheck (ahora async para quitar el error)
server.get('/health', async (req, res) => {
  res.send(200, { ok: true, service: 'dify-bot-bridge', node: process.version });
});

// Página raíz sencilla (async también)
server.get('/', async (req, res) => {
  res.send(200, { ok: true, hint: 'POST /api/messages desde Azure Bot Service' });
});

// Endpoint que usa Azure Bot Service
server.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    if (context.activity && context.activity.type === 'message') {
      const text = (context.activity.text || '').trim();
      const userId = (context.activity.from && context.activity.from.id) || 'user';

      // Si falta configuración de Dify, avisamos
      if (!DIFY_BASE || !DIFY_KEY) {
        await context.sendActivity(
          'El puente no tiene configurado DIFY_API_BASE o DIFY_API_KEY. Revisa las App Settings del Web App.'
        );
        return;
      }

      try {
        // Llamada a Dify Advanced Chat App API (modo blocking)
        const { data } = await axios.post(
          `${DIFY_BASE}/chat-messages`,
          {
            inputs: {},
            query: text,
            response_mode: 'blocking',
            user: userId,
            // Usa el mismo id como conversación para mantener contexto por usuario
            conversation_id: userId,
          },
          {
            headers: {
              Authorization: `Bearer ${DIFY_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        // Normalizamos la respuesta
        const answer =
          (data && (data.answer || data.output_text)) ||
          'No recibí respuesta del motor de IA.';

        await context.sendActivity(answer);
      } catch (err) {
        console.error('[Dify error]', err?.response?.status, err?.response?.data || err.message);
        await context.sendActivity(
          'Ocurrió un error consultando la API de Dify. Revisa logs del Web App.'
        );
      }
    } else {
      // Otros tipos de actividad
      await context.sendActivity(`[${context.activity?.type}] recibido.`);
    }
  });
});

// Arranque del servidor
server.listen(PORT, () => {
  console.log(`[BOOT] Servidor escuchando en puerto ${PORT}`);
});
