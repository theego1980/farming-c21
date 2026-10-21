// Tarea automática diaria (8:00 hs Argentina). Hace cuatro cosas:
//  1. Al broker: zonas vencidas y zonas a las que les quedan 7 días.
//  2. Al asesor: aviso cuando le quedan 30 días de su zona.
//  3. Al asesor (con copia al broker): aviso si pasó 7 días sin cargar datos.
//  4. Al asesor: recordatorio de llamar a quienes quieren vender o están en venta con colegas (cada 15 días).
import { sb, plantilla, enviarMail, fechaLarga, esc, adminEmail, siteUrl } from '../lib/comun.mjs';

const DIA = 864e5;
const SEGUIR_CADA = 15;
const INACTIVIDAD = 7;

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
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const dias = d => Math.floor((Date.now() - new Date(d.length === 10 ? d + 'T12:00:00-03:00' : d).getTime()) / DIA);
const usd = n => n != null ? 'USD ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
function tiempo(desde) {
  const d = Math.max(0, dias(desde));
  if (d < 31) return `${d} días`;
  const m = Math.floor(d / 30.44);
  return m < 12 ? `${m} ${m === 1 ? 'mes' : 'meses'}` : `${Math.floor(m / 12)} año(s) y ${m % 12} mes(es)`;
}

async function admins() {
  const fijo = adminEmail();
  if (fijo) return fijo.split(',').map(s => s.trim()).filter(Boolean);
  return (await sb('/rest/v1/perfiles?rol=eq.admin&select=email')).map(a => a.email);
}

async function contexto(asigs) {
  if (!asigs.length) return { zonas: [], perfiles: [], visitas: [], jornadas: [] };
  const ids = inList(asigs.map(a => a.id));
  const [zonas, perfiles, visitas, jornadas] = await Promise.all([
    sb(`/rest/v1/zonas?id=in.${inList(asigs.map(a => a.zona_id))}&select=id,nombre,barrio`),
    sb(`/rest/v1/perfiles?id=in.${inList(asigs.map(a => a.asesor_id))}&select=id,nombre,apellido,email`),
    sbTodo(`/rest/v1/visitas?asignacion_id=in.${ids}&select=asignacion_id,telefono,creado`),
    sbTodo(`/rest/v1/jornadas?asignacion_id=in.${ids}&select=asignacion_id,horas,creado`),
  ]);
  return { zonas, perfiles, visitas, jornadas };
}
function resumen(a, ctx) {
  const z = ctx.zonas.find(x => x.id === a.zona_id) || {};
  const p = ctx.perfiles.find(x => x.id === a.asesor_id) || {};
  const v = ctx.visitas.filter(x => x.asignacion_id === a.id);
  const j = ctx.jornadas.filter(x => x.asignacion_id === a.id);
  const ult = [a.inicio, ...v.map(x => x.creado), ...j.map(x => x.creado)].filter(Boolean).sort().pop();
  return {
    zona: z.nombre || '—', asesor: `${p.nombre || ''} ${p.apellido || ''}`.trim(), nombre: p.nombre || '', email: p.email,
    vence: a.vence, visitas: v.length, contactos: v.filter(x => x.telefono).length,
    horas: j.reduce((s, x) => s + Number(x.horas || 0), 0), jornadas: j.length, ultima: ult,
  };
}
const filaBroker = r => `<tr>
<td style="padding:10px 8px;border-bottom:1px solid #2A2824"><b style="color:#fff">${esc(r.zona)}</b><br><span style="color:#8C877C;font-size:13px">${esc(r.asesor)}</span></td>
<td style="padding:10px 8px;border-bottom:1px solid #2A2824;font-size:13px;color:#BDB8AD">${r.visitas} casas · ${r.contactos} contactos<br>${r.horas} h en ${r.jornadas} jornadas</td></tr>`;
const tabla = rs => `<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:10px">${rs.map(filaBroker).join('')}</table>`;
const caja = html => `<div style="margin:14px 0;padding:14px 16px;background:#0B0B0C;border:1px solid #2A2824;border-radius:10px">${html}</div>`;

// ---------------------------------------------------------------------
async function avisosBroker(url, to) {
  const ahora = new Date().toISOString();
  await sb(`/rest/v1/asignaciones?estado=eq.activa&vence=lte.${ahora}`, { method: 'PATCH', body: { estado: 'vencida' } });
  const vencidas = await sb('/rest/v1/asignaciones?estado=eq.vencida&alerta_enviada=eq.false&select=*');
  const en7 = new Date(Date.now() + 7 * DIA).toISOString();
  const proximas = await sb(`/rest/v1/asignaciones?estado=eq.activa&aviso_previo=eq.false&vence=lte.${en7}&select=*`);
  if (!vencidas.length && !proximas.length) return 'broker: sin novedades';

  const ctx = await contexto([...vencidas, ...proximas]);
  const rv = vencidas.map(a => resumen(a, ctx)), rp = proximas.map(a => resumen(a, ctx));
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
  if (vencidas.length) await sb(`/rest/v1/asignaciones?id=in.${inList(vencidas.map(a => a.id))}`, { method: 'PATCH', body: { alerta_enviada: true } });
  if (proximas.length) await sb(`/rest/v1/asignaciones?id=in.${inList(proximas.map(a => a.id))}`, { method: 'PATCH', body: { aviso_previo: true } });
  return `broker: ${vencidas.length} vencidas, ${proximas.length} por vencer`;
}

// ---------------------------------------------------------------------
async function aviso30(url) {
  const ahora = new Date().toISOString(), en30 = new Date(Date.now() + 30 * DIA).toISOString();
  const asigs = await sb(`/rest/v1/asignaciones?estado=eq.activa&aviso_30=eq.false&vence=lte.${en30}&vence=gt.${ahora}&select=*`);
  if (!asigs.length) return 'aviso 30: nada';
  const ctx = await contexto(asigs);
  let n = 0;
  for (const a of asigs) {
    const r = resumen(a, ctx);
    if (!r.email) continue;
    const quedan = Math.max(1, Math.ceil((new Date(a.vence) - Date.now()) / DIA));
    await enviarMail({
      to: r.email,
      subject: `Te quedan ${quedan} días de tu zona ${r.zona}`,
      html: plantilla(`Te quedan ${quedan} días`, `
<p>Hola ${esc(r.nombre)},</p>
<p>A tu tenencia de la zona <b style="color:#BEAF87">${esc(r.zona)}</b> le quedan <b>${quedan} días</b>: vence el <b>${fechaLarga(a.vence)}</b>.</p>
<p>Todavía estás a tiempo de <b>dar vuelta la racha y mantener tu zona</b>. Al vencer el plazo se evalúan las jornadas, las horas y los contactos que cargaste.</p>
${caja(`<div style="color:#BEAF87;font-size:12px;letter-spacing:2px;font-weight:bold">TU TRABAJO HASTA HOY</div>
<div style="margin-top:6px;font-size:15px">${r.visitas} casas visitadas · ${r.contactos} con teléfono<br>${r.horas} horas en ${r.jornadas} jornadas</div>`)}
<p>¡A salir a la calle!</p>`, { href: url, texto: 'Abrir mi zona' }),
      text: `Hola ${r.nombre}, te quedan ${quedan} días de la zona ${r.zona} (vence el ${fechaLarga(a.vence)}). Llevás ${r.visitas} casas, ${r.contactos} contactos y ${r.horas} h. ${url}`,
    });
    await sb(`/rest/v1/asignaciones?id=eq.${a.id}`, { method: 'PATCH', body: { aviso_30: true } });
    n++;
  }
  return `aviso 30: ${n}`;
}

// ---------------------------------------------------------------------
async function inactividad(url, broker) {
  const ahora = new Date().toISOString();
  const asigs = await sb(`/rest/v1/asignaciones?estado=eq.activa&vence=gt.${ahora}&select=*`);
  if (!asigs.length) return 'inactividad: nada';
  const ctx = await contexto(asigs);
  let n = 0;
  for (const a of asigs) {
    const r = resumen(a, ctx);
    const sin = dias(r.ultima);
    if (sin < INACTIVIDAD || !r.email) continue;
    // un aviso por cada semana sin actividad
    if (a.aviso_inactividad && a.aviso_inactividad > r.ultima && dias(a.aviso_inactividad) < INACTIVIDAD) continue;
    const nuncaCargo = r.visitas === 0 && r.jornadas === 0;
    await enviarMail({
      to: r.email,
      cc: broker.filter(b => b.toLowerCase() !== r.email.toLowerCase()),
      subject: `Tu zona ${r.zona} lleva ${sin} días sin movimiento`,
      html: plantilla('Tu zona te está esperando', `
<p>Hola ${esc(r.nombre)},</p>
<p>${nuncaCargo ? `Desde que se te asignó <b style="color:#BEAF87">${esc(r.zona)}</b> hace ${sin} días todavía no cargaste jornadas ni casas.`
          : `Hace <b>${sin} días</b> que no cargás movimiento en tu zona <b style="color:#BEAF87">${esc(r.zona)}</b>.`}</p>
<p>Recordá registrar cada jornada y cada casa visitada: es lo que se evalúa para que conserves la zona. Vence el <b>${fechaLarga(a.vence)}</b>.</p>`,
        { href: url, texto: 'Cargar mi trabajo' }),
      text: `Hola ${r.nombre}, tu zona ${r.zona} lleva ${sin} días sin movimiento. Vence el ${fechaLarga(a.vence)}. ${url}`,
    });
    await sb(`/rest/v1/asignaciones?id=eq.${a.id}`, { method: 'PATCH', body: { aviso_inactividad: new Date().toISOString() } });
    n++;
  }
  return `inactividad: ${n}`;
}

// ---------------------------------------------------------------------
async function seguimiento(url) {
  const ahora = new Date().toISOString();
  const asigs = await sb(`/rest/v1/asignaciones?estado=eq.activa&vence=gt.${ahora}&select=id,asesor_id,zona_id`);
  if (!asigs.length) return 'seguimiento: nada';
  const filtro = encodeURIComponent('(resultado.eq."Interesado en vender",en_venta_colega.is.true)');
  const vis = await sbTodo(`/rest/v1/visitas?asignacion_id=in.${inList(asigs.map(a => a.id))}&or=${filtro}&select=*`);
  const toca = vis.filter(v => dias([v.fecha, v.ultimo_contacto, v.recordado].filter(Boolean).sort().pop()) >= SEGUIR_CADA);
  if (!toca.length) return 'seguimiento: nada';
  const perfiles = await sb(`/rest/v1/perfiles?id=in.${inList(toca.map(v => v.asesor_id))}&select=id,nombre,email`);
  const porAsesor = new Map();
  toca.forEach(v => { if (!porAsesor.has(v.asesor_id)) porAsesor.set(v.asesor_id, []); porAsesor.get(v.asesor_id).push(v); });
  for (const [aid, vs] of porAsesor) {
    const p = perfiles.find(x => x.id === aid); if (!p) continue;
    const filas = vs.map(v => `<tr><td style="padding:10px 8px;border-bottom:1px solid #2A2824">
<b style="color:#fff">${esc(v.calle)} ${v.altura ?? ''}</b><br>
<span style="font-size:14px">${esc(v.propietario || 'Propietario sin nombre')}${v.telefono ? ` · <a href="tel:${esc(v.telefono)}" style="color:#BEAF87">${esc(v.telefono)}</a>` : ''}</span><br>
<span style="font-size:12px;color:#8C877C">${v.en_venta_colega ? `En venta con ${esc(v.venta_inmobiliaria || 'colega')}${v.venta_valor ? ' · ' + usd(v.venta_valor) : ''}${v.venta_desde ? ` · lleva ${tiempo(v.venta_desde)}` : ''}` : esc(v.resultado)}
 · ${v.ultimo_contacto ? `último contacto hace ${dias(v.ultimo_contacto)} días` : `visitada hace ${dias(v.fecha)} días`}</span></td></tr>`).join('');
    await enviarMail({
      to: p.email,
      subject: `☎ ${vs.length === 1 ? 'Tenés 1 contacto' : `Tenés ${vs.length} contactos`} para llamar`,
      html: plantilla('Contactos para llamar', `
<p>Hola ${esc(p.nombre)},</p>
<p>Estos propietarios quieren vender o tienen su propiedad a la venta con otra inmobiliaria, y pasaron ${SEGUIR_CADA} días o más desde el último contacto:</p>
<table width="100%" cellspacing="0" cellpadding="0">${filas}</table>
<p style="font-size:14px;color:#8C877C;margin-top:14px">Cuando hables con cada uno, tocá <b>✓ Contactado</b> en tu panel. Te lo volvemos a recordar en ${SEGUIR_CADA} días.</p>`,
        { href: url, texto: 'Abrir mi panel' }),
      text: vs.map(v => `${v.calle} ${v.altura ?? ''} — ${v.propietario} ${v.telefono}`).join('\n') + `\n${url}`,
    });
    await sb(`/rest/v1/visitas?id=in.${inList(vs.map(v => v.id))}`, { method: 'PATCH', body: { recordado: hoyAR() } });
  }
  return `seguimiento: ${toca.length} contactos a ${porAsesor.size} asesores`;
}

// ---------------------------------------------------------------------
export default async (req) => {
  const url = siteUrl(req);
  const broker = await admins();
  const log = [];
  for (const [nombre, fn] of [
    ['vencimientos', () => avisosBroker(url, broker)],
    ['aviso30', () => aviso30(url)],
    ['inactividad', () => inactividad(url, broker)],
    ['seguimiento', () => seguimiento(url)],
  ]) {
    try { log.push(await fn()); }
    catch (e) { console.error(nombre, e); log.push(`${nombre}: ERROR ${e.message}`); }
  }
  console.log(log.join(' | '));
  return new Response(log.join('\n'));
};

export const config = { schedule: '0 11 * * *' };
