const nodemailer = require('nodemailer');

const ZOHO_USER = process.env.ZOHO_SMTP_USER;
const ZOHO_PASS = process.env.ZOHO_SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || `ZenSports <${ZOHO_USER}>`;

const BASE_URL   = 'https://zensports.zenpra.ai';
const WA_SOPORTE = 'https://wa.me/573023903192';

const PRECIOS = {
  free:    '$0/mes',
  starter: '$149.000/mes',
  pro:     '$399.000/mes',
  scale:   '$799.000/mes',
};

function createTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS },
    pool: false,
  });
}

async function sendEmail({ to, subject, html }) {
  if (!ZOHO_USER || !ZOHO_PASS) {
    console.warn('[email] ZOHO_SMTP_USER o ZOHO_SMTP_PASS no configurados — email omitido:', subject);
    return { ok: false, reason: 'no_credentials' };
  }
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error Zoho SMTP:', err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Shell compartido ────────────────────────────────────────────────────────

function shell({ preheader = '', body }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>ZenSports</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
  body{margin:0;padding:0;background:#07080f}
  @media only screen and (max-width:620px){
    .wrap{width:100%!important;padding:0 16px!important}
    .card{padding:28px 22px!important}
    .h1{font-size:22px!important}
    .btn{display:block!important;text-align:center!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#07080f;font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;">

<!-- preheader invisible -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#07080f;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#07080f;">
<tr><td align="center" style="padding:32px 12px 56px;">

  <table class="wrap" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

    <!-- HEADER -->
    <tr>
      <td style="padding:0 0 28px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:linear-gradient(135deg,#E14924 0%,#bf3b1c 100%);border-radius:11px;width:38px;height:38px;text-align:center;vertical-align:middle;font-size:20px;">⚡</td>
            <td style="padding-left:10px;vertical-align:middle;">
              <span style="font-size:17px;font-weight:900;color:#fff;letter-spacing:-0.4px;">ZenSports</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- BODY -->
    ${body}

    <!-- FOOTER -->
    <tr>
      <td style="padding:36px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid rgba(255,255,255,0.06);padding:28px 0 0;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.18);line-height:1.7;">
                ¿Tienes dudas? <a href="${WA_SOPORTE}" style="color:rgba(255,255,255,0.35);text-decoration:underline;">Escríbenos por WhatsApp</a>
              </p>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.1);line-height:1.7;">
                ZenSports · ZENPRA © ${year} · Software de gestión deportiva
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Componentes reutilizables ───────────────────────────────────────────────

function mainCard({ badge, badgeColor = '#E14924', title, body, ctaText, ctaUrl, ctaColor = '#E14924', bgColor = 'rgba(255,255,255,0.03)', borderColor = 'rgba(255,255,255,0.08)' }) {
  return `
<tr>
  <td class="card" style="background:${bgColor};border:1px solid ${borderColor};border-radius:18px;padding:38px 34px;">
    ${badge ? `<p style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:${badgeColor};">${badge}</p>` : ''}
    <h1 class="h1" style="margin:0 0 14px;font-size:26px;font-weight:900;line-height:1.22;color:#fff;letter-spacing:-0.6px;">${title}</h1>
    <p style="margin:0${ctaText ? ' 0 30px' : ''};font-size:15px;color:rgba(255,255,255,0.52);line-height:1.75;">${body}</p>
    ${ctaText ? `<a class="btn" href="${ctaUrl}" style="display:inline-block;background:${ctaColor};color:#fff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;padding:13px 26px;letter-spacing:0.1px;">${ctaText} &rarr;</a>` : ''}
  </td>
</tr>`;
}

function secondaryCard({ title, rows }) {
  const rowsHtml = rows.map(([icon, label, sub]) => `
  <tr>
    <td style="padding:0 0 14px;vertical-align:top;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:top;padding-right:12px;padding-top:1px;">
          <div style="width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);text-align:center;line-height:28px;font-size:13px;">${icon}</div>
        </td>
        <td style="vertical-align:middle;">
          <p style="margin:0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.75);">${label}</p>
          ${sub ? `<p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.3);">${sub}</p>` : ''}
        </td>
      </tr></table>
    </td>
  </tr>`).join('');

  return `
<tr><td style="height:12px;"></td></tr>
<tr>
  <td class="card" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:26px 30px;">
    ${title ? `<p style="margin:0 0 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.22);">${title}</p>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>
  </td>
</tr>`;
}

function spacer(h = 12) {
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</td></tr>`;
}

// ─── Emails ──────────────────────────────────────────────────────────────────

function sendWelcomeClub({ nombre_club, nombre_admin, email, club_slug }) {
  const subject = `¡Bienvenido a ZenSports, ${nombre_club}! Tu panel está listo ⚡`;
  const panelUrl = `${BASE_URL}/login`;

  const html = shell({
    preheader: `Hola ${nombre_admin}, tu club ya está en ZenSports. Tienes 5 días para descubrir todo lo que puede hacer por ${nombre_club}.`,
    body: `
    ${mainCard({
      badge: 'Bienvenido al equipo',
      title: `${nombre_club} ya está en ZenSports 🏆`,
      body: `Hola <strong style="color:rgba(255,255,255,0.85);">${nombre_admin}</strong>, tu panel está listo. Tienes <strong style="color:#E14924;">5 días de prueba gratuita</strong> — sin tarjeta de crédito, sin letra pequeña.`,
      ctaText: 'Abrir mi panel',
      ctaUrl: panelUrl,
    })}
    ${secondaryCard({
      title: 'Empieza hoy mismo',
      rows: [
        ['👥', 'Agrega tus jugadores', 'Importa desde Excel o uno por uno en segundos'],
        ['💬', 'Activa el cobro automático por WhatsApp', 'Los pagos llegan solos — olvídate de perseguir a los padres'],
        ['🔗', 'Comparte tu link de inscripción', `zensports.zenpra.ai/inscripcion/${club_slug}`],
      ],
    })}
    ${spacer(12)}
    <tr>
      <td style="background:rgba(225,73,36,0.06);border:1px solid rgba(225,73,36,0.14);border-radius:12px;padding:18px 24px;">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6;">
          ¿Necesitas ayuda para empezar? <a href="${WA_SOPORTE}" style="color:#E14924;text-decoration:none;font-weight:600;">Escríbenos por WhatsApp</a> — respondemos en minutos.
        </p>
      </td>
    </tr>`,
  });

  return sendEmail({ to: email, subject, html });
}

function sendOnboardingDay3({ nombre_club, nombre_admin, email, club_slug }) {
  const subject = `${nombre_club}: te quedan 2 días de prueba — ¿todo listo?`;
  const panelUrl = `${BASE_URL}/login`;

  const html = shell({
    preheader: `Los clubs que más aprovechan ZenSports tienen sus jugadores cargados y el cobro automático activo en los primeros 3 días.`,
    body: `
    ${mainCard({
      badge: 'Día 3 · 2 días restantes',
      badgeColor: '#F59E0B',
      bgColor: 'rgba(245,158,11,0.04)',
      borderColor: 'rgba(245,158,11,0.15)',
      title: `¿Ya tienes ${nombre_club} al 100%?`,
      body: `Hola <strong style="color:rgba(255,255,255,0.85);">${nombre_admin}</strong>, los clubs que activan el cobro automático en los primeros días recuperan en promedio <strong style="color:#F59E0B;">+40% de pagos puntuales</strong> desde el primer mes.`,
      ctaText: 'Ir a mi panel',
      ctaUrl: panelUrl,
      ctaColor: '#F59E0B',
    })}
    ${secondaryCard({
      title: 'Tu checklist de activación',
      rows: [
        ['✅', 'Jugadores cargados', 'Importa tu lista desde Excel — tarda menos de 2 min'],
        ['✅', 'Mensualidades del mes registradas', 'Define los montos por categoría'],
        ['✅', 'Cobro automático por WhatsApp activado', 'El diferenciador que reduce la mora hasta un 80%'],
        ['✅', 'Portal de padres compartido', `zensports.zenpra.ai/p/${club_slug}`],
      ],
    })}`,
  });

  return sendEmail({ to: email, subject, html });
}

function sendTrialExpiring({ nombre_club, nombre_admin, email, dias_restantes }) {
  const esUltimoDia = dias_restantes === 1;
  const subject = esUltimoDia
    ? `⚡ Último día — ${nombre_club} pierde acceso mañana`
    : `${nombre_club}: tu prueba gratuita vence en ${dias_restantes} días`;

  const html = shell({
    preheader: esUltimoDia
      ? `Activa tu plan hoy y mantén el acceso a todos los datos de ${nombre_club} sin interrupciones.`
      : `Faltan ${dias_restantes} días para que venza tu prueba de ZenSports. Elige tu plan antes de que se acabe.`,
    body: `
    ${mainCard({
      badge: esUltimoDia ? 'Último día ⚠️' : `Vence en ${dias_restantes} días`,
      badgeColor: esUltimoDia ? '#EF4444' : '#F59E0B',
      bgColor: esUltimoDia ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.04)',
      borderColor: esUltimoDia ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.18)',
      title: esUltimoDia
        ? `${nombre_admin}, mañana se acaba el acceso`
        : `Tu prueba de ${nombre_club} vence pronto`,
      body: esUltimoDia
        ? `Si no activas un plan hoy, el acceso a ${nombre_club} queda pausado mañana. Tus datos siguen guardados — solo necesitas elegir un plan para continuar.`
        : `Hola <strong style="color:rgba(255,255,255,0.85);">${nombre_admin}</strong>, te quedan <strong style="color:#F59E0B;">${dias_restantes} días</strong> de prueba gratuita. Activa tu plan ahora y no pierdas el ritmo que llevas.`,
      ctaText: 'Elegir mi plan',
      ctaUrl: `${BASE_URL}/#precios`,
      ctaColor: esUltimoDia ? '#EF4444' : '#E14924',
    })}
    ${secondaryCard({
      title: 'Lo que incluye cualquier plan',
      rows: [
        ['💬', 'Cobro automático por WhatsApp', 'Reduce la mora hasta un 80%'],
        ['👥', 'Gestión completa de jugadores', 'Sin límite de jugadores'],
        ['📊', 'Finanzas y reportes en tiempo real', 'Todo en un solo lugar'],
        ['🎧', 'Soporte directo por WhatsApp', 'Respondemos en minutos'],
      ],
    })}`,
  });

  return sendEmail({ to: email, subject, html });
}

function sendTrialExpired({ nombre_club, nombre_admin, email }) {
  const subject = `Tu prueba de ${nombre_club} ha vencido — tus datos siguen guardados`;

  const html = shell({
    preheader: `No perdiste nada — todos los datos de ${nombre_club} están guardados. Elige un plan para retomar donde lo dejaste.`,
    body: `
    ${mainCard({
      badge: 'Prueba vencida',
      badgeColor: '#EF4444',
      bgColor: 'rgba(239,68,68,0.04)',
      borderColor: 'rgba(239,68,68,0.18)',
      title: `${nombre_admin}, tu prueba ha terminado`,
      body: `El acceso a <strong style="color:rgba(255,255,255,0.8);">${nombre_club}</strong> está pausado, pero <strong style="color:rgba(255,255,255,0.8);">todos tus datos siguen guardados</strong>. Activa un plan y retoma exactamente donde lo dejaste — sin perder nada.`,
      ctaText: 'Activar mi plan ahora',
      ctaUrl: `${BASE_URL}/#precios`,
      ctaColor: '#E14924',
    })}
    ${secondaryCard({
      title: 'Qué pasa si no activas hoy',
      rows: [
        ['🔴', 'El cobro automático por WhatsApp se detiene', 'Los pagos vuelven a ser manuales'],
        ['🔴', 'Los padres no pueden consultar su estado', 'El portal del atleta queda inactivo'],
        ['🔴', 'Sin acceso a reportes ni finanzas', 'Perdés visibilidad del club'],
      ],
    })}
    ${spacer(12)}
    <tr>
      <td style="text-align:center;padding:8px 0;">
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">
          ¿Dudas sobre qué plan elegir? <a href="${WA_SOPORTE}" style="color:#E14924;text-decoration:none;font-weight:600;">Hablemos por WhatsApp</a>
        </p>
      </td>
    </tr>`,
  });

  return sendEmail({ to: email, subject, html });
}

function sendPlanActivated({ nombre_club, nombre_admin, email, plan, precio }) {
  const subject = `Plan ${plan} activado ✓ — ${nombre_club} ya es ZenSports`;

  const html = shell({
    preheader: `Tu plan ${plan} está activo. ${nombre_club} ya tiene acceso completo a todas las herramientas de ZenSports.`,
    body: `
    ${mainCard({
      badge: 'Plan activado ✓',
      badgeColor: '#00D084',
      bgColor: 'rgba(0,208,132,0.04)',
      borderColor: 'rgba(0,208,132,0.18)',
      title: `¡${nombre_club} ya es oficial! 🎉`,
      body: `Hola <strong style="color:rgba(255,255,255,0.85);">${nombre_admin}</strong>, tu plan <strong style="color:#00D084;">${plan}</strong> está activo.${precio ? ` El cobro de <strong style="color:rgba(255,255,255,0.8);">${precio}</strong> se realizará mensualmente.` : ''} Gracias por confiar en ZenSports.`,
      ctaText: 'Ir a mi panel',
      ctaUrl: `${BASE_URL}/login`,
      ctaColor: '#00D084',
    })}
    ${secondaryCard({
      title: 'Ahora tienes acceso a',
      rows: [
        ['⚡', 'Cobro automático por WhatsApp activo', 'Ciclo completo días 27, 1, 4, 7, 8 y 9'],
        ['👥', 'Gestión completa sin límites', 'Jugadores, pagos, finanzas, uniformes'],
        ['📲', 'Portal de padres activo', 'Consulta de mensualidades desde el celular'],
        ['🎧', 'Soporte prioritario', 'Respuesta garantizada en menos de 2 horas'],
      ],
    })}`,
  });

  return sendEmail({ to: email, subject, html });
}

async function sendAdminPasswordReset(email, resetUrl) {
  const subject = 'Restablecer contraseña — ZenSports Admin';
  const html = shell({
    preheader: 'Enlace para restablecer tu contraseña del panel admin de ZenSports',
    body: `
    ${mainCard({
      badge: 'Panel de administración',
      title: 'Restablecer tu contraseña',
      body: `Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva contraseña.<br><br>El enlace expira en <strong style="color:rgba(255,255,255,0.85);">30 minutos</strong>.`,
      ctaText: 'Restablecer contraseña',
      ctaUrl: resetUrl,
    })}
    ${spacer(12)}
    <tr>
      <td style="text-align:center;">
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25);">Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambiará.</p>
      </td>
    </tr>`,
  });
  return sendEmail({ to: email, subject, html });
}

module.exports = {
  sendEmail,
  sendWelcomeClub,
  sendTrialExpiring,
  sendTrialExpired,
  sendPlanActivated,
  sendOnboardingDay3,
  sendAdminPasswordReset,
};
