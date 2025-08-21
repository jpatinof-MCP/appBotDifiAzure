// Bridge Azure Bot Framework -> Dify (blocking)
//
// Requisitos de entorno (exactos, respetando mayúsculas/minúsculas):
// - MicrosoftAppId
// - MicrosoftAppPassword
// - DIFY_API_BASE        (p. ej. http://101.44.8.170/v1  sin “/” al final)
// - DIFY_API_KEY         (p. ej. app-IfzyJ1rKmtXMc6YMlKWm6mck  sin “Bearer”)
//
// Node 20+ (App Service). Usa Restify y Bot Framework SDK.

const restify = require('restify');
const { ActivityHandler, BotFrameworkAdapter } = require('botbuilder');

// ---------------------------
// Configuración / Entorno
// ---------------------------
const PORT = process.env.PORT || 3978;

const MICROSOFT_APP_ID = process.env.MicrosoftAppId || '';
const MICROSOFT_APP_PASSWORD = process.env.MicrosoftAppPassword || '';

const DIFY_BASE = ((process.env.DIFY_API_BASE || '').trim()).replace(/\/+$/, '');
const DIFY_KEY = (process.env.DIFY_API_KEY || '').trim(); // SOLO el token, sin 'Bearer'

// Logs de arranque (no imprimimos secretos)
console.log('[BOOT] Node:', process.version);
console.log('[BOOT] Port:', PORT);
console.log('[BOOT] MicrosoftAppId present:', MICROSOFT_APP_ID.length > 0);
console.log('[BOOT] DIFY_BASE:', DIFY_BASE || '(missing)');
console.log('[BOOT] DIFY_KEY prefix/len:', (DIFY_KEY ? DIFY_KEY.slice(0, 8) : ''), '/', (DIFY_KEY || '').length);

// ---------------------------
// Servidor Restify
// ---------------------------
const server = restify.createServer();
server.use(restify.plugins.bodyParser({ mapParams: false }));

// Health check
server.get('/health', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(200, { ok: true, service: 'dify-bot-bridge', node: process.version });
});

// Endpoint de mensajes del Bot Framework (POST obligatorio)
server.post('/api/messages', (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

server.listen(PORT, () => {
  console.log(`[BOOT] Bridge listo. Endpoints: GET /health  |  POST /api/messages  |  PORT ${PORT}`);
});

// ---------------------------
// Adapter y Bot
// ---------------------------
const adapter = new BotFrameworkAdapter({
  appId: MICROSOFT_APP_ID,
  appPassword: MICROSOFT_APP_PASSWORD,
});

adapter.onTurnError = async (context, error) => {
  console.error('[BOT ERROR]', error);
  try {
    await context.sendActivity('Lo siento, ocurrió un problema procesando tu mensaje.');
  } catch (e) {
    console.error('[BOT ERROR][sendActivity failed]', e);
  }
};

// Memoria simple para guardar conversation_id por usuario (contexto Dify)
const userConv = new Map();

class DifyBridgeBot extends ActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      const text = (context.activity && (context.activity.text || '')).trim();
      const userId = getStableUserId(context);

      if (!text) {
        await context.sendActivity('¿Podrías repetirlo? No recibí texto.');
        await next();
        return;
      }

      try {
        const answer = await askDifyBlocking(text, userId);
        await context.sendActivity(answer || 'No obtuve respuesta del servicio.');
      } catch (err) {
        console.error('[DIFY ERROR]', err && err.message ? err.message : err);
        await context.sendActivity('Hubo un problema consultando al servicio. Intenta nuevamente.');
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded || []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity('¡Hola! Soy tu asistente. ¿En qué puedo ayudarte?');
        }
      }
      await next();
    });
  }
}

const bot = new DifyBridgeBot();

// ---------------------------
// Funciones auxiliares
// ---------------------------

function getStableUserId(context) {
  const a = context.activity || {};
  const from = a.from || {};
  return (from.id || (a.conversation && a.conversation.id) || 'anonymous-user');
}

async function askDifyBlocking(text, userId) {
  if (!DIFY_BASE || !DIFY_KEY) {
    throw new Error('Faltan DIFY_API_BASE o DIFY_API_KEY en variables de entorno.');
  }

  const url = `${DIFY_BASE}/chat-messages`;
  const headers = {
    'Authorization': `Bearer ${DIFY_KEY}`, // usar backticks para interpolar
    'Content-Type': 'application/json',
  };

  const existingConvId = userConv.get(userId) || '';

  const payload = {
    inputs: {},
    query: text,
    response_mode: 'blocking',
    user: userId,
    ...(existingConvId ? { conversation_id: existingConvId } : {}),
  };

  // Node 20+ ya trae fetch global
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Dify HTTP ${res.status} - ${bodyText}`);
  }

  const data = await res.json();

  // Persistimos conversation_id para mantener el contexto del usuario
  if (data && data.conversation_id) {
    userConv.set(userId, data.conversation_id);
  }

  return (data && typeof data.answer === 'string') ? data.answer : '';
}
