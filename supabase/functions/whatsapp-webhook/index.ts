// Deploy: supabase functions deploy whatsapp-webhook --project-ref olcevdnhmexaahymfzii
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID        = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_WHATSAPP_FROM      = Deno.env.get('TWILIO_WHATSAPP_FROM') || 'whatsapp:+14155238886';
const OPENAI_API_KEY            = Deno.env.get('OPENAI_API_KEY')!;
const CLUB_SLUG                 = Deno.env.get('CLUB_ID') || 'city-fc';
const SKIP_TWILIO_VALIDATION    = Deno.env.get('SKIP_TWILIO_VALIDATION') === 'true';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Twilio signature validation ─────────────────────────────────────────────
async function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  if (SKIP_TWILIO_VALIDATION) return true;
  if (!signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let str = url;
  for (const key of sortedKeys) str += key + params[key];

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(str));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return computed === signature;
}

// ─── Twilio REST: enviar mensaje WhatsApp ────────────────────────────────────
async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const creds = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: TWILIO_WHATSAPP_FROM, To: to, Body: body }).toString(),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[twilio] error ${res.status} to=${to}: ${errBody}`);
  } else {
    console.log(`[twilio] mensaje enviado OK a ${to}`);
  }
}

// ─── Descargar imagen de Twilio ───────────────────────────────────────────────
async function downloadTwilioImage(mediaUrl: string): Promise<{ base64: string; buffer: ArrayBuffer }> {
  const creds = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(mediaUrl, { headers: { Authorization: `Basic ${creds}` } });
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return { base64: btoa(String.fromCharCode(...new Uint8Array(buffer))), buffer };
}

// ─── Subir imagen a Supabase Storage ─────────────────────────────────────────
async function uploadComprobante(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  await supabase.storage.createBucket('comprobantes', { public: true }).catch(() => {});
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('comprobantes')
    .upload(filename, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from('comprobantes').getPublicUrl(filename);
  return data.publicUrl;
}

// ─── Validar que el banco sea una entidad financiera real ─────────────────────
const BANCOS_CONOCIDOS = [
  'bancolombia', 'nequi', 'daviplata', 'davivienda', 'bbva', 'scotiabank',
  'colpatria', 'bogotá', 'bogota', 'occidente', 'popular', 'itaú', 'itau',
  'citibank', 'falabella', 'pichincha', 'serfinanza', 'coopcentral',
  'ban100', 'rappipay', 'movii', 'tpaga', 'powwi',
];

function normalizarBanco(raw: string): string {
  if (!raw) return 'No especificado';
  const lower = raw.toLowerCase();
  if (BANCOS_CONOCIDOS.some(b => lower.includes(b))) return raw;
  return 'No especificado';
}

// ─── GPT-4o Vision: extraer datos del comprobante ───────────────────────────
async function extractPaymentFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<{ monto: number; banco: string; referencia: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Eres un asistente que extrae datos de comprobantes de pago bancarios colombianos.
Extrae ÚNICAMENTE estos tres campos:
- monto: valor transferido (número entero en pesos colombianos, sin puntos ni comas, ej: 80000)
- banco: entidad financiera de ORIGEN del pago (quien envió el dinero): Bancolombia, Nequi, Daviplata, Davivienda, BBVA, Scotiabank, etc. NO escribas el nombre del destinatario, beneficiario, club, ni el concepto del pago. Si no identificas claramente el banco de origen, escribe "No especificado".
- referencia: número de transacción, aprobación o referencia visible en el comprobante. Si no hay, escribe cadena vacía.
Responde ÚNICAMENTE con JSON válido sin markdown, sin texto adicional: {"monto":número,"banco":"string","referencia":"string"}`,
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      }],
      max_tokens: 200,
    }),
  });

  const json = await res.json();
  const rawContent = json.choices?.[0]?.message?.content || '{}';
  console.log('[openai] respuesta raw:', rawContent);

  const clean = rawContent.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

  let parsed: { monto?: number; banco?: string; referencia?: string } = {};
  try {
    parsed = JSON.parse(clean);
  } catch (_) {
    console.error('[openai] JSON inválido. content:', rawContent);
    throw new Error('No se pudo leer la respuesta de OpenAI');
  }

  const resultado = {
    monto:      Number(parsed.monto) || 0,
    banco:      normalizarBanco(parsed.banco || ''),
    referencia: parsed.referencia || '',
  };
  console.log('[openai] extraído:', JSON.stringify(resultado));
  return resultado;
}

// ─── Extraer datos de mensaje de texto plano ────────────────────────────────
function extractPaymentFromText(text: string): { monto: number | null; banco: string; referencia: string } {
  const sinConcepto = text.replace(/\b(uniforme|torneo|mensualidad|cuota|pago|pagué|pague)\b/gi, '');
  const montoMatch  = sinConcepto.match(/\b(\d{4,10})\b/);
  const bancoMatch  = text.match(/bancolombia|nequi|daviplata|davivienda|bbva|scotiabank|colpatria|banco\s+bogot[aá]|occidente|ban100|rappipay|movii|tpaga/i);
  const refMatch    = text.match(/ref(?:erencia)?[:\s#]*([A-Z0-9]{6,20})/i);
  return {
    monto:      montoMatch ? parseInt(montoMatch[1]) : null,
    banco:      bancoMatch ? bancoMatch[0]           : 'No especificado',
    referencia: refMatch   ? refMatch[1]             : '',
  };
}

// ─── Detectar concepto desde texto del body ──────────────────────────────────
function detectarConcepto(text: string): 'mensualidad' | 'uniforme' | 'torneo' {
  const lower = text.toLowerCase();
  if (lower.includes('uniforme')) return 'uniforme';
  if (lower.includes('torneo'))   return 'torneo';
  return 'mensualidad';
}

// ─── Actualizar mensualidad más antigua pendiente ────────────────────────────
async function actualizarMensualidad(clubId: string, cedula: string, monto: number) {
  const { data: pendientes, error } = await supabase
    .from('mensualidades')
    .select('*')
    .eq('club_id', clubId)
    .eq('cedula', String(cedula))
    .in('estado', ['PENDIENTE', 'PARCIAL', 'MORA'])
    .order('numero_mes', { ascending: true });

  if (error) { console.error('[mensualidad] select error:', error.message); return null; }
  if (!pendientes?.length) { console.log('[mensualidad] sin pendientes para cedula', cedula); return null; }

  const target      = pendientes[0];
  const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
  const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

  console.log('[mensualidad] actualizando mes:', target.mes, '| pagado:', nuevoPagado, '| estado:', nuevoEstado);

  const { data: updated, error: updateErr } = await supabase
    .from('mensualidades')
    .update({
      valor_pagado:              nuevoPagado,
      saldo_pendiente:           nuevoSaldo,
      estado:                    nuevoEstado,
      fecha_ultima_actualizacion: new Date().toISOString(),
    })
    .eq('id', target.id)
    .select()
    .single();

  if (updateErr) { console.error('[mensualidad] update error:', updateErr.message); return null; }
  console.log('[mensualidad] OK:', updated?.mes, updated?.estado);
  return updated;
}

// ─── Actualizar uniforme pendiente ────────────────────────────────────────────
async function actualizarUniforme(clubId: string, cedula: string, monto: number) {
  const { data: pendientes } = await supabase
    .from('uniformes')
    .select('*')
    .eq('club_id', clubId)
    .eq('cedula', String(cedula))
    .neq('estado', 'AL_DIA');

  if (!pendientes?.length) { console.log('[uniforme] sin pendientes para cedula', cedula); return null; }

  const target      = pendientes[0];
  const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
  const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

  console.log('[uniforme] actualizando | pagado:', nuevoPagado, '| estado:', nuevoEstado);

  const { data: updated } = await supabase
    .from('uniformes')
    .update({
      valor_pagado:              nuevoPagado,
      saldo_pendiente:           nuevoSaldo,
      estado:                    nuevoEstado,
      fecha_ultima_actualizacion: new Date().toISOString(),
    })
    .eq('id', target.id)
    .select()
    .single();

  return updated;
}

// ─── Actualizar torneo pendiente ──────────────────────────────────────────────
async function actualizarTorneo(clubId: string, cedula: string, monto: number) {
  const { data: pendientes } = await supabase
    .from('torneos')
    .select('*')
    .eq('club_id', clubId)
    .eq('cedula', String(cedula))
    .neq('estado', 'AL_DIA');

  if (!pendientes?.length) { console.log('[torneo] sin pendientes para cedula', cedula); return null; }

  const target      = pendientes[0];
  const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
  const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

  console.log('[torneo] actualizando | pagado:', nuevoPagado, '| estado:', nuevoEstado);

  const { data: updated } = await supabase
    .from('torneos')
    .update({
      valor_pagado:              nuevoPagado,
      saldo_pendiente:           nuevoSaldo,
      estado:                    nuevoEstado,
      fecha_ultima_actualizacion: new Date().toISOString(),
    })
    .eq('id', target.id)
    .select()
    .single();

  return updated;
}

// ─── Normalizar número colombiano ─────────────────────────────────────────────
function normalizarCelular(from: string): string {
  return from.replace('whatsapp:', '').replace(/^\+57/, '').replace(/\s/g, '');
}

function twilioOk() {
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
}

// ─── Handler principal ────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rawBody = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v; });

  const twilioSig = req.headers.get('X-Twilio-Signature') || '';
  if (!await validateTwilioSignature(req.url, params, twilioSig)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const from     = params['From'] || '';
  const body     = params['Body'] || '';
  const mediaUrl = params['MediaUrl0'];
  const mimeType = params['MediaContentType0'] || 'image/jpeg';
  const numMedia = parseInt(params['NumMedia'] || '0');
  const celular  = normalizarCelular(from);

  console.log(`[webhook] from=${from} celular=${celular} body="${body}" numMedia=${numMedia} mimeType=${mimeType}`);

  try {
    // ── Buscar club ──────────────────────────────────────────────────────────
    const { data: club } = await supabase.from('clubs').select('*').eq('slug', CLUB_SLUG).single();
    if (!club) {
      console.error('[club] no encontrado:', CLUB_SLUG);
      return twilioOk();
    }

    // ── Buscar jugador por celular ───────────────────────────────────────────
    let player = null;
    const { data: p1 } = await supabase.from('players').select('*').eq('club_id', club.id).eq('celular', celular).single();
    player = p1;

    if (!player) {
      const { data: p2 } = await supabase.from('players').select('*').eq('club_id', club.id).eq('celular', `57${celular}`).single();
      player = p2;
    }

    if (!player) {
      console.log('[player] no encontrado para celular:', celular);
      await sendWhatsAppMessage(from, 'No encontramos un jugador registrado con tu número. Comunícate con el administrador del club.');
      return twilioOk();
    }

    console.log(`[player] encontrado: ${player.nombre} ${player.apellidos} | cedula: ${player.cedula}`);

    // ── Extraer datos del comprobante ────────────────────────────────────────
    let monto: number | null = null;
    let banco = 'No especificado';
    let referencia = '';
    let urlComprobanteStorage = '';
    const tieneImagen = numMedia > 0 && !!mediaUrl;

    // Sin imagen → pedir foto, no intentar procesar texto
    if (!tieneImagen) {
      await sendWhatsAppMessage(from,
        '📸 Para registrar tu pago envía una *foto del comprobante*.\n\n' +
        'Puedes agregar en el mensaje:\n' +
        '• _uniforme_ — si el pago es para uniforme\n' +
        '• _torneo_ — si el pago es para torneo\n' +
        '• Sin texto — se registra como mensualidad',
      );
      return twilioOk();
    }

    try {
      console.log('[image] descargando desde Twilio:', mediaUrl);
      const { base64, buffer } = await downloadTwilioImage(mediaUrl!);
      const extracted          = await extractPaymentFromImage(base64, mimeType);
      monto      = extracted.monto || null;
      banco      = extracted.banco;
      referencia = extracted.referencia;
      try {
        urlComprobanteStorage = await uploadComprobante(buffer, mimeType);
        console.log('[storage] imagen subida:', urlComprobanteStorage);
      } catch (uploadErr) {
        console.error('[storage] upload failed (sin imagen):', uploadErr);
      }
    } catch (err) {
      console.error('[image] error procesando imagen:', err);
      await sendWhatsAppMessage(from,
        '😕 No pude leer el comprobante.\n\n' +
        'Por favor reenvía la imagen con mejor iluminación o en mayor resolución.',
      );
      return twilioOk();
    }

    if (!monto || monto <= 0) {
      console.log('[monto] no identificado en imagen. body:', body);
      await sendWhatsAppMessage(from,
        '🤔 No pude identificar el monto en el comprobante.\n\n' +
        'Intenta reenviar la imagen con mejor resolución o que el valor sea claramente visible.',
      );
      return twilioOk();
    }

    // ── Detectar concepto — si no viene en el body, pedir al jugador ─────────
    const bodyTrim = body.trim().toLowerCase();
    const tieneConcepto = bodyTrim.includes('uniforme') || bodyTrim.includes('torneo') || bodyTrim.includes('mensualidad');

    if (!tieneConcepto) {
      console.log('[concepto] no especificado, pidiendo al jugador');
      await sendWhatsAppMessage(from,
        '¿A qué concepto corresponde este pago?\n\n' +
        'Responde reenviando la imagen con una de estas palabras:\n' +
        '• *mensualidad*\n' +
        '• *uniforme*\n' +
        '• *torneo*',
      );
      return twilioOk();
    }

    const concepto = detectarConcepto(body);
    console.log(`[concepto] detectado: ${concepto}`);

    // ── Registrar pago en tabla pagos (queda pendiente de revisión) ──────────
    const { error: pagoError } = await supabase.from('pagos').insert([{
      club_id:         club.id,
      player_id:       player.id,
      cedula:          player.cedula,
      monto,
      banco,
      referencia,
      concepto,
      url_comprobante: urlComprobanteStorage,
      estado_revision: 'pendiente',
    }]);

    if (pagoError) {
      console.error('[pagos] insert error:', pagoError.message);
      await sendWhatsAppMessage(from, 'Ocurrió un error al registrar el pago. Comunícate con el administrador.');
      return twilioOk();
    }

    console.log('[pagos] guardado como pendiente | monto:', monto, '| concepto:', concepto, '| banco:', banco);

    // ── Enviar acuse de recibo (no confirma el pago, solo que llegó) ─────────
    const nombre        = `${player.nombre || ''} ${player.apellidos || ''}`.trim();
    const conceptoLabel = concepto === 'uniforme' ? 'Uniforme'
      : concepto === 'torneo' ? 'Torneo'
      : 'Mensualidad';

    const acuseRecibo =
      `📋 *Comprobante recibido*\n\n` +
      `Hola ${nombre}, recibimos tu comprobante:\n` +
      `• Concepto: *${conceptoLabel}*\n` +
      `• Monto: *$${monto.toLocaleString('es-CO')}*\n` +
      `• Banco: ${banco}` +
      (referencia ? `\n• Referencia: ${referencia}` : '') +
      '\n\n⏳ _Será validado con el banco y confirmado pronto. ¡Gracias!_';

    await sendWhatsAppMessage(from, acuseRecibo);

  } catch (err) {
    console.error('[webhook] error general:', err);
    try {
      await sendWhatsAppMessage(from, 'Ocurrió un error al procesar tu pago. Por favor intenta de nuevo o comunícate con el administrador.');
    } catch (_) { /* ignore */ }
  }

  return twilioOk();
});
