// server.cjs
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ====== Config "en duro" (puedes mover a env vars más adelante) ======
const DIFY_URL = 'http://101.44.8.170/v1/chat-messages';
const DIFY_BEARER = 'app-IfzyJ1rKmtXMc6YMlKWm6mck';

// Id/secret (también “en duro” como pediste; luego pásalos a variables de entorno)
process.env.MicrosoftAppId = process.env.MicrosoftAppId || 'ddfb3278-c7dc-4592-b7cf-e844de19ef47';
process.env.MicrosoftAppPassword = process.env.MicrosoftAppPassword || 'nmY8Q~CEf~Cdz22dhpD7.zb8zW8.JNxaZu1qHamH';

// ====== HTML raíz que quieres servir ======
const ROOT_HTML = `<!DOCTYPE html>
<html>
<head>
    <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width" charset="utf-8" />
    <title>Azure App Service</title>
    <link rel="stylesheet" href="/Content/Styles/bootstrap-3.3.1.min.css" type="text/css" />
    <script src="/Content/Scripts/jquery-3.6.0.min.js"></script>
    <script src="/Content/Scripts/bootstrap-4.6.1.min.js"></script>
    <style type="text/css"> body { padding-top: 60px; } </style>
    <script type="text/javascript">
        appRoot = "/";
        $(document).ajaxError(function (event, jqxhr, settings, thrownError) {
            if (jqxhr.status === 403) { $('#403-error-modal').modal(); }
        });
    </script>
    <script> $.serverOS = "linux"; </script>
</head>
<body>
    <div id="bootstrapCssTest" class="hidden"></div>
    <script type="text/javascript">
        if ($('#bootstrapCssTest').is(':visible') === true) {
            $('<link href="/Content/Styles/bootstrap-3.3.1.min.css" rel="stylesheet" type="text/css" />').appendTo('head');
        }
    </script>
    <nav class="navbar navbar-default navbar-fixed-top navbar-inverse" role="navigation">
        <div class="container">
            <div class="navbar-header">
                <button type="button" class="navbar-toggle" data-toggle="collapse" data-target=".navbar-collapse">
                    <span class="sr-only">Toggle navigation</span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                </button>
                <a class="navbar-brand" href="/" style="padding-top: 12px;color:white !important;">
                  <img src="/Content/Images/AppService.png" style="width: 30px; height: 30px"> Azure App Service
                </a>
            </div>
            <div class="collapse navbar-collapse">
                <ul class="nav navbar-nav">
                    <li><a class="navbar-brand" style="padding-top: 17px" href="/Env">Environment</a></li>
                    <li><a class="navbar-brand" style="padding-top: 17px" href="/webssh/host">SSH</a></li>
                    <li><a class="navbar-brand" style="padding-top: 17px" href="/DebugConsole">Bash</a></li>
                    <li><a class="navbar-brand" style="padding-top: 17px" href="/api/logstream" title="If no log events are being generated the page may not load.">Log stream</a></li>
                    <li><a class="navbar-brand" style="padding-top: 17px" href="/ProcessExplorer">Process explorer</a></li>
                </ul>
            </div>
        </div>
    </nav>
    <div class="modal fade" id="403-error-modal" tabindex="-1" role="dialog" aria-labelledby="errorTitle" aria-hidden="true">
        <div class="modal-dialog"><div class="modal-content">
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">
                  <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                </button>
                <h4 class="modal-title" id="errorTitle">Session expired</h4>
            </div>
            <div class="modal-body">Your session has expired. Please refresh your browser.</div>
            <div class="modal-footer"><button type="button" class="btn btn-default" data-dismiss="modal">Close</button></div>
        </div></div>
    </div>
    <style type="text/css"> .row > div { padding-bottom: 10px; } </style>
    <div class="container">
        <h3>Environment</h3>
        <div class="row"><div class="col-xs-2"><strong>Build</strong></div><div>20250623.5</div></div>
        <div class="row"><div class="col-xs-2"><strong>Site up time</strong></div><div>00.00:09:03</div></div>
        <div class="row"><div class="col-xs-2"><strong>Site folder</strong></div><div>/home</div></div>
        <div class="row"><div class="col-xs-2"><strong>Temp folder</strong></div><div>/tmp/</div></div>
        <h3>REST API <small>(works best when using a JSON viewer extension)</small></h3>
        <ul>
            <li><a href="api/settings">App Settings</a></li>
            <li><a href="api/deployments">Deployments</a></li>
            <li><a href="api/scm/info">Source control info</a></li>
            <li><a href="api/vfs">Files</a></li>
            <li><a href="api/logs/docker">Current Docker logs</a> (<a href="api/logs/docker/zip">Download as zip</a>)</li>
        </ul>
        <h3>Browse Directory</h3>
        <ul>
            <li><a href="deploymentlogs">Deployment Logs</a></li>
            <li><a href="wwwroot">Site wwwroot</a></li>
        </ul>
        <h3>More information about Kudu can be found on the <a href="https://github.com/projectkudu/kudu/wiki">wiki</a>.</h3>
    </div>
</body>
</html>`;

// ====== Helpers ======
function stripDetails(html) {
  if (typeof html !== 'string') return html;
  // elimina cualquier bloque <details ...> ... </details>
  const cleaned = html.replace(/<details[\s\S]*?<\/details>/gi, '').trim();
  return cleaned || html;
}

// ====== Rutas ======
// Raíz: devuelve el HTML que pediste
app.get('/', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(ROOT_HTML);
});

// Health simple (útil para pings internos)
app.get('/health', (_req, res) => res.status(200).send('up'));

// Endpoint del chatbot: hace proxy a Dify y limpia <details>…</details>
app.post('/api/chat', async (req, res) => {
  try {
    // si no vienen datos, usa los “duros” para probar
    const payload = {
      query: req.body?.query ?? 'cuales son los procesos de afiliacion?',
      inputs: req.body?.inputs ?? {},
      response_mode: req.body?.response_mode ?? 'blocking',
      user: req.body?.user ?? 'ms-teams-demo'
    };

    const r = await axios.post(DIFY_URL, payload, {
      headers: {
        'Authorization': `Bearer ${DIFY_BEARER}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // extrae y limpia solo el answer
    const answerRaw = r?.data?.answer ?? '';
    const answer = stripDetails(answerRaw);

    res.status(200).json({ answer });
  } catch (err) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { error: 'proxy_error', message: err?.message || 'unknown error' };
    // intenta limpiar si el error aún trae "answer"
    if (data && typeof data.answer === 'string') {
      data.answer = stripDetails(data.answer);
    }
    res.status(status).json(data);
  }
});

// ====== Start ======
const PORT = process.env.PORT || 3000; // Azure inyecta PORT (p.ej., 8181 u 8080)
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
