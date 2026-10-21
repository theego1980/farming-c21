// Tarea automática diaria (8:00 hs Argentina): marca zonas vencidas y avisa al broker por mail.
// También avisa al broker cuando a una zona le quedan 7 días.
import { sb, plantilla, enviarMail, fechaLarga, esc, adminEmail, siteUrl } from '../lib/comun.mjs';

async function destinatarios() {
  const fijo = adminEmail();
  if (fijo) return fijo.split(',').map(s => s.trim()).filter(Boolean);
  const admins = await sb('/rest/v1/perfiles?rol=eq.admin&select=email');
  return admins.map(a => a.email);
}

async function resumen(asigs) {
  if (!asigs.length) return [];
  const ids = asigs.map(a => a.id).join(',');
  const zonasIds = [...new Set(asigs.map(a => a.zona_id))].join(',');
  const asesIds = [...new Set(asigs.map(a => a.asesor_id))].join(',');
  const [zonas, ases, vis, jor] = await Promise.all([
    sb(`/rest/v1/zonas?id=in.(${zonasIds})&select=id,nombre,barrio`),
    sb(`/rest/v1/perfiles?id=in.(${asesIds})&select=id,nombre,apellido`),
    sb(`/rest/v1/visitas?asignacion_id=in.(${ids})&select=asignacion_id,telefono`),
    sb(`/rest/v1/jornadas?asignacion_id=in.(${ids})&select=asignacion_id,horas`),
  ]);
  return asigs.map(a => {
    const z = zonas.find(x => x.id === a.zona_id) || {};
    const p = ases.find(x => x.id === a.asesor_id) || {};
    const v = vis.filter(x => x.asignacion_id === a.id);
    const j = jor.filter(x => x.asignacion_id === a.id);
    return {
      zona: z.nombre || '—', barrio: z.barrio || '', asesor: `${p.nombre || ''} ${p.apellido || ''}`.trim(),
      vence: a.vence, visitas: v.length, contactos: v.filter(x => x.telefono).length,
      horas: j.reduce((s, x) => s + Number(x.horas || 0), 0), jornadas: j.length,
    };
  });
}

const fila = r => `<tr>
<td style="padding:10px 8px;border-bottom:1px solid #2A2824"><b style="color:#fff">${esc(r.zona)}</b><br><span style="color:#8C877C;font-size:13px">${esc(r.asesor)}</span></td>
<td style="padding:10px 8px;border-bottom:1px solid #2A2824;font-size:13px;color:#BDB8AD">${r.visitas} casas · ${r.contactos} contactos<br>${r.horas} h en ${r.jornadas} jornadas</td></tr>`;

const tabla = rs => `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:10px">${rs.map(fila).join('')}</table>`;

export default async (req) => {
  const ahora = new Date().toISOString();

  // 1) Vencidas: pasar a "vencida"
  await sb(`/rest/v1/asignaciones?estado=eq.activa&vence=lte.${ahora}`, {
    method: 'PATCH', body: { estado: 'vencida' },
  });
  const sinAviso = await sb('/rest/v1/asignaciones?estado=eq.vencida&alerta_enviada=eq.false&select=*');

  // 2) Por vencer (7 días)
  const en7 = new Date(Date.now() + 7 * 864e5).toISOString();
  const proximas = await sb(`/rest/v1/asignaciones?estado=eq.activa&aviso_previo=eq.false&vence=lte.${en7}&select=*`);

  if (!sinAviso.length && !proximas.length) return new Response('Sin novedades');

  const to = await destinatarios();
  const url = siteUrl(req);
  const [rv, rp] = await Promise.all([resumen(sinAviso), resumen(proximas)]);

  let cuerpo = '';
  if (rv.length) cuerpo += `<p><b style="color:#E07A5F">${rv.length === 1 ? 'Venció 1 zona' : `Vencieron ${rv.length} zonas`}</b>. Entrá al panel para renovar el plazo o asignarla a otro asesor.</p>${tabla(rv)}`;
  if (rp.length) cuerpo += `<p style="margin-top:22px"><b style="color:#BEAF87">Vencen en 7 días o menos:</b></p>${tabla(rp)}`;

  await enviarMail({
    to,
    subject: rv.length ? `⚠ ${rv.length === 1 ? 'Venció una zona' : `Vencieron ${rv.length} zonas`} de farming` : 'Zonas de farming por vencer',
    html: plantilla(rv.length ? 'Zonas vencidas' : 'Zonas por vencer', cuerpo, { href: url, texto: 'Ir al panel' }),
    text: [...rv.map(r => `VENCIDA: ${r.zona} (${r.asesor}) — ${r.visitas} casas, ${r.horas} h`),
      ...rp.map(r => `Vence ${fechaLarga(r.vence)}: ${r.zona} (${r.asesor})`)].join('\n') + `\n${url}`,
  });

  if (sinAviso.length) await sb(`/rest/v1/asignaciones?id=in.(${sinAviso.map(a => a.id).join(',')})`, { method: 'PATCH', body: { alerta_enviada: true } });
  if (proximas.length) await sb(`/rest/v1/asignaciones?id=in.(${proximas.map(a => a.id).join(',')})`, { method: 'PATCH', body: { aviso_previo: true } });

  return new Response('OK');
};

export const config = { schedule: '0 11 * * *' };
