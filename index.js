/**
 * Dify <-> Azure Bot Bridge
 * - Expone /api/messages para Bot Framework
 * - Llama a Dify /v1/chat-messages en modo blocking
 * - Mantiene sesiones privadas por usuario (user & conversation_id)
 */

const restify = require('restify');
const { BotFrameworkAdapter } = require('botbuilder');
const axios = require('axios');

// ==== Variables de entorno requeridas (ponerlas en Azure → Configuration → Application settings) ====
const APP_ID = process.env.MicrosoftAppId;            // GUID de tu App Registration
const APP_PASSWORD = process.env.MicrosoftAppPassword; // Client Secret de tu App Registration
const DIFY_BASE = (process.env.DIFY_API_BASE || '').replace(/\/$/, ''); // ej. http://101.44.8.170/v1 (sin slash final)
const DIFY_KEY = process.env.DIFY_API_KEY;            // API Key de tu Dify App

// Validación básica de configuración
const missing = [];
if (!APP_ID) missing.push('MicrosoftAppId');
if (!APP_PASSWORD) missing.push('MicrosoftAppPassword');
if (!DIFY_BASE) missing.push('DIFY_API_BASE');
if (!DIFY_KEY) missing.push('DIFY_API_KEY');

if (missing.length) {
  console.error('[CONFIG] Faltan variables:', missing.join(', '));
}

// ==== Adapter del Bot Framework ====
const adapter = new BotFrameworkAdapter({
  appId: APP_ID,
  appPassword: APP_PASSWORD
});

// Log de errores no controlados del adapter
adapter.onTurnError = async (context, error) => {
  console.error('[BOT ERROR]', error);
  try {
    await context.sendActivity('Lo siento, ocurrió un error procesando tu mensaje.');
  } catch (e) {
    console.error('[BOT ERROR sendActivity]', e);
  }
};

// ==== Servidor Restify ====
const server = restify.createServer({ name: 'dify-bot-bridge' });
const PORT = process.env.PORT || 3978;

server.use(restify.plugins.bodyParser({ mapParams: true }));
server.use(restify.plugins.queryParser());

// Endpoint de salud y verificación rápida
server.get('/', (req, res, next) => {
  res.send(200, { ok: true, service: 'dify-bot-bridge', node: process.version });
  return next();
});

server.get('/health', (req, res, next) => {
  res.send(200, { status: 'healthy' });
  return next();
});

// Bot Framework usará este endpoint POST
server.post('/api/messages', async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    // Solo procesamos mensajes de texto (ignorar typing, conversationUpdate, etc.)
    if (context.activity?.type !== 'message') return;

    const text = String(context.activity.text || '').trim();
    const fromId = context.activity?.from?.id || 'unknown';
    const convId = context.activity?.conversation?.id || undefined;

    // Construimos identidad estable por usuario para sesiones privadas
    const userId = `teams-${fromId}`;

    // Si no hay texto, devolvemos un aviso
    if (!text) {
      await context.sendActivity('¿Podrías escribir tu consulta?');
      return;
    }

    // Llamada a Dify (modo blocking)
    try {
      const payload = {
        inputs: {},                  // si tu App en Dify usa inputs personalizados, colócalos aquí
        query: text,                 // texto del usuario
        response_mode: 'blocking',   // blocking (sencillo y confiable para bot)
        conversation_id: convId || '', // ayuda a mantener el contexto por conversación
        user: userId                 // identidad única por usuario
        // files: []                 // (opcional) si luego quieres enviar archivos
      };

      const difyResp = await axios.post(
        `${DIFY_BASE}/chat-messages`,
        payload,
        {
          headers: { Authorization: `Bearer ${DIFY_KEY}`, 'Content-Type': 'application/json' },
          timeout: 60000, // 60s
          maxContentLength: 20 * 1024 * 1024
        }
      );

      // Dify (blocking) devuelve: { event, answer, conversation_id, ... }
      const answer = difyResp?.data?.answer ?? '';
      if (!answer) {
        console.warn('[DIFY] Respuesta vacía o inesperada:', difyResp?.data);
        await context.sendActivity('No recibí contenido del motor de IA. Intenta nuevamente.');
      } else {
        await context.sendActivity(answer);
      }
    } catch (err) {
      // Logs detallados de error
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error('[DIFY ERROR]', status, data || err.message);

      if (status === 401 || status === 403) {
        await context.sendActivity('No tengo autorización para llamar a la IA. Revisa la API key configurada.');
      } else if (status === 404) {
        await context.sendActivity('No se encontró el servicio de IA. Revisa la URL base configurada.');
      } else {
        await context.sendActivity('Hubo un problema al contactar el motor de IA. Inténtalo otra vez.');
      }
    }
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`[BOOT] Bridge listo en puerto ${PORT}`);
  console.log(`[BOOT] Endpoint: POST /api/messages`);
  if (missing.length) {
    console.warn(`[BOOT] Advertencia: Faltan variables de entorno: ${missing.join(', ')}`);
  }
});
