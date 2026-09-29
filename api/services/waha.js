// ── Envío de mensajes vía WAHA ───────────────────────────────────────────────
// Extraído de wa-agent.js a un archivo compartido para que otras rutas (ej.
// publico.js, para el link del Portal por celular) también puedan mandar
// mensajes sin crear un require circular: wa-agent.js ya hace
// require('./publico') para generarTokenAsistencia, así que publico.js no
// puede hacer require('./wa-agent') de vuelta.
//
// No confundir con routes/waha.js (router de gestión de sesión WAHA — QR
// self-service, vincular/desvincular número — un concern completamente
// distinto que ya tenía su propio wahaHeaders() local).

function wahaHeaders() {
  const apiKey = process.env.WAHA_API_KEY;
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h['X-Api-Key'] = apiKey;
  return h;
}

// Chat por el que escribió cada número en este request (ej. "134479737798743@lid"). Con el
// motor NOWEB, si el mensaje llegó por el @lid y la respuesta sale al @c.us, el celular del
// usuario no refresca la conversación abierta (hay que salir y volver a entrar para verla) —
// verificado 29 sep 2026. Responder por el mismo chat de origen lo evita.
const chatOrigenPorNumero = new Map();
function recordarChatOrigen(numero, chatId) {
  if (!numero || !chatId || !String(chatId).includes('@')) return;
  if (chatOrigenPorNumero.size > 500) chatOrigenPorNumero.clear();
  chatOrigenPorNumero.set(String(numero).replace(/\D/g, ''), chatId);
}

function wahaChatId(to) {
  if (to.includes('@')) return to;
  const numOnly = to.replace(/\D/g, '');
  return chatOrigenPorNumero.get(numOnly)
    || `${numOnly.startsWith('57') ? numOnly : '57' + numOnly}@c.us`;
}

// Marca el mensaje como leído (chulitos azules) y muestra "escribiendo…" mientras el agente
// arma la respuesta — sin esto pasan varios segundos sin ninguna señal y se siente trabado.
// Nunca bloquea ni rompe el flujo: tope de 2.5s y errores ignorados.
async function avisarRecibido(chatId, session) {
  const wahaUrl = process.env.WAHA_URL;
  if (!wahaUrl || !chatId) return;
  const body = JSON.stringify({ chatId, session: session || process.env.WAHA_SESSION || 'default' });
  const llamar = (ruta) => fetch(`${wahaUrl}/api/${ruta}`, { method: 'POST', headers: wahaHeaders(), body, signal: AbortSignal.timeout(2500) }).catch(() => {});
  await Promise.all([llamar('sendSeen'), llamar('startTyping')]);
}

async function sendWAHA(to, text, session) {
  const wahaUrl = process.env.WAHA_URL;
  const sess    = session || process.env.WAHA_SESSION || 'default';
  if (!wahaUrl) { console.error('[waha] WAHA_URL no configurado'); return; }
  // Espaciado humano antes de responder — una ráfaga de respuestas instantáneas (ej. varias
  // decenas de mensajes atrasados llegando de golpe al reconectar) es una señal fuerte de
  // automatización para el antifraude de WhatsApp. 400-1300ms no afecta la experiencia real.
  await new Promise(r => setTimeout(r, 400 + Math.random() * 900));
  const chatId  = wahaChatId(to);
  const headers = wahaHeaders();
  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chatId, text, session: sess }),
  });
  const data = await res.json();
  if (!res.ok) console.error('[waha] sendWAHA error:', res.status, JSON.stringify(data));
  else console.log('[waha] sendWAHA ok:', data.id || 'sent');
  return data;
}

module.exports = { sendWAHA, wahaChatId, wahaHeaders, recordarChatOrigen, avisarRecibido };
