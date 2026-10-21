// POST /api/asignar — el broker asigna una zona a un asesor (nuevo o existente) y se le envía el mail
import { sb, exigirAdmin, json, manejar, HttpError, passwordTemporal, siteUrl, plantilla, enviarMail, fechaLarga, esc } from '../lib/comun.mjs';

export default manejar(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  const admin = await exigirAdmin(req);
  const { zona_id, asesor = {} } = await req.json();
  if (!zona_id) throw new HttpError(400, 'Falta la zona.');

  const zona = (await sb(`/rest/v1/zonas?id=eq.${zona_id}&select=id,nombre,cuadras,calles_limite,barrio`))?.[0];
  if (!zona) throw new HttpError(404, 'La zona no existe.');

  // 1) Buscar o crear al asesor
  let perfil = null, passTemporal = null;
  if (asesor.id) {
    perfil = (await sb(`/rest/v1/perfiles?id=eq.${asesor.id}&select=*`))?.[0];
  } else {
    const email = String(asesor.email || '').trim().toLowerCase();
    const nombre = String(asesor.nombre || '').trim();
    const apellido = String(asesor.apellido || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'El correo electrónico no es válido.');
    if (!nombre || !apellido) throw new HttpError(400, 'Completá nombre y apellido.');
    perfil = (await sb(`/rest/v1/perfiles?email=eq.${encodeURIComponent(email)}&select=*`))?.[0];
    if (!perfil) {
      passTemporal = passwordTemporal();
      const user = await sb('/auth/v1/admin/users', {
        method: 'POST',
        body: { email, password: passTemporal, email_confirm: true, user_metadata: { nombre, apellido } },
      });
      perfil = (await sb(`/rest/v1/perfiles?id=eq.${user.id}&select=*`))?.[0];
      if (!perfil) {
        perfil = (await sb('/rest/v1/perfiles', {
          method: 'POST', prefer: 'return=representation',
          body: { id: user.id, email, nombre, apellido, rol: 'asesor' },
        }))[0];
      }
    } else if (!perfil.nombre || !perfil.apellido) {
      perfil = (await sb(`/rest/v1/perfiles?id=eq.${perfil.id}`, {
        method: 'PATCH', prefer: 'return=representation', body: { nombre, apellido },
      }))[0];
    }
  }
  if (!perfil) throw new HttpError(404, 'No encontré al asesor.');

  // 2) Cerrar la asignación vigente (si la había) y crear la nueva por 90 días
  const ahora = new Date();
  await sb(`/rest/v1/asignaciones?zona_id=eq.${zona.id}&estado=in.(activa,vencida)`, {
    method: 'PATCH',
    body: { estado: 'finalizada', finalizada: ahora.toISOString(), motivo_fin: 'reasignada' },
  });
  const vence = new Date(ahora.getTime() + 90 * 864e5);
  const asignacion = (await sb('/rest/v1/asignaciones', {
    method: 'POST', prefer: 'return=representation',
    body: { zona_id: zona.id, asesor_id: perfil.id, inicio: ahora.toISOString(), vence: vence.toISOString() },
  }))[0];

  // 3) Mail al asesor
  const url = siteUrl(req);
  const cuadras = Array.isArray(zona.cuadras) ? zona.cuadras : [];
  const porCalle = new Map();
  for (const c of cuadras) {
    const k = c.calle;
    if (!porCalle.has(k)) porCalle.set(k, { n: 0, perim: false });
    const v = porCalle.get(k); v.n++; v.perim = v.perim || !!c.perimetral;
  }
  const calles = [...porCalle.entries()].sort((a, b) => (b[1].perim - a[1].perim) || a[0].localeCompare(b[0], 'es'));
  const limites = (zona.calles_limite || []).filter(Boolean);

  const cuerpo = `
<p>Hola ${esc(perfil.nombre)},</p>
<p>Se te asignó la zona de farming <b style="color:#BEAF87">${esc(zona.nombre)}</b>${zona.barrio ? ` en <b>${esc(zona.barrio)}</b>` : ''}.</p>
<p>Tenés la tenencia por <b>90 días</b>, hasta el <b>${fechaLarga(vence)}</b>. Registrá cada jornada (día y horas) y cada casa visitada con los datos del propietario. Al vencer el plazo se evalúa tu trabajo para renovar o reasignar la zona.</p>
${limites.length ? `<p style="margin-bottom:4px"><b>Límites:</b> ${limites.map(esc).join(' · ')}</p>` : ''}
${calles.length ? `<p style="margin:14px 0 6px"><b>Calles de tu zona (${cuadras.length} cuadras):</b></p>
<div style="font-size:14px;color:#BDB8AD">${calles.map(([c, v]) => `${esc(c)} <span style="color:#7d786e">(${v.n})</span>${v.perim ? ' <span style="color:#BEAF87">· límite</span>' : ''}`).join('<br>')}</div>` : ''}
${passTemporal ? `<div style="margin-top:20px;padding:14px 16px;background:#0B0B0C;border:1px solid #2A2824;border-radius:10px">
<div style="color:#BEAF87;font-size:12px;letter-spacing:2px;font-weight:bold">TUS DATOS DE INGRESO</div>
<div style="margin-top:6px">Usuario: <b>${esc(perfil.email)}</b><br>Contraseña provisoria: <b style="font-family:monospace;font-size:16px">${passTemporal}</b></div>
<div style="font-size:13px;color:#8C877C;margin-top:6px">Podés cambiarla desde tu panel, en “Mi cuenta”.</div></div>`
    : `<p style="font-size:14px;color:#8C877C">Ingresá con tu usuario y contraseña de siempre.</p>`}`;

  let mail = { enviado: false, error: null };
  try {
    await enviarMail({
      to: perfil.email,
      subject: `Tu zona de farming: ${zona.nombre}`,
      html: plantilla('Nueva zona asignada', cuerpo, { href: url, texto: 'Abrir mi zona' }),
      text: `Hola ${perfil.nombre}, se te asignó la zona ${zona.nombre} hasta el ${fechaLarga(vence)}. Ingresá en ${url}` +
        (passTemporal ? `\nUsuario: ${perfil.email}\nContraseña provisoria: ${passTemporal}` : ''),
      replyTo: admin.email,
    });
    mail.enviado = true;
  } catch (e) {
    mail.error = e.message;
  }

  return json(200, { asignacion, asesor: perfil, mail, passTemporal });
});

export const config = { path: '/api/asignar' };
