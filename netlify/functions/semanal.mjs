// Resumen semanal para el broker — todos los lunes a las 8:00 (Argentina)
// La semana que pasó de cada asesor: horas, jornadas, casas, contactos, tasaciones, captaciones, cobertura y alertas.
import { sb, plantilla, enviarMail, esc, adminEmail, siteUrl, fechaLarga } from '../lib/comun.mjs';

const DIA = 864e5;
const SEGUIR_CADA = 15;

async function sbTodo(path) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await sb(`${path}${sep}limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const inList = ids => `(${[...new Set(ids)].join(',')})`;
const dias = d => Math.floor((Date.now() - new Date(d.length === 10 ? d + 'T12:00:00-03:00' : d).getTime()) / DIA);
const n1 = x => Number(x || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });

async function destinatarios() {
  const fijo = adminEmail();
  if (fijo) return fijo.split(',').map(s => s.trim()).filter(Boolean);
  return (await sb('/rest/v1/perfiles?rol=eq.admin&select=email')).map(a => a.email);
}

export async function armarResumen() {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 7 * DIA);
  const desdeISO = desde.toISOString(), desdeDia = new Date(desde.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

  const asigs = await sb('/rest/v1/asignaciones?estado=in.(activa,vencida)&select=*');
  if (!asigs.length) return null;
  const ids = inList(asigs.map(a => a.id));
  const [zonas, perfiles, visitas, jornadas] = await Promise.all([
    sb(`/rest/v1/zonas?id=in.${inList(asigs.map(a => a.zona_id))}&select=id,nombre,cuadras`),
    sb(`/rest/v1/perfiles?id=in.${inList(asigs.map(a => a.asesor_id))}&select=id,nombre,apellido`),
    sbTodo(`/rest/v1/visitas?asignacion_id=in.${ids}&select=asignacion_id,cuadra_id,telefono,resultado,en_venta_colega,etapa,tasacion_fecha,captacion_fecha,fecha,ultimo_contacto,creado`),
    sbTodo(`/rest/v1/jornadas?asignacion_id=in.${ids}&select=asignacion_id,horas,fecha,creado`),
  ]);

  const filas = asigs.map(a => {
    const z = zonas.find(x => x.id === a.zona_id) || {};
    const p = perfiles.find(x => x.id === a.asesor_id) || {};
    const v = visitas.filter(x => x.asignacion_id === a.id);
    const j = jornadas.filter(x => x.asignacion_id === a.id);
    const vs = v.filter(x => x.creado >= desdeISO), js = j.filter(x => x.fecha >= desdeDia);
    const cuadrasZona = new Set((z.cuadras || []).map(q => q.id));
    const hechas = new Set(v.map(x => x.cuadra_id).filter(id => cuadrasZona.has(id))).size;
    const hechasAntes = new Set(v.filter(x => x.creado < desdeISO).map(x => x.cuadra_id).filter(id => cuadrasZona.has(id))).size;
    const tot = cuadrasZona.size;
    const ult = [a.inicio, ...v.map(x => x.creado), ...j.map(x => x.creado)].filter(Boolean).sort().pop();
    const pend = v.filter(x => x.etapa !== 'captacion' && (x.resultado === 'Interesado en vender' || x.en_venta_colega || x.etapa === 'tasacion')
      && dias([x.fecha, x.ultimo_contacto].filter(Boolean).sort().pop()) >= SEGUIR_CADA).length;
    return {
      asesor: `${p.nombre || ''} ${p.apellido || ''}`.trim() || '—', zona: z.nombre || '—', vence: a.vence,
      estado: a.estado === 'vencida' || new Date(a.vence) <= ahora ? 'vencida' : 'activa',
      quedan: Math.ceil((new Date(a.vence) - ahora) / DIA),
      horas: js.reduce((s, x) => s + Number(x.horas || 0), 0), jornadas: js.length, casas: vs.length,
      contactos: vs.filter(x => (x.telefono || '').trim()).length,
      tasaciones: v.filter(x => x.tasacion_fecha && x.tasacion_fecha >= desdeDia).length,
      captaciones: v.filter(x => x.captacion_fecha && x.captacion_fecha >= desdeDia).length,
      cob: tot ? Math.round(100 * hechas / tot) : 0, cobSube: tot ? Math.round(100 * (hechas - hechasAntes) / tot) : 0,
      sinMov: dias(ult), pend,
    };
  }).sort((a, b) => (b.captaciones - a.captaciones) || (b.tasaciones - a.tasaciones) || (b.contactos - a.contactos) || (b.horas - a.horas));

  const T = k => filas.reduce((s, f) => s + f[k], 0);
  const alertas = [];
  filas.forEach(f => {
    if (f.estado === 'vencida') alertas.push(`<b>${esc(f.zona)}</b> (${esc(f.asesor)}) está <b style="color:#E07A5F">vencida</b>: falta tu decisión.`);
    else if (f.quedan <= 30) alertas.push(`A <b>${esc(f.zona)}</b> (${esc(f.asesor)}) le quedan <b>${f.quedan} días</b>.`);
    if (f.estado === 'activa' && f.sinMov >= 7) alertas.push(`${esc(f.asesor)} lleva <b>${f.sinMov} días</b> sin cargar movimiento en ${esc(f.zona)}.`);
    if (f.pend) alertas.push(`${esc(f.asesor)} tiene <b>${f.pend}</b> ${f.pend === 1 ? 'llamado atrasado' : 'llamados atrasados'}.`);
  });

  const celda = (v, gold) => `<td style="padding:8px 6px;border-bottom:1px solid #2A2824;text-align:center;font-size:14px;${gold ? 'color:#BEAF87;font-weight:bold' : 'color:#D8D5CE'}">${v}</td>`;
  const tabla = `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;font-size:13px">
<tr style="color:#8C877C;font-size:11px;letter-spacing:.5px"><td style="padding:6px">ASESOR</td><td align="center">HS</td><td align="center">CASAS</td><td align="center">CONT.</td><td align="center">TAS.</td><td align="center">CAPT.</td><td align="center">COBERT.</td></tr>
${filas.map(f => `<tr><td style="padding:8px 6px;border-bottom:1px solid #2A2824"><b style="color:#fff">${esc(f.asesor)}</b><br><span style="color:#8C877C;font-size:12px">${esc(f.zona)}</span></td>
${celda(n1(f.horas))}${celda(f.casas)}${celda(f.contactos)}${celda(f.tasaciones)}${celda(f.captaciones, true)}${celda(`${f.cob}%${f.cobSube ? `<br><span style="font-size:11px;color:#7FB069">+${f.cobSube}%</span>` : ''}`)}</tr>`).join('')}
</table>`;

  const cuerpo = `
<p>Así trabajó el equipo en los últimos 7 días (del ${fechaLarga(desde)} al ${fechaLarga(ahora)}):</p>
<table width="100%" cellspacing="0" cellpadding="0" style="margin:10px 0"><tr>
${[['Horas', n1(T('horas'))], ['Casas', T('casas')], ['Contactos', T('contactos')], ['Tasaciones', T('tasaciones')], ['Captaciones', T('captaciones')]].map(([t, v], i) =>
    `<td style="padding:10px 4px;text-align:center;background:#0B0B0C;border:1px solid #2A2824"><div style="font-size:20px;font-weight:bold;color:${i === 4 ? '#BEAF87' : '#fff'}">${v}</div><div style="font-size:10px;letter-spacing:1px;color:#8C877C">${t.toUpperCase()}</div></td>`).join('')}
</tr></table>
${tabla}
${alertas.length ? `<p style="margin-top:20px;color:#E9B44C;font-weight:bold">Para tener en cuenta</p><ul style="padding-left:18px;margin:6px 0;color:#D8D5CE">${alertas.map(a => `<li style="margin-bottom:4px">${a}</li>`).join('')}</ul>` : '<p style="margin-top:18px;color:#7FB069">Sin alertas esta semana. 👏</p>'}`;

  return {
    subject: `Resumen semanal de farming · ${T('captaciones')} captaciones, ${T('contactos')} contactos`,
    cuerpo,
    texto: filas.map(f => `${f.asesor} (${f.zona}): ${n1(f.horas)} h, ${f.casas} casas, ${f.contactos} contactos, ${f.tasaciones} tasaciones, ${f.captaciones} captaciones, cobertura ${f.cob}%`).join('\n'),
  };
}

export default async (req) => {
  try {
    const r = await armarResumen();
    if (!r) return new Response('Sin zonas vigentes');
    const url = siteUrl(req);
    await enviarMail({
      to: await destinatarios(),
      subject: r.subject,
      html: plantilla('Resumen semanal', r.cuerpo, { href: url, texto: 'Ver el tablero del equipo' }),
      text: r.texto + `\n${url}`,
    });
    return new Response('Resumen enviado');
  } catch (e) {
    console.error(e);
    return new Response('ERROR ' + e.message, { status: 500 });
  }
};

// Lunes 11:00 UTC = 8:00 Argentina
export const config = { schedule: '0 11 * * 1' };
