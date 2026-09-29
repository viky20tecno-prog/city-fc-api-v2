// Clasificación de mensajes entrantes de WAHA, compatible con los dos motores:
//  - WEBJS (whatsapp-web.js, con navegador): trae el tipo en payload.type o payload._data.type.
//  - NOWEB (Baileys, sin navegador): NO trae tipo en ninguno de los dos; lo que sí trae siempre
//    es hasMedia + media.mimetype. Verificado con mensajes reales el 29 sep 2026.
// Por eso el criterio principal es hasMedia/mimetype y el tipo explícito queda de respaldo.

function tipoExplicito(payload) {
  return payload?.type || payload?._data?.type || '';
}

// Tipo de media: 'image' | 'audio' | 'ptt' | 'video' | 'document' | '' (sin media).
function tipoMedia(payload) {
  const explicito = tipoExplicito(payload);
  if (explicito && !['chat', 'text'].includes(explicito)) return explicito;
  if (!payload?.hasMedia) return '';
  const mime = String(payload?.media?.mimetype || '');
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// Texto "puro": trae cuerpo y no trae archivo. Una foto con descripción NO es texto (en NOWEB la
// descripción llega en body igual que un mensaje de texto — antes se confundía con uno).
function esTexto(payload) {
  return !!payload?.body && !payload?.hasMedia && tipoMedia(payload) === '';
}

// Ni texto ni archivo: avisos internos de WhatsApp (protocolo, llaves de cifrado, reacciones,
// ediciones...). NOWEB los entrega como 'message' sin tipo; no hay nada que contestar.
function esMensajeVacio(payload) {
  return !payload?.body && !payload?.hasMedia && !tipoExplicito(payload);
}

module.exports = { tipoMedia, esTexto, esMensajeVacio };
