const restify = require('restify');
const { BotFrameworkAdapter } = require('botbuilder');
const axios = require('axios');

// Configurar el adaptador del bot
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Crear el servidor
const server = restify.createServer();
server.listen(process.env.PORT || 3978, () => {
    console.log(`Servidor escuchando en: ${server.url}`);
});

// Endpoint principal del bot
server.post('/api/messages', async (req, res) => {
    await adapter.processActivity(req, res, async (context) => {
        if (context.activity.type === 'message') {
            try {
                const difyResponse = await axios.post(`${process.env.DIFY_API_BASE}/chat-messages`, {
                    inputs: {},
                    query: context.activity.text,
                    response_mode: "blocking",
                    conversation_id: context.activity.conversation.id,
                    user: "user-" + context.activity.from.id
                }, {
                    headers: {
                        Authorization: `Bearer ${process.env.DIFY_API_KEY}`
                    }
                });

                await context.sendActivity(difyResponse.data.answer);
            } catch (error) {
                console.error("Error comunicando con Dify:", error);
                await context.sendActivity("Hubo un error al procesar tu mensaje. Inténtalo más tarde.");
            }
        }
    });
});
