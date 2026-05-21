const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'ZenSports <noreply@zensports.co>';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY no configurada — email omitido:', subject);
    return { ok: false, reason: 'no_api_key' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[email] Error Resend:', data);
      return { ok: false, error: data };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Error inesperado:', err.message);
    return { ok: false, error: err.message };
  }
}

function sendWelcomeClub({ nombre_club, nombre_admin, email, club_slug }) {
  const subject = `¡Bienvenido a ZenSports, ${nombre_club}! Tu panel está listo.`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:40px;">
        <tr>
          <td style="display:flex;align-items:center;gap:12px;">
            <div style="display:inline-block;width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#E14924,#E14924cc);text-align:center;line-height:40px;font-size:20px;">⚡</div>
            <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#fff;margin-left:10px;">ZenSports</span>
          </td>
        </tr>
      </table>

      <!-- Hero -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#E14924;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Bienvenido al equipo</p>
          <h1 style="font-size:28px;font-weight:900;line-height:1.15;margin:0 0 16px;letter-spacing:-0.5px;">
            ¡${nombre_club} ya está en ZenSports! 🏆
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            Hola ${nombre_admin}, tu panel está listo. Tienes <strong style="color:#E14924;">5 días de prueba gratuita</strong> para explorar todas las funcionalidades.
          </p>
          <a href="https://zensports.vercel.app/login"
             style="display:inline-block;background:linear-gradient(135deg,#E14924,#E14924cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Abrir mi panel →
          </a>
        </td></tr>
      </table>

      <!-- Próximos pasos -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:12px;color:rgba(255,255,255,0.35);font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 20px;">Primeros pasos recomendados</p>
          ${[
            ['1', 'Agrega tus jugadores', 'Importa desde Excel o agrega uno por uno'],
            ['2', 'Configura el cobro automático por WhatsApp', 'Activa el ciclo de cobranza y olvídate de perseguir pagos'],
            ['3', 'Comparte el link de inscripción', 'Nuevos jugadores se registran solos desde el celular'],
          ].map(([n, title, desc]) => `
          <div style="display:flex;gap:14px;margin-bottom:18px;align-items:flex-start;">
            <div style="min-width:28px;height:28px;border-radius:8px;background:rgba(225,73,36,0.12);border:1px solid rgba(225,73,36,0.3);text-align:center;line-height:28px;font-size:12px;font-weight:800;color:#E14924;">${n}</div>
            <div>
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">${title}</p>
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45);">${desc}</p>
            </div>
          </div>`).join('')}
        </td></tr>
      </table>

      <!-- Footer -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;padding-top:16px;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">
            ZenSports · ZENPRA © 2026 · Sistema operativo deportivo para LATAM
          </p>
          <p style="font-size:12px;color:rgba(255,255,255,0.15);margin:8px 0 0;">
            Recibiste este email porque registraste el club "${nombre_club}" en ZenSports.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

function sendTrialExpiring({ nombre_club, nombre_admin, email, dias_restantes }) {
  const subject = `Tu prueba gratuita de ZenSports vence en ${dias_restantes} día${dias_restantes === 1 ? '' : 's'}`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,94,94,0.04);border:1px solid rgba(255,94,94,0.18);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#FF5E5E;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Aviso de vencimiento</p>
          <h1 style="font-size:26px;font-weight:900;line-height:1.2;margin:0 0 16px;">
            Tu prueba de ${nombre_club} vence en <span style="color:#FF5E5E;">${dias_restantes} día${dias_restantes === 1 ? '' : 's'}</span>
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            Hola ${nombre_admin}, para continuar usando ZenSports sin interrupciones activa tu plan antes de que venza tu prueba.
          </p>
          <a href="https://zensports.vercel.app/#precios"
             style="display:inline-block;background:linear-gradient(135deg,#E14924,#E14924cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Ver planes y precios →
          </a>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">ZenSports · ZENPRA © 2026</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

function sendPlanActivated({ nombre_club, nombre_admin, email, plan, precio }) {
  const subject = `Plan ${plan} activado en ZenSports — ${nombre_club}`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,208,132,0.04);border:1px solid rgba(0,208,132,0.2);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#00D084;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Plan activado ✓</p>
          <h1 style="font-size:26px;font-weight:900;line-height:1.2;margin:0 0 16px;">
            Plan <span style="color:#00D084;">${plan}</span> activo para ${nombre_club}
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            Hola ${nombre_admin}, tu plan fue activado exitosamente.${precio ? ` El cobro de <strong style="color:#fff;">${precio}</strong> se realizará mensualmente.` : ''}
          </p>
          <a href="https://zensports.vercel.app/login"
             style="display:inline-block;background:linear-gradient(135deg,#00D084,#00D084cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Ir a mi panel →
          </a>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">ZenSports · ZENPRA © 2026</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

function sendTrialExpired({ nombre_club, nombre_admin, email }) {
  const subject = `Tu prueba de ZenSports venció — activa tu plan para no perder tus datos`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#EF4444;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Prueba vencida</p>
          <h1 style="font-size:26px;font-weight:900;line-height:1.2;margin:0 0 16px;">
            Tu prueba de ${nombre_club} <span style="color:#EF4444;">ha terminado</span>
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 12px;">
            Hola ${nombre_admin}, tus datos siguen guardados pero el acceso está pausado.
          </p>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            Activa un plan hoy y retoma donde lo dejaste sin perder nada.
          </p>
          <a href="https://zensports.vercel.app/#precios"
             style="display:inline-block;background:linear-gradient(135deg,#E14924,#E14924cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Activar mi plan ahora →
          </a>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:24px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:12px;color:rgba(255,255,255,0.35);font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">¿Qué pierdes si no activas?</p>
          ${[
            ['🔴','Tus jugadores y pagos registrados quedan congelados'],
            ['🔴','El cobro automático por WhatsApp deja de funcionar'],
            ['🔴','Los padres no pueden ver el estado de mensualidades'],
          ].map(([icon, text]) => `
          <div style="display:flex;gap:10px;margin-bottom:10px;">
            <span style="font-size:14px;">${icon}</span>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">${text}</p>
          </div>`).join('')}
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">ZenSports · ZENPRA © ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

function sendOnboardingDay3({ nombre_club, nombre_admin, email, club_slug }) {
  const subject = `${nombre_club}: ¿ya tienes tus jugadores en ZenSports?`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#E14924;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Día 3 de tu prueba</p>
          <h1 style="font-size:26px;font-weight:900;line-height:1.2;margin:0 0 16px;">
            Hola ${nombre_admin}, ¿ya tienes todo listo?
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            Los clubes que más aprovechan ZenSports son los que en los primeros 3 días ya tienen sus jugadores cargados y el cobro automático activo.
          </p>
          <a href="https://zensports.vercel.app/login"
             style="display:inline-block;background:linear-gradient(135deg,#E14924,#E14924cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Ir a mi panel →
          </a>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:28px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:12px;color:rgba(255,255,255,0.35);font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Lista de verificación</p>
          ${[
            ['Jugadores cargados (Excel o uno a uno)'],
            ['Mensualidades del mes registradas'],
            ['Cobro automático por WhatsApp activado'],
            ['Link del portal de padres compartido en el grupo'],
          ].map(([ text], i) => `
          <div style="display:flex;gap:12px;margin-bottom:12px;align-items:center;">
            <div style="min-width:22px;height:22px;border-radius:6px;border:1px solid rgba(225,73,36,0.4);background:rgba(225,73,36,0.08);text-align:center;line-height:22px;font-size:11px;font-weight:800;color:rgba(225,73,36,0.7);">${i+1}</div>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);">${text}</p>
          </div>`).join('')}
          <div style="margin-top:16px;padding:12px 16px;background:rgba(0,208,132,0.06);border:1px solid rgba(0,208,132,0.15);border-radius:10px;">
            <p style="margin:0;font-size:13px;color:rgba(0,208,132,0.8);">💡 El portal de padres de <strong>${nombre_club}</strong> es: <a href="https://zensports.vercel.app/p/${club_slug}" style="color:#00D084;">zensports.vercel.app/p/${club_slug}</a></p>
          </div>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">ZenSports · ZENPRA © ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

function sendOnboardingDay7({ nombre_club, nombre_admin, email }) {
  const subject = `¿Cómo va ${nombre_club} en ZenSports? Te quedan 2 días de prueba`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',system-ui,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:13px;color:#E14924;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Día 3 de tu prueba · 2 días restantes</p>
          <h1 style="font-size:26px;font-weight:900;line-height:1.2;margin:0 0 16px;">
            ${nombre_admin}, tu prueba vence en <span style="color:#F59E0B;">2 días</span>
          </h1>
          <p style="font-size:15px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 28px;">
            ¿Todo listo para continuar? Activa tu plan hoy y mantén el control de ${nombre_club} sin interrupciones.
          </p>
          <a href="https://zensports.vercel.app/#precios"
             style="display:inline-block;background:linear-gradient(135deg,#E14924,#E14924cc);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:12px;padding:14px 28px;">
            Ver planes →
          </a>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:28px;margin-bottom:24px;">
        <tr><td>
          <p style="font-size:12px;color:rgba(255,255,255,0.35);font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Lo que incluye cualquier plan</p>
          ${[
            ['Gestión completa de jugadores y mensualidades'],
            ['Cobro automático por WhatsApp (reduce mora -80%)'],
            ['Portal de padres para consultar estado de cuenta'],
            ['Soporte por WhatsApp incluido'],
          ].map(([text]) => `
          <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;">
            <span style="color:#00D084;font-size:14px;line-height:1.4;">✓</span>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);line-height:1.4;">${text}</p>
          </div>`).join('')}
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="text-align:center;">
          <p style="font-size:12px;color:rgba(255,255,255,0.2);margin:0;">ZenSports · ZENPRA © ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({ to: email, subject, html });
}

module.exports = { sendEmail, sendWelcomeClub, sendTrialExpiring, sendTrialExpired, sendPlanActivated, sendOnboardingDay3, sendOnboardingDay7 };
