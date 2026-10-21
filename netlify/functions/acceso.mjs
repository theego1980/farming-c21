// POST /api/acceso — el broker genera una contraseña nueva para un asesor y se la envía por mail
import { sb, exigirAdmin, json, manejar, HttpError, passwordTemporal, siteUrl, plantilla, enviarMail, esc } from '../lib/comun.mjs';

export default manejar(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const admin = await exigirAdmin(req);
  const { asesor_id } = await req.json();
  const perfil = (await sb(`/rest/v1/perfiles?id=eq.${asesor_id}&select=*`))?.[0];
  if (!perfil) throw new HttpError(404, 'No encontré al asesor.');
  if (perfil.rol === 'admin') throw new HttpError(400, 'No se puede resetear la cuenta del broker desde acá.');

  const pass = passwordTemporal();
  await sb(`/auth/v1/admin/users/${perfil.id}`, { method: 'PUT', body: { password: pass } });

  const url = siteUrl(req);
  let mail = { enviado: false, error: null };
  try {
    await enviarMail({
      to: perfil.email,
      subject: 'Tus datos de ingreso — Farming C21 Inmopul',
      html: plantilla('Nuevos datos de ingreso', `
<p>Hola ${esc(perfil.nombre)},</p>
<p>Te generamos una contraseña nueva para entrar a tu panel de farming.</p>
<div style="margin-top:14px;padding:14px 16px;background:#0B0B0C;border:1px solid #2A2824;border-radius:10px">
Usuario: <b>${esc(perfil.email)}</b><br>Contraseña provisoria: <b style="font-family:monospace;font-size:16px">${pass}</b></div>`,
        { href: url, texto: 'Ingresar' }),
      text: `Usuario: ${perfil.email}\nContraseña provisoria: ${pass}\n${url}`,
      replyTo: admin.email,
    });
    mail.enviado = true;
  } catch (e) { mail.error = e.message; }

  return json(200, { ok: true, mail, passTemporal: pass });
});

export const config = { path: '/api/acceso' };
