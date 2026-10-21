// Utilidades compartidas por las funciones del servidor (Netlify Functions)
import nodemailer from 'nodemailer';

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const cfg = () => ({
  url: env('SUPABASE_URL').replace(/\/$/, ''),
  anon: env('SUPABASE_ANON_KEY'),
  service: env('SUPABASE_SERVICE_ROLE_KEY'),
});

export function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

// Llamada a Supabase con la clave de servicio (sólo en el servidor)
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const { url, service } = cfg();
  if (!url || !service) throw new HttpError(500, 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Netlify.');
  const headers = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(url + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || text || r.statusText;
    throw new HttpError(r.status, String(msg));
  }
  return data;
}

// Verifica que quien llama sea el broker (administrador)
export async function exigirAdmin(req) {
  const { url, anon } = cfg();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Sesión no válida.');
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new HttpError(401, 'Sesión vencida. Volvé a ingresar.');
  const user = await r.json();
  const perfiles = await sb(`/rest/v1/perfiles?id=eq.${user.id}&select=*`);
  if (!perfiles?.[0] || perfiles[0].rol !== 'admin') throw new HttpError(403, 'Sólo el broker puede hacer esto.');
  return perfiles[0];
}

export function passwordTemporal() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(bytes, b => abc[b % abc.length]).join('');
  return `C21-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function siteUrl(req) {
  const fromEnv = env('SITE_URL') || env('URL');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try { return new URL(req.url).origin; } catch { return ''; }
}

export const fechaLarga = d => new Date(d).toLocaleDateString('es-AR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
});

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plantilla de mail con la estética Inmopul (negro + dorado)
export function plantilla(titulo, cuerpo, boton) {
  return `<!doctype html><html><body style="margin:0;background:#0B0B0C;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#EDEBE6">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#141415;border:1px solid #2A2824;border-radius:14px" cellspacing="0" cellpadding="0">
<tr><td style="padding:22px 26px;border-bottom:1px solid #2A2824">
<div style="font-size:11px;letter-spacing:3px;color:#BEAF87;font-weight:bold">CENTURY 21 INMOPUL · DEVOTO</div>
<div style="font-size:22px;font-weight:bold;margin-top:6px;color:#FFFFFF">${titulo}</div></td></tr>
<tr><td style="padding:22px 26px;font-size:15px;line-height:1.55;color:#D8D5CE">${cuerpo}
${boton ? `<div style="margin:26px 0 6px"><a href="${boton.href}" style="background:#BEAF87;color:#0B0B0C;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px;display:inline-block">${boton.texto}</a></div>` : ''}
</td></tr>
<tr><td style="padding:16px 26px;border-top:1px solid #2A2824;font-size:12px;color:#8C877C;font-family:Georgia,serif;font-style:italic">Programa de Farming · Diego Pulvirenti, Broker</td></tr>
</table></td></tr></table></body></html>`;
}

// Envío de mail: SMTP (casilla propia) o Resend, según lo que esté configurado
export async function enviarMail({ to, subject, html, text, replyTo }) {
  const from = env('MAIL_FROM') || env('SMTP_USER');
  if (env('SMTP_HOST')) {
    const port = Number(env('SMTP_PORT', '465'));
    const t = nodemailer.createTransport({
      host: env('SMTP_HOST'), port, secure: port === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    });
    await t.sendMail({ from, to, subject, html, text, replyTo: replyTo || env('ADMIN_EMAIL') || undefined });
    return;
  }
  if (env('RESEND_API_KEY')) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [].concat(to), subject, html, text, reply_to: replyTo || env('ADMIN_EMAIL') || undefined }),
    });
    if (!r.ok) throw new Error('Resend: ' + (await r.text()));
    return;
  }
  throw new Error('El envío de mails no está configurado (faltan los datos SMTP en Netlify).');
}

export const adminEmail = () => env('ADMIN_EMAIL');

export function manejar(fn) {
  return async (req, ctx) => {
    try { return await fn(req, ctx); }
    catch (e) {
      console.error(e);
      return json(e.status || 500, { error: e.message || 'Error inesperado' });
    }
  };
}
