/* ======================================================================
   FARMING · C21 Inmopul Devoto — aplicación
   ====================================================================== */
(function () {
  'use strict';
  const DIA = 864e5;
  const COLORES = ['#BEAF87', '#5B8DEF', '#E07A5F', '#81B29A', '#C38FD8', '#F2CC8F', '#4FB0C6', '#E76F9A', '#7FB069', '#B0A8E8', '#E9B44C', '#9AA0A6'];
  const RESULTADOS = ['Interesado en vender', 'No quiere vender', 'Interesado en tasar', 'Contacto con propietario', 'Volver a visitar', 'No atendió', 'Inquilino'];
  const SEGUIR_CADA = 15; // días entre recordatorios de seguimiento
  const CENTRO = [-34.608, -58.48];

  const S = { be: null, yo: null, d: null, vista: 'mapa', filtro: 'todas', barrios: [], callejero: null, callejeroP: null,
    map: null, capas: {}, dibujo: null, zonaAbierta: null, tabZona: 'actividad', asigSel: null, abiertas: new Set(), cuadraAbierta: null, buscar: '', notasAbiertas: new Set() };

  // ---------------- Utilidades ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fecha = d => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '—';
  const fechaL = d => new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  const nombre = p => p ? `${p.nombre} ${p.apellido}`.trim() || p.email : '—';
  const num = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const usd = n => n != null && n !== '' ? 'USD ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  const diasDesde = d => d.length === 10
    ? Math.round((new Date(hoyISO() + 'T12:00:00') - new Date(d + 'T12:00:00')) / DIA)
    : Math.floor((Date.now() - new Date(d).getTime()) / DIA);
  const ETAPAS = [['contacto', 'Contacto'], ['tasacion', 'Tasación'], ['captacion', 'Captación']];
  const etapaDe = v => v.etapa || ((v.propietario || v.telefono) ? 'contacto' : '');
  const enSeguimiento = v => v.etapa !== 'captacion' && (v.resultado === 'Interesado en vender' || !!v.en_venta_colega || v.etapa === 'tasacion');

  // WhatsApp: normaliza el número argentino al formato internacional (549 + área + número)
  function numeroWA(t) {
    let d = String(t || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('54')) { d = d.slice(2); if (d.startsWith('9')) d = d.slice(1); }
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 12 && d.startsWith('11') && d.slice(2, 4) === '15') d = '11' + d.slice(4);       // 11 15 xxxx xxxx
    else if (d.length === 10 && d.startsWith('15')) d = '11' + d.slice(2);                              // 15 xxxx xxxx (CABA)
    else if (d.length === 8) d = '11' + d;                                                              // xxxx xxxx (CABA)
    else if (d.length > 10) { const m = d.match(/^(\d{2,4})15(\d{6,8})$/); if (m && (m[1] + m[2]).length === 10) d = m[1] + m[2]; }
    return d.length === 10 ? '549' + d : null;
  }
  // Ayuda debajo del campo teléfono: muestra cómo queda para WhatsApp
  function telHint(t) {
    if (!String(t || '').trim()) return '';
    const n = numeroWA(t);
    if (!n) return '<span class="mal">⚠ No parece un celular. Escribí característica + número, por ej. 11 6494 9902</span>';
    const loc = n.slice(3), area = loc.startsWith('11') ? '11' : loc.slice(0, loc.length - 7 > 2 ? loc.length - 7 : 3);
    return `<span class="ok">✓ WhatsApp: +54 9 ${area} ${loc.slice(area.length, -4)}-${loc.slice(-4)}</span>`;
  }
  function linkWA(v) {
    const n = numeroWA(v.telefono); if (!n) return null;
    const yo = S.yo ? `${S.yo.nombre} ${S.yo.apellido}`.trim() : '';
    const prop = (v.propietario || '').trim().split(/\s+/)[0];
    const dir = `${v.calle} ${v.altura ?? ''}`.trim();
    let cuerpo;
    if (v.etapa === 'tasacion') cuerpo = `Te escribo para darle seguimiento a la tasación de tu propiedad de ${dir}. ¿Tenés unos minutos para charlar?`;
    else if (v.en_venta_colega) cuerpo = `Te escribo por tu propiedad de ${dir}, que vi que está a la venta. Me gustaría contarte cómo trabajamos en Century 21 para venderla. ¿Te puedo llamar?`;
    else if (v.resultado === 'Interesado en vender') cuerpo = `Te escribo por tu propiedad de ${dir}, como habíamos hablado sobre la posibilidad de venderla. ¿Cuándo te queda cómodo que conversemos?`;
    else if (v.resultado === 'Interesado en tasar') cuerpo = `Te escribo por la tasación de tu propiedad de ${dir}. ¿Qué día te queda cómodo que pase a verla?`;
    else cuerpo = `Pasé por tu propiedad de ${dir} y te dejo mi contacto por cualquier consulta inmobiliaria del barrio.`;
    const txt = `Hola${prop ? ' ' + prop : ''}! Soy ${yo || 'asesor'} de Century 21 Inmopul Devoto. ${cuerpo}`;
    return `https://wa.me/${n}?text=${encodeURIComponent(txt)}`;
  }
  const btnWA = v => { const l = linkWA(v); return l ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${l}"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>WhatsApp</a>` : ''; };
  function tiempoVenta(desde) {
    const d = Math.max(0, diasDesde(desde));
    if (d < 31) return `${d} ${d === 1 ? 'día' : 'días'}`;
    const m = Math.floor((d + 1) / 30.44), r = Math.max(0, Math.round(d - m * 30.44));
    if (m < 12) return `${m} ${m === 1 ? 'mes' : 'meses'}${r >= 5 ? ` y ${r} días` : ''}`;
    const a = Math.floor(m / 12), mm = m % 12;
    return `${a} ${a === 1 ? 'año' : 'años'}${mm ? ` y ${mm} ${mm === 1 ? 'mes' : 'meses'}` : ''}`;
  }
  function proximoContacto(v) {
    const base = [v.fecha, v.ultimo_contacto].filter(Boolean).sort().pop();
    return SEGUIR_CADA - diasDesde(base);
  }

  const pendientes = vs => vs.filter(v => enSeguimiento(v) && proximoContacto(v) <= 0)
    .sort((a, b) => proximoContacto(a) - proximoContacto(b));
  function tituloPestana(n) { document.title = (n ? `(${n}) ` : '') + 'Farming · C21 Inmopul'; }

  const esAdmin = () => !!(S.yo && S.yo.rol === 'admin');
  // Historial de seguimiento: notas del contacto (y de la gestión anterior si fue retomado)
  function notasDe(v) {
    const ids = new Set([v.id]); let p = v.previa_id, g = 0;
    while (p && g++ < 5) { ids.add(p); const pv = S.d.visitas.find(x => x.id === p); p = pv && pv.previa_id; }
    return (S.d.notas || []).filter(n => ids.has(n.visita_id)).sort((a, b) => ((b.fecha || '') + (b.creado || '')).localeCompare((a.fecha || '') + (a.creado || '')));
  }
  function panelNotas(v, editable) {
    const lista = notasDe(v);
    return `<div class="notas">${lista.length ? lista.map(n => `<div class="nota"><span class="nf">${fecha(n.fecha)}</span><div class="nt">${esc(n.texto)}<small>${esc(n.autor_nombre || '')}${n.visita_id !== v.id ? ' · gestión anterior' : ''}${n.pendiente ? ' · por subir' : ''}</small></div>${editable && n.visita_id === v.id && (esAdmin() || n.autor_id === S.yo.id) ? `<button class="x" data-a="delNota" data-id="${n.id}" title="Borrar nota">✕</button>` : ''}</div>`).join('') : '<p class="muted" style="font-size:13px;margin:2px 0 6px">Sin notas todavía.</p>'}
      ${editable ? `<div class="nota-form"><textarea class="i" rows="2" data-nota="${v.id}" placeholder="Ej: Llamé, dice que vende después de marzo"></textarea>
        ${v.propietario || v.telefono ? `<label class="chk"><input type="checkbox" data-hable="${v.id}" checked> Hablé con el propietario (reinicia el recordatorio de llamado)</label>` : ''}
        <button class="btn sm primary" data-a="addNota" data-id="${v.id}">Agregar nota</button></div>` : ''}</div>`;
  }

  // Tarjeta de una casa visitada (la usan el broker y el asesor)
  function tarjetaVisita(v, { calle, puede, extra = '', anterior = false, retomable = false } = {}) {
    const prox = !anterior && enSeguimiento(v) ? proximoContacto(v) : null;
    const editable = !anterior && (puede || esAdmin());
    const nn = notasDe(v).length, abierta = S.notasAbiertas.has(v.id);
    return `<div class="vis ${anterior ? 'anterior' : ''}">${anterior ? '<div class="ant-tag">Gestión anterior · sólo lectura</div>' : ''}
      <div class="h"><b>${esc(calle || v.calle)} ${v.altura ?? 's/n'}</b><span class="muted" style="font-size:12px">${fecha(v.fecha)}</span>${puede ? `<button class="x" data-a="delVisita" data-id="${v.id}" title="Borrar">✕</button>` : ''}</div>
      ${v.propietario || v.telefono ? `<div>${esc(v.propietario)}${v.telefono ? ` · <a href="tel:${esc(v.telefono)}">${esc(v.telefono)}</a>` : ''}</div>` : ''}
      ${v.resultado ? `<div class="r">${esc(v.resultado)}</div>` : ''}
      ${v.en_venta_colega ? `<div class="colega"><div>En venta con <b>${esc(v.venta_inmobiliaria || 'otra inmobiliaria')}</b>${v.venta_valor ? ` · <b>${usd(v.venta_valor)}</b>` : ''}</div>
        ${v.venta_desde ? `<div class="reloj">⏱ Lleva <b>${tiempoVenta(v.venta_desde)}</b> a la venta <span class="muted">(desde ${fechaL(v.venta_desde + 'T12:00:00')})</span></div>` : ''}</div>` : ''}
      ${v.notas ? `<div class="muted" style="font-size:13px">${esc(v.notas)}</div>` : ''}
      ${(v.fotos || []).length ? `<div class="fotos">${v.fotos.map(f => `<img data-foto="${esc(f)}" alt="Foto de la casa">`).join('')}</div>` : ''}
      ${v.previa_id ? '<div class="muted" style="font-size:11px">↻ Retomado de la gestión anterior</div>' : ''}
      ${etapaDe(v) ? `<div class="etapas">${ETAPAS.map(([k, t], i) => { const idx = ETAPAS.findIndex(x => x[0] === etapaDe(v)); const est = i < idx ? 'hecha' : i === idx ? 'actual' : ''; const f = k === 'tasacion' ? v.tasacion_fecha : k === 'captacion' ? v.captacion_fecha : null;
          return `<button class="et ${est}" ${editable ? `data-a="etapa" data-id="${v.id}" data-e="${k}"` : 'disabled'}>${i ? '' : ''}${est ? '●' : '○'} ${t}${f ? `<small>${fecha(f)}</small>` : ''}</button>`; }).join('<span class="et-sep">›</span>')}</div>` : ''}
      ${prox != null ? `<div class="seg ${prox <= 0 ? 'hoy' : ''}"><span>${prox <= 0 ? '☎ Toca llamar' : `☎ Próximo llamado en ${prox} ${prox === 1 ? 'día' : 'días'}`}${v.ultimo_contacto ? ` · últ. contacto ${fecha(v.ultimo_contacto)}` : ''}</span>
        <span class="row" style="gap:6px">${btnWA(v)}${puede ? `<button class="btn sm" data-a="contactado" data-id="${v.id}">✓ Contactado</button>` : ''}</span></div>` : (v.telefono && linkWA(v) ? `<div class="seg"><span></span>${btnWA(v)}</div>` : '')}
      ${v.etapa === 'captacion' ? `<div class="captada">🏆 Captación firmada${v.captacion_fecha ? ' el ' + fechaL(v.captacion_fecha + 'T12:00:00') : ''}</div>` : ''}
      <div class="acc-casa">${editable ? `<button class="btn sm ghost" data-a="editarCasa" data-id="${v.id}">✎ Editar</button>` : ''}<button class="btn sm ghost ${abierta ? 'on' : ''}" data-a="verNotas" data-id="${v.id}">🗒 Seguimiento${nn ? ` (${nn})` : ''}</button>${anterior && retomable ? `<button class="btn sm primary" data-a="retomar" data-id="${v.id}">↻ Retomar contacto</button>` : ''}</div>
      ${abierta ? panelNotas(v, editable) : ''}
      ${extra}</div>`;
  }

  // Fotos: se piden los enlaces después de dibujar la pantalla
  const fotoCache = new Map();
  async function cargarFotos(root = document) {
    const imgs = [...root.querySelectorAll('img[data-foto]')];
    if (!imgs.length) return;
    const faltan = [...new Set(imgs.map(i => i.dataset.foto))].filter(p => !fotoCache.has(p) || fotoCache.get(p).t < Date.now() - 50 * 60e3);
    if (faltan.length) {
      const urls = await S.be.urlsFotos(faltan).catch(() => ({}));
      Object.entries(urls).forEach(([p, u]) => fotoCache.set(p, { u, t: Date.now() }));
    }
    imgs.forEach(i => { const c = fotoCache.get(i.dataset.foto); if (c) i.src = c.u; });
  }
  // Achica la foto antes de subirla (máx. 1280 px, JPG)
  async function comprimir(file) {
    const max = S.be.modo === 'demo' ? 640 : 1280;
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la foto')); i.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', S.be.modo === 'demo' ? 0.6 : 0.75));
  }

  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 3200);
  }
  function modal(html) { $('#modalCard').innerHTML = html; $('#modal').classList.add('open'); }
  function cerrarModal() { $('#modal').classList.remove('open'); }
  function confirmar(titulo, texto, ok = 'Confirmar', peligro) {
    return new Promise(res => {
      modal(`<h3>${esc(titulo)}</h3><p class="muted" style="line-height:1.5">${texto}</p>
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-r="0">Cancelar</button><button class="btn ${peligro ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`);
      $('#modalCard').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; $('#modalCard').onclick = null; cerrarModal(); res(b.dataset.r === '1'); };
    });
  }
  function abrirSheet(html, tall) {
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').scrollTop = 0;
    const s = $('#sheet'); s.classList.add('open'); s.classList.toggle('tall', !!tall); s.setAttribute('aria-hidden', 'false');
    // el gesto/botón "atrás" del celular cierra la hoja en lugar de salir de la app
    if (!S.hojaEnHistorial) { try { history.pushState({ hoja: 1 }, ''); S.hojaEnHistorial = true; } catch { } }
  }
  function cerrarSheet(desdeAtras) {
    $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true');
    S.zonaAbierta = null; limpiarCapa('cuadras'); limpiarCapa('preview');
    if (S.hojaEnHistorial) { S.hojaEnHistorial = false; if (desdeAtras !== true) { try { history.back(); } catch { } } }
  }
  window.addEventListener('popstate', () => {
    if ($('#modal').classList.contains('open')) cerrarModal();
    if (S.hojaEnHistorial) { S.hojaEnHistorial = false; if ($('#sheet').classList.contains('open')) { S.nueva = null; if (S.dibujo) terminarDibujo(true); cerrarSheet(true); } }
  });
  document.addEventListener('DOMContentLoaded', () => { const g = $('.sheet-grip'); if (g) { g.dataset.a = 'cerrarSheet'; g.title = 'Cerrar'; } });
  { const g = document.querySelector('.sheet-grip'); if (g) { g.dataset.a = 'cerrarSheet'; g.title = 'Cerrar'; } }
  async function conCarga(btn, fn) {
    const t = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'; }
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || 'Error', true); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = t; } }
  }

  // ---------------- App instalable y modo sin señal ----------------
  function registrarSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW', e));
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.promptInstalar = e; });
  window.addEventListener('appinstalled', () => { S.promptInstalar = null; toast('¡App instalada!'); document.querySelector('.instalar-card')?.remove(); });
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function sugerirInstalar() {
    let no = false; try { no = localStorage.getItem('farming_no_instalar') === '1'; } catch { }
    return !no && !instalada() && (S.promptInstalar || esIOS() || /android/i.test(navigator.userAgent));
  }
  async function instalar() {
    if (S.promptInstalar) { S.promptInstalar.prompt(); const r = await S.promptInstalar.userChoice.catch(() => null); if (r && r.outcome === 'accepted') S.promptInstalar = null; return; }
    modal(esIOS() ? `<h3>Instalar en iPhone</h3><ol class="pasos"><li>Abrí esta página en <b>Safari</b>.</li><li>Tocá el botón <b>Compartir</b> <span style="font-size:18px">⬆︎</span> (abajo en el centro).</li><li>Elegí <b>“Agregar a inicio”</b> y tocá <b>Agregar</b>.</li></ol><p class="muted" style="font-size:13px">Queda el ícono de C21 Inmopul en tu pantalla de inicio.</p><button class="btn primary block" data-a="cerrarModal">Entendido</button>`
      : `<h3>Instalar la app</h3><ol class="pasos"><li>Abrí esta página en <b>Chrome</b>.</li><li>Tocá el menú <b>⋮</b> (arriba a la derecha).</li><li>Elegí <b>“Instalar aplicación”</b> o <b>“Agregar a la pantalla principal”</b>.</li></ol><p class="muted" style="font-size:13px">En la computadora, el ícono de instalar aparece a la derecha de la barra de direcciones.</p><button class="btn primary block" data-a="cerrarModal">Entendido</button>`);
  }
  async function cambioRed(info = {}) {
    const chip = document.getElementById('netChip');
    const n = S.be.pendientesSubir ? await S.be.pendientesSubir() : 0;
    if (chip) {
      const off = S.be.offline || !navigator.onLine;
      chip.classList.toggle('hidden', !off && !n && !S.be.sincronizando);
      chip.classList.toggle('off', off);
      chip.textContent = off ? `Sin señal${n ? ` · ${n} por subir` : ''}` : S.be.sincronizando ? `Subiendo ${n}…` : n ? `${n} por subir` : '';
    }
    while (S.be.fallidos && S.be.fallidos.length) toast(S.be.fallidos.shift(), true);
    if (info.subidos) {
      toast(`✓ Se subieron ${info.subidos} ${info.subidos === 1 ? 'dato cargado' : 'datos cargados'} sin señal`);
      const ocupado = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (!ocupado && S.yo && S.yo.rol !== 'admin' && S.d) { try { await refrescarAsesor(); } catch { } }
    }
  }

  // ---------------- Lógica de negocio ----------------
  const ahora = () => Date.now();
  function estadoAsig(a) {
    if (!a) return 'libre';
    if (a.estado === 'finalizada') return 'finalizada';
    if (a.estado === 'vencida' || new Date(a.vence).getTime() <= ahora()) return 'vencida';
    return 'activa';
  }
  const vigente = zid => S.d.asignaciones.find(a => a.zona_id === zid && a.estado !== 'finalizada');
  const perfil = id => S.d.perfiles.find(p => p.id === id);
  function restante(a) {
    const ms = new Date(a.vence).getTime() - ahora();
    if (ms <= 0) return { v: 0, u: 'días', txt: 'Vencida', ms };
    if (ms < DIA) return { v: Math.ceil(ms / 3600e3), u: 'horas', txt: `${Math.ceil(ms / 3600e3)} h`, ms };
    // días de calendario: de hoy a la fecha de vencimiento (baja uno cada medianoche)
    const dia = x => { const t = new Date(x); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); };
    const d = Math.max(1, Math.round((dia(a.vence) - dia(ahora())) / DIA));
    return { v: d, u: d === 1 ? 'día' : 'días', txt: `${d} ${d === 1 ? 'día' : 'días'}`, ms };
  }
  function pct(a) { const tot = new Date(a.vence) - new Date(a.inicio); return Math.max(0, Math.min(100, 100 * (new Date(a.vence) - ahora()) / (tot || 1))); }
  function stats(asigIds) {
    const set = new Set(asigIds);
    const v = S.d.visitas.filter(x => set.has(x.asignacion_id));
    const j = S.d.jornadas.filter(x => set.has(x.asignacion_id));
    const fechas = [...v.map(x => x.creado), ...j.map(x => x.creado)].filter(Boolean).sort();
    return {
      visitas: v.length, contactos: v.filter(x => (x.telefono || '').trim()).length,
      horas: j.reduce((s, x) => s + Number(x.horas || 0), 0), jornadas: j.length,
      interesados: v.filter(x => x.resultado === 'Interesado en vender').length,
      tasaciones: v.filter(x => x.tasacion_fecha || x.etapa === 'tasacion').length,
      captaciones: v.filter(x => x.etapa === 'captacion').length,
      cuadras: new Set(v.map(x => x.cuadra_id)),
      ultima: fechas.length ? fechas[fechas.length - 1] : null, v, j,
    };
  }
  // Cobertura: cuadras con al menos una casa cargada / total de cuadras de la zona
  function cobertura(z, a) {
    const tot = (z.cuadras || []).length;
    const ids = new Set((z.cuadras || []).map(q => q.id));
    const hechas = [...stats([a.id]).cuadras].filter(id => ids.has(id)).length;
    return { hechas, tot, pct: tot ? Math.round(100 * hechas / tot) : 0 };
  }
  const barraCob = (c, extra = '') => `<div class="cob"><div class="cob-h"><span>Cobertura de la zona</span><b>${c.pct}%</b></div>
    <div class="bar cobbar"><i style="width:${c.pct}%"></i></div><small>${c.hechas} de ${c.tot} cuadras trabajadas${extra}</small></div>`;
  const embudo = st => `<div class="embudo"><span><b>${st.contactos}</b> contactos</span><span>›</span><span><b>${st.interesados}</b> quieren vender</span><span>›</span><span><b>${st.tasaciones}</b> tasaciones</span><span>›</span><span class="cap"><b>${st.captaciones}</b> captaciones</span></div>`;
  function estadoZona(z) {
    const a = vigente(z.id); const e = estadoAsig(a);
    const pronto = e === 'activa' && restante(a).ms < 10 * DIA;
    return { a, e, pronto };
  }
  const badge = (e, pronto, a) => e === 'activa'
    ? `<span class="badge ${pronto ? 'pronto' : 'activa'}">${pronto ? 'Por vencer' : 'Activa'} · ${restante(a).txt}</span>`
    : e === 'vencida' ? '<span class="badge vencida">⚠ Vencida</span>' : '<span class="badge libre">Libre</span>';
  const vencidas = () => S.d.zonas.filter(z => estadoZona(z).e === 'vencida');

  async function recargar() { S.d = await S.be.cargar(); }

  // ---------------- Arranque ----------------
  async function init() {
    registrarSW();
    try { S.be = await Datos.crearBackend(); }
    catch (e) { $('#app').innerHTML = `<div class="login"><div class="card"><img src="logo.png" alt="Century 21 Inmopul" class="login-logo"><h1 style="font-size:20px">Sin conexión</h1><p class="muted">${esc(e.message)}</p><button class="btn primary block" onclick="location.reload()">Reintentar</button></div></div>`; return; }
    S.be.onCambio = cambioRed;
    S.yo = await S.be.perfil().catch(() => null);
    if (!S.yo) return pantallaLogin();
    await entrar();
  }
  async function entrar() {
    try { await recargar(); } catch (e) { toast('No pude cargar los datos: ' + e.message, true); if (!S.d) S.d = { perfiles: [S.yo], zonas: [], asignaciones: [], visitas: [], jornadas: [] }; }
    if (S.be.sincronizar) S.be.sincronizar();
    if (S.yo.rol === 'admin') { S.vista = 'mapa'; renderAdmin(); } else renderAsesor();
  }

  function pantallaLogin(err) {
    document.body.classList.remove('has-nav');
    tituloPestana(0);
    const demo = S.be.modo === 'demo';
    let html = `<div class="login"><div class="card">
      <img src="logo.png" alt="Century 21 Inmopul" class="login-logo">
      <p class="serif gold" style="margin:6px 0 0;font-size:15px">Programa de Farming · Devoto</p>
      <h1>Ingresar</h1><p class="muted" style="margin:0 0 6px">Zonas de prospección del equipo.</p>`;
    if (demo) {
      const ases = S.be.d.perfiles.filter(p => p.rol !== 'admin');
      html += `<div class="note" style="margin-top:14px"><b>Modo demostración.</b> Todavía no está conectada la base de datos, así que todo se guarda sólo en este navegador. Sirve para probar el funcionamiento.</div>
        <button class="btn primary block" style="margin-top:16px" data-demo="admin">Entrar como Broker</button>
        ${ases.map(p => `<button class="btn block" style="margin-top:8px" data-demo="${p.id}">Entrar como ${esc(nombre(p))}</button>`).join('')}
        ${!ases.length ? '<p class="muted" style="font-size:13px;margin-top:12px">Cuando asignes una zona a un asesor vas a poder entrar como él desde acá.</p>' : ''}`;
    } else {
      html += `<form id="flogin"><label class="f">Correo electrónico</label><input class="i" type="email" name="email" autocomplete="username" required>
        <label class="f">Contraseña</label><input class="i" type="password" name="pass" autocomplete="current-password" required>
        ${err ? `<div class="err">${esc(err)}</div>` : ''}
        <button class="btn primary block" style="margin-top:18px">Ingresar</button></form>
        <p class="muted" style="font-size:12px;margin-top:14px">¿Olvidaste la contraseña? Pedile al broker que te genere una nueva.</p>`;
    }
    html += `</div></div>`;
    $('#app').innerHTML = html;
    $('#app').onclick = async e => {
      const b = e.target.closest('[data-demo]'); if (!b) return;
      S.yo = await S.be.loginComo(b.dataset.demo); await entrar();
    };
    const f = $('#flogin');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const btn = f.querySelector('button');
      await conCarga(btn, async () => {
        try { S.yo = await S.be.login(f.email.value, f.pass.value); await entrar(); }
        catch (er) { pantallaLogin(er.message); }
      });
    };
  }

  function topbar(navHtml) {
    return `<header class="top"><div class="brand"><img src="logo.png" alt="C21 Inmopul" class="brand-logo"><span class="brand-sep"></span><div><b>Farming</b><small>Devoto</small></div>
      ${S.be.modo === 'demo' ? '<span class="chip-demo">DEMO</span>' : ''}<span id="netChip" class="netchip hidden"></span></div>
      ${navHtml || '<div style="margin-left:auto"></div>'}
      <button class="iconbtn" data-a="cuenta" title="Mi cuenta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></button></header>`;
  }

  function modalCuenta() {
    modal(`<h3>Mi cuenta</h3><p class="muted" style="margin:0">${esc(nombre(S.yo))} · ${esc(S.yo.email)}</p>
      ${S.be.modo === 'supabase' ? `<label class="f">Nueva contraseña</label><input class="i" type="password" id="np1" minlength="6">
      <label class="f">Repetila</label><input class="i" type="password" id="np2" minlength="6">
      <button class="btn block" style="margin-top:12px" data-a="cambiarPass">Cambiar contraseña</button>` : ''}
      ${S.be.modo === 'demo' && S.yo.rol === 'admin' ? '<button class="btn danger block" style="margin-top:12px" data-a="reiniciarDemo">Borrar datos de la demostración</button>' : ''}
      ${!instalada() ? `<button class="btn block" style="margin-top:12px" data-a="instalar">📲 Instalar la app en este dispositivo</button>` : ''}
      <div class="row" style="margin-top:16px;justify-content:space-between"><button class="btn ghost" data-a="cerrarModal">Cerrar</button><button class="btn danger" data-a="salir">Cerrar sesión</button></div>`);
  }

  // =====================================================================
  //  PANEL DEL BROKER
  // =====================================================================
  function renderAdmin() {
    document.body.classList.add('has-nav');
    const nv = vencidas().length;
    const actIds = new Set(S.d.asignaciones.filter(a => estadoAsig(a) === 'activa').map(a => a.id));
    const np = pendientes(S.d.visitas.filter(v => actIds.has(v.asignacion_id))).length;
    tituloPestana(nv + np);
    const nav = `<nav class="nav">
      <button class="${S.vista === 'mapa' ? 'on' : ''}" data-v="mapa">Mapa</button>
      <button class="${S.vista === 'zonas' ? 'on' : ''}" data-v="zonas">Zonas${nv ? `<span class="dot">${nv}</span>` : ''}</button>
      <button class="${S.vista === 'oport' ? 'on' : ''}" data-v="oport">Contactos${np ? `<span class="dot warn">${np}</span>` : ''}</button>
      <button class="${S.vista === 'asesores' ? 'on' : ''}" data-v="asesores">Equipo</button></nav>`;
    if (S.vista === 'mapa') {
      if (!S.map || !document.getElementById('map')) {
        $('#app').innerHTML = topbar(nav) + `<main><div class="map-wrap"><div id="map"></div>
          <div class="map-tools" id="mapTools"></div><div class="map-alert" id="mapAlert"></div><div class="map-leyenda" id="mapLeyenda"></div><div id="drawBar"></div></div></main>`;
        crearMapa();
      } else {
        $('header.top').outerHTML = topbar(nav);
      }
      herramientasMapa(); dibujarZonas();
    } else {
      destruirMapa();
      $('#app').innerHTML = topbar(nav) + `<main><div class="wrap" id="vista"></div></main>`;
      S.vista === 'zonas' ? vistaZonas() : S.vista === 'oport' ? vistaOportunidades() : vistaAsesores();
    }
    cambioRed();
  }

  // Mapa base de OpenStreetMap (gratuito, sin clave)
  function capaMapa() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  }

  function destruirMapa() { if (S.map) { S.map.remove(); S.map = null; S.capas = {}; } }
  function limpiarCapa(k) { if (S.capas[k] && S.map) { S.map.removeLayer(S.capas[k]); } delete S.capas[k]; }

  function crearMapa(el = 'map') {
    const map = L.map(el, { zoomControl: false, minZoom: 12, maxZoom: 19 }).setView(CENTRO, 14);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    capaMapa().addTo(map);
    S.map = map; S.capas = {}; dibujarZonas._fit = false;
    cargarBarrios();
    return map;
  }

  async function cargarBarrios() {
    try {
      if (!S.barrios.length) S.barrios = await Geo.loadBarrios();
      if (!S.map) return;
      limpiarCapa('barrios');
      const g = L.layerGroup();
      const all = [];
      for (const b of S.barrios) {
        L.polygon(b.ring, { color: '#8a7a4a', weight: 2.5, dashArray: '6 6', fill: false, interactive: false }).addTo(g);
        L.marker(Geo.centroid(b.ring), { interactive: false, icon: L.divIcon({ className: 'lbl-barrio', html: esc(b.nombre), iconSize: null }) }).addTo(g);
        all.push(...b.ring);
      }
      g.addTo(S.map); S.capas.barrios = g;
      if (all.length && !S.d.zonas.length) S.map.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
    } catch (e) { console.warn(e); toast('No pude cargar los límites de los barrios. El mapa funciona igual.', true); }
  }

  function herramientasMapa() {
    const tools = $('#mapTools'); if (!tools) return;
    if (S.dibujo) { tools.innerHTML = ''; return; }
    tools.innerHTML = `<button class="btn primary" data-a="dibujar">✎ Dibujar zona</button>
      <button class="btn" data-a="porCalles">⌗ Zona por calles</button>`;
    const nv = vencidas();
    $('#mapAlert').innerHTML = nv.length ? `<button class="btn danger" style="background:var(--card)" data-v="zonas">⚠ ${nv.length} vencida${nv.length > 1 ? 's' : ''}</button>` : '';
  }

  function dibujarZonas() {
    if (!S.map) return;
    limpiarCapa('zonas');
    const g = L.layerGroup();
    for (const z of S.d.zonas) {
      const { a, e } = estadoZona(z);
      const ring = z.geometria.coordinates[0].map(c => [c[1], c[0]]);
      const pol = L.polygon(ring, {
        color: e === 'vencida' ? '#E07A5F' : z.color, weight: e === 'vencida' ? 3 : 2,
        fillColor: z.color, fillOpacity: e === 'libre' ? .08 : .22, dashArray: e === 'libre' ? '5 5' : null,
      });
      const as = a ? perfil(a.asesor_id) : null;
      pol.bindTooltip(`${esc(z.nombre)}${as ? ' · ' + esc(as.nombre) : ''}`, { permanent: true, direction: 'center', className: 'lbl-zona' });
      pol.on('click', ev => { if (S.dibujo) return; L.DomEvent.stopPropagation(ev); abrirZona(z.id); });
      pol.addTo(g);
    }
    g.addTo(S.map); S.capas.zonas = g;
    limpiarCapa('oport');
    const vigentes = new Set(S.d.asignaciones.filter(a => a.estado !== 'finalizada').map(a => a.id));
    S.capas.oport = capaOportunidades(S.d.visitas.filter(v => vigentes.has(v.asignacion_id)), S.map, true);
    const ley = document.getElementById('mapLeyenda'); if (ley) ley.innerHTML = leyendaMarcas();
    if (S.d.zonas.length && !dibujarZonas._fit) {
      dibujarZonas._fit = true;
      const pts = S.d.zonas.flatMap(z => z.geometria.coordinates[0].map(c => [c[1], c[0]]));
      S.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    }
  }

  // ---------- Dibujo libre ----------
  function iniciarDibujo() {
    cerrarSheet();
    S.dibujo = { pts: [], markers: [], linea: null, pol: null };
    S.map.doubleClickZoom.disable();
    S.map.getContainer().style.cursor = 'crosshair';
    herramientasMapa(); barraDibujo();
    S.map.on('click', clickDibujo);
  }
  function barraDibujo() {
    const n = S.dibujo ? S.dibujo.pts.length : 0;
    $('#drawBar').innerHTML = S.dibujo ? `<div class="draw-bar"><p>${n < 3 ? `Tocá el mapa para marcar las esquinas de la zona (${n}/3 mínimo)` : 'Podés seguir marcando o arrastrar los puntos. Tocá <b>Listo</b> para terminar.'}</p>
      <button class="btn sm" data-a="deshacer" ${n ? '' : 'disabled'}>↶ Deshacer</button>
      <button class="btn sm ghost" data-a="cancelarDibujo">Cancelar</button>
      <button class="btn sm primary" data-a="terminarDibujo" ${n >= 3 ? '' : 'disabled'}>Listo</button></div>` : '';
  }
  function clickDibujo(ev) { agregarVertice([ev.latlng.lat, ev.latlng.lng]); }
  function agregarVertice(p) {
    const D = S.dibujo;
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: '', html: '<div class="vx"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(S.map);
    const i = D.pts.length; D.pts.push(p); D.markers.push(m);
    m.on('drag', () => { const ll = m.getLatLng(); D.pts[D.markers.indexOf(m)] = [ll.lat, ll.lng]; redibujarTrazo(); });
    redibujarTrazo(); barraDibujo();
  }
  function redibujarTrazo() {
    const D = S.dibujo;
    if (D.linea) S.map.removeLayer(D.linea);
    if (D.pts.length >= 3) D.linea = L.polygon(D.pts, { color: '#BEAF87', weight: 3, fillOpacity: .2 }).addTo(S.map);
    else D.linea = L.polyline(D.pts, { color: '#BEAF87', weight: 3 }).addTo(S.map);
  }
  function terminarDibujo(cancelar) {
    const D = S.dibujo; if (!D) return null;
    D.markers.forEach(m => S.map.removeLayer(m)); if (D.linea) S.map.removeLayer(D.linea);
    S.map.off('click', clickDibujo); S.map.doubleClickZoom.enable(); S.map.getContainer().style.cursor = '';
    const pts = D.pts; S.dibujo = null; barraDibujo(); herramientasMapa();
    return cancelar ? null : pts;
  }

  // ---------- Zona por calles ----------
  function cargarCallejero() {
    if (S.callejero) return Promise.resolve(S.callejero);
    if (!S.callejeroP) S.callejeroP = Geo.loadCallejero().then(c => (S.callejero = c)).catch(e => { S.callejeroP = null; throw e; });
    return S.callejeroP;
  }

  function sheetPorCalles(valores) {
    const vals = valores || ['', '', '', ''];
    abrirSheet(`<div class="sheet-head"><h2>Zona por calles</h2><button class="iconbtn" data-a="cerrarSheet">✕</button></div>
      <p class="muted" style="margin:0 0 12px;line-height:1.5;font-size:14px">Escribí las calles que delimitan la zona <b class="gold">en orden, recorriendo el borde</b> (por ejemplo: Beiró → Segurola → Nogoyá → Bahía Blanca). Mínimo 3.</p>
      <div id="callesIn">${vals.map((v, i) => filaCalle(i, v)).join('')}</div>
      <button class="btn sm ghost" data-a="masCalle">＋ Agregar otra calle</button>
      <div id="callesMsg"></div>
      <button class="btn primary block" style="margin-top:16px" data-a="trazarCalles">Trazar zona</button>
      <datalist id="dlCalles"></datalist>`);
    prepararCallejero();
  }
  function prepararCallejero() {
    const msg = $('#callesMsg'); if (!msg) return;
    clearInterval(S.relojCalles);
    if (!S.callejero) {
      const t0 = Date.now();
      const pinta = () => { const m = $('#callesMsg .note b'); if (m) m.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; };
      msg.innerHTML = '<div class="note" style="margin-top:12px">Descargando las calles de los seis barrios… <b>0 s</b><br><span style="font-size:12px">Sólo la primera vez. Puede tardar hasta un minuto; podés tocar “Trazar zona” igual y espera solo.</span></div>';
      S.relojCalles = setInterval(pinta, 1000);
    }
    cargarCallejero().then(c => {
      clearInterval(S.relojCalles);
      const dl = $('#dlCalles'); if (dl) dl.innerHTML = c.names().map(n => `<option value="${esc(n)}">`).join('');
      const m = $('#callesMsg'); if (m && m.querySelector('.note')) m.innerHTML = `<div class="note" style="margin-top:12px">✓ ${c.names().length} calles listas.</div>`;
    }).catch(e => {
      clearInterval(S.relojCalles);
      const m = $('#callesMsg'); if (m) m.innerHTML = `<div class="err">${esc(e.message)}</div><button class="btn sm" style="margin-top:8px" data-a="reintentarCalles">Reintentar</button>`;
    });
  }
  const filaCalle = (i, v = '') => `<div class="street-in"><span class="n">${i + 1}</span><input class="i" list="dlCalles" placeholder="Calle" value="${esc(v)}" autocomplete="off"></div>`;

  async function trazarCalles(btn) {
    const vals = [...document.querySelectorAll('#callesIn input')].map(i => i.value.trim()).filter(Boolean);
    const msg = $('#callesMsg'); msg.innerHTML = '';
    await conCarga(btn, async () => {
      let c;
      try { c = await cargarCallejero(); }
      catch (e) { msg.innerHTML = `<div class="err">${esc(e.message)}</div><button class="btn sm" style="margin-top:8px" data-a="reintentarCalles">Reintentar</button>`; return; }
      let r;
      try { r = c.zoneFromStreets(vals); } catch (e) { msg.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
      nuevaZona(r.ring, r.calles, vals);
    });
  }

  // ---------- Nueva zona ----------
  async function nuevaZona(ring, callesLimite, valoresCalles) {
    limpiarCapa('preview');
    S.capas.preview = L.polygon(ring, { color: '#BEAF87', weight: 3, fillOpacity: .25 }).addTo(S.map);
    S.map.fitBounds(S.capas.preview.getBounds(), { padding: [60, 60], maxZoom: 17 });
    // Superposición con otras zonas
    const choques = S.d.zonas.filter(z => Geo.overlapArea(ring, z.geometria.coordinates[0].map(c => [c[1], c[0]])) > 600);
    const centro = Geo.centroid(ring);
    const barrio = S.barrios.length ? Geo.barrioDe(centro, S.barrios) : null;
    const usados = new Set(S.d.zonas.map(z => z.color));
    const color = COLORES.find(c => !usados.has(c)) || COLORES[S.d.zonas.length % COLORES.length];
    const sugerido = callesLimite && callesLimite.length ? callesLimite.slice(0, 2).map(s => s.replace(/^(Avenida|Av\.?)\s+/i, '')).join(' / ') : `Zona ${S.d.zonas.length + 1}`;
    S.nueva = { ring, calles_limite: callesLimite || [], barrio, color, cuadras: null, valoresCalles };
    abrirSheet(`<div class="sheet-head"><h2>Nueva zona</h2><button class="iconbtn" data-a="cancelarNueva">✕</button></div>
      ${choques.length ? `<div class="err"><b>Esta zona se superpone con: ${choques.map(z => esc(z.nombre)).join(', ')}.</b><br>Las zonas no pueden superponerse. Ajustá el dibujo o las calles.</div>
        <div class="row" style="margin-top:14px">${valoresCalles ? '<button class="btn" data-a="volverCalles">Cambiar calles</button>' : '<button class="btn" data-a="dibujar">Dibujar de nuevo</button>'}<button class="btn ghost" data-a="cancelarNueva">Cancelar</button></div>` : `
      ${barrio ? `<p class="serif gold" style="margin:-6px 0 8px">${esc(barrio)}</p>` : ''}
      ${callesLimite && callesLimite.length ? `<p class="muted" style="font-size:13px;margin:0 0 6px">Límites: ${callesLimite.map(esc).join(' · ')}</p>` : ''}
      <label class="f">Nombre de la zona</label><input class="i" id="zNombre" value="${esc(sugerido)}">
      <label class="f">Color</label><div class="row" id="zColores">${COLORES.map(c => `<button class="swatch" data-color="${c}" style="width:28px;height:28px;border-radius:8px;border:2px solid ${c === color ? '#fff' : 'transparent'};background:${c};cursor:pointer"></button>`).join('')}</div>
      <div id="zCuadras" class="note" style="margin-top:14px">Calculando calles y cuadras de la zona…</div>
      <div class="row" style="margin-top:16px"><button class="btn ghost" data-a="cancelarNueva">Cancelar</button><button class="btn primary grow" id="btnGuardarZona" data-a="guardarZona" disabled>Guardar y asignar</button></div>`}`);
    if (choques.length) return;
    try {
      const [c, dirs] = await Promise.all([cargarCallejero(), Geo.loadDirecciones(ring)]);
      let cuadras = c.cuadras(ring, dirs);
      if (!S.nueva || S.nueva.ring !== ring) return;
      $('#zCuadras').innerHTML = `<b>${new Set(cuadras.map(q => q.calle)).size} calles · ${cuadras.length} cuadras</b><br><span style="font-size:12px">Buscando la numeración oficial de cada cuadra…</span>`;
      cuadras = await numeracionOficial(cuadras, ring);
      if (!S.nueva || S.nueva.ring !== ring) return;
      S.nueva.cuadras = cuadras;
      const calles = new Set(cuadras.map(q => q.calle));
      const conAltura = cuadras.filter(q => q.desde != null).length;
      const conMano = cuadras.filter(q => q.mano).length;
      $('#zCuadras').innerHTML = `<b>${calles.size} calles · ${cuadras.length} cuadras</b><br><span style="font-size:12px">${conAltura === cuadras.length ? 'Todas con numeración.' : `${conAltura} con numeración. Las demás se ordenan por recorrido y podés fijar la altura después, en la pestaña “Cuadras”.`}${conMano ? ` ${conMano} cuadras del límite quedan con su mano (par o impar).` : ''}</span>${S.motivoNum ? `<div style="font-size:11px;margin-top:6px;opacity:.75">No se pudo consultar la numeración oficial (${esc(S.motivoNum)}).</div>` : ''}`;
      mostrarCuadras(cuadras, []);
      $('#btnGuardarZona').disabled = false;
    } catch (e) {
      $('#zCuadras').outerHTML = `<div class="err">${esc(e.message)}</div><button class="btn sm" style="margin-top:8px" data-a="reintentarCuadras">Reintentar</button>`;
    }
  }

  // Consulta la numeración oficial de la Ciudad (USIG) para cada cuadra.
  // Primero desde el servidor; si no responde, directo desde el navegador.
  async function usigDirecto(puntos) {
    const out = new Array(puntos.length).fill(null); let i = 0, fallos = 0;
    const uno = async ([lat, lon]) => {
      const r = await fetch(`https://ws.usig.buenosaires.gob.ar/geocoder/2.2/reversegeocoding?x=${lon}&y=${lat}`);
      const t = (await r.text()).trim().replace(/^\(/, '').replace(/\);?$/, '');
      const m = String(JSON.parse(t).puerta || '').match(/^(.*?)\s+(\d+)\s*$/);
      return m ? { calle: m[1], altura: Number(m[2]) } : null;
    };
    const w = async () => { while (i < puntos.length) { const k = i++; try { out[k] = await uno(puntos[k]); } catch { fallos++; } } };
    await Promise.all(Array.from({ length: 6 }, w));
    if (fallos === puntos.length) throw new Error('el navegador no pudo conectarse');
    return out;
  }
  async function consultarAlturas(puntos) {
    let res = null, motivo = '';
    try {
      const r = await S.be.alturasOficiales(puntos);
      if (r) { res = r.resultados; if (r.errores && r.errores.length) motivo = 'servidor: ' + r.errores.join(', '); }
    } catch (e) { motivo = 'servidor: ' + e.message; }
    if (S.be.modo === 'supabase' && (!res || !res.some(Boolean))) {
      try { res = await usigDirecto(puntos); } catch (e) { motivo += (motivo ? ' · ' : '') + 'navegador: ' + e.message; }
    }
    return { res: res && res.some(Boolean) ? res : null, motivo };
  }
  async function numeracionOficial(cuadras, ring) {
    const { res, motivo } = await consultarAlturas(cuadras.map(q => Geo.midpoint(q.coords)));
    if (!res) { S.motivoNum = motivo || 'el servicio de la Ciudad no devolvió alturas'; return cuadras; }
    S.motivoNum = '';
    const out = Geo.aplicarAlturasOficiales(cuadras, res).cuadras;
    if (ring) await asignarManos(out, ring);
    return out;
  }
  // Calles del límite: cada zona trabaja sólo la vereda que da hacia adentro (par o impar)
  async function asignarManos(cuadras, ring) {
    const per = cuadras.map(q => ({ q, p: q.perimetral ? Geo.puntoInterior(q.coords, ring) : null })).filter(x => x.p);
    cuadras.forEach(q => { delete q.mano; });
    if (!per.length) return;
    const { res } = await consultarAlturas(per.map(x => x.p));
    if (!res) return;
    per.forEach((x, i) => { const r = res[i]; if (r && r.altura && Geo.mismaCalle(x.q.calle, r.calle)) x.q.mano = r.altura % 2 === 0 ? 'par' : 'impar'; });
  }
  const anilloZona = z => z.geometria.coordinates[0].map(c => [c[1], c[0]]);

  async function guardarZona(btn) {
    const N = S.nueva; if (!N || !N.cuadras) return;
    const nombreZ = $('#zNombre').value.trim();
    if (!nombreZ) return toast('Poné un nombre a la zona', true);
    if (S.d.zonas.some(z => z.nombre.toLowerCase() === nombreZ.toLowerCase())) return toast('Ya existe una zona con ese nombre', true);
    await conCarga(btn, async () => {
      const ring = Geo.closeRing(N.ring);
      const z = await S.be.guardarZona({
        nombre: nombreZ, color: N.color, barrio: N.barrio, calles_limite: N.calles_limite, cuadras: N.cuadras,
        geometria: { type: 'Polygon', coordinates: [ring.map(p => [+p[1].toFixed(7), +p[0].toFixed(7)])] },
      });
      S.nueva = null; limpiarCapa('preview');
      await recargar(); dibujarZonas();
      toast('Zona guardada');
      abrirZona(z.id); sheetAsignar(z.id);
    });
  }

  // ---------- Mostrar cuadras sobre el mapa ----------
  function mostrarCuadras(cuadras, visitas, map = S.map, key = 'cuadras') {
    if (!map) return null;
    if (map === S.map) limpiarCapa(key);
    const cnt = new Map(); visitas.forEach(v => cnt.set(v.cuadra_id, (cnt.get(v.cuadra_id) || 0) + 1));
    const g = L.layerGroup();
    for (const q of cuadras) {
      const n = cnt.get(q.id) || 0;
      const line = L.polyline(q.coords, { color: n ? '#BEAF87' : (q.perimetral ? '#6d675b' : '#9a9385'), weight: n ? 6 : 4, opacity: n ? .95 : .75 });
      line.bindTooltip(`${esc(tituloCuadra(q))}${n ? ` · ${n} visita${n > 1 ? 's' : ''}` : ''}`, { sticky: true });
      line.on('click', () => { if (S.yo.rol !== 'admin') irACuadra(q.id); });
      line.addTo(g);
    }
    g.addTo(map);
    if (map === S.map) S.capas[key] = g;
    return g;
  }
  // Marcas de oportunidades: 🚨 quiere vender · 💰 tasación · 🏆 captación · 🪧 en venta con colega
  // Cartel de venta dibujado (el emoji 🪧 es blanco y no se puede pintar)
  const CARTEL = '<svg class="cartel" viewBox="0 0 24 24" aria-hidden="true"><rect x="11" y="13" width="2.4" height="10" rx="1" fill="#5a3b1e"/><rect x="2" y="2.5" width="20" height="12" rx="2" fill="#E8590C" stroke="#7a2e06" stroke-width="1.2"/><text x="12" y="11.3" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="6.6" fill="#FFE8A3">VENTA</text></svg>';
  const MARCAS = { cap: ['🏆', '#BEAF87', 'Captación'], tas: ['💰', '#E9B44C', 'Tasación hecha'], col: [CARTEL, '#5B8DEF', 'En venta con colega'], ven: ['🚨', '#E0524A', 'Quiere vender'] };
  const tipoOport = v => v.etapa === 'captacion' ? 'cap' : v.etapa === 'tasacion' ? 'tas' : v.en_venta_colega ? 'col' : v.resultado === 'Interesado en vender' ? 'ven' : null;
  const leyendaMarcas = () => `<div class="leyenda">${Object.values(MARCAS).reverse().map(([e, c, t]) => `<span><i style="--c:${c}">${e}</i>${t}</span>`).join('')}</div>`;
  function capaOportunidades(visitas, map, conAsesor) {
    const cuadraDe = new Map();
    for (const a of S.d.asignaciones) { const z = S.d.zonas.find(x => x.id === a.zona_id); if (z) (z.cuadras || []).forEach(q => cuadraDe.set(a.id + '|' + q.id, { q, z })); }
    const grupos = new Map();
    for (const v of visitas) { if (!tipoOport(v)) continue; const k = v.asignacion_id + '|' + v.cuadra_id; if (!cuadraDe.has(k)) continue; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(v); }
    const g = L.layerGroup();
    for (const [k, vs] of grupos) {
      const { q, z } = cuadraDe.get(k);
      vs.sort((a, b) => (a.altura || 0) - (b.altura || 0));
      vs.forEach((v, i) => {
        const [emoji, color, txt] = MARCAS[tipoOport(v)];
        const p = Geo.puntoEnCuadra(q.coords, (i + 1) / (vs.length + 1));
        const html = `<div class="pop"><div class="pop-t" style="color:${color}">${emoji} ${txt}</div><b>${esc(v.calle)} ${v.altura ?? ''}</b>
          ${v.propietario || v.telefono ? `<div>${esc(v.propietario)}${v.telefono ? ` · <a href="tel:${esc(v.telefono)}">${esc(v.telefono)}</a>` : ''}</div>` : ''}
          ${v.en_venta_colega ? `<div class="muted">Con ${esc(v.venta_inmobiliaria || 'colega')}${v.venta_valor ? ' · ' + usd(v.venta_valor) : ''}${v.venta_desde ? ' · lleva ' + tiempoVenta(v.venta_desde) : ''}</div>` : ''}
          ${conAsesor ? `<div class="muted">${esc(z.nombre)} · ${esc(nombre(perfil(v.asesor_id)))}</div>` : ''}
          ${btnWA(v) ? `<div style="margin-top:6px">${btnWA(v)}</div>` : ''}</div>`;
        L.marker(p, { icon: L.divIcon({ className: 'pin-op', html: `<div class="pin" style="--c:${color}"><span>${emoji}</span></div>`, iconSize: [34, 40], iconAnchor: [17, 38], popupAnchor: [0, -34] }), zIndexOffset: tipoOport(v) === 'cap' ? 300 : 0 })
          .bindPopup(html, { maxWidth: 260 }).addTo(g);
      });
    }
    g.addTo(map);
    return g;
  }

  const tituloCuadra = q => q.desde != null ? `${q.calle} ${q.desde}–${q.hasta}${q.aprox ? ' (aprox.)' : ''}` : `${q.calle} · cuadra ${q.orden}`;
  const entreTxt = q => { const e = (q.entre || []).filter(Boolean); return e.length === 2 ? `entre ${e[0]} y ${e[1]}` : e.length ? `desde ${e[0]}` : ''; };

  // ---------- Hoja de zona (broker) ----------
  function abrirZona(id) {
    S.zonaAbierta = id;
    const z = S.d.zonas.find(x => x.id === id); if (!z) return cerrarSheet();
    const { a, e, pronto } = estadoZona(z);
    const as = a ? perfil(a.asesor_id) : null;
    const st = a ? stats([a.id]) : null;
    const r = a ? restante(a) : null;
    let html = `<div class="sheet-head"><span class="swatch" style="background:${z.color};margin-top:6px"></span><h2>${esc(z.nombre)}${z.barrio ? `<br><small class="serif gold" style="font-weight:400;font-size:14px">${esc(z.barrio)}</small>` : ''}</h2><button class="iconbtn" data-a="cerrarSheet">✕</button></div>
      <div class="row">${badge(e, pronto, a)}${a && a.renovaciones ? `<span class="badge">Renovada ${a.renovaciones}×</span>` : ''}</div>`;
    if (a) {
      html += `<div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="muted" style="font-size:12px;font-weight:600">ASESOR</div><b style="font-size:16px">${esc(nombre(as))}</b><div class="muted" style="font-size:13px">${esc(as?.email || '')}</div></div>
        <div style="text-align:right"><div class="count" style="justify-content:flex-end"><b style="font-size:34px;color:${e === 'vencida' ? 'var(--bad)' : pronto ? 'var(--warn)' : 'var(--gold)'}">${e === 'vencida' ? '0' : r.v}</b><span>${e === 'vencida' ? 'días' : r.u}</span></div>
        <div class="muted" style="font-size:12px">${e === 'vencida' ? 'venció el' : 'vence el'} ${fechaL(a.vence)}</div></div></div>
        <div class="bar ${e === 'vencida' ? 'bad' : pronto ? 'warn' : ''}"><i style="width:${pct(a)}%"></i></div></div>
        <div class="stats" style="margin-top:10px">
          <div class="stat"><b>${st.visitas}</b><span>CASAS</span></div><div class="stat"><b>${st.contactos}</b><span>CON TELÉFONO</span></div>
          <div class="stat"><b>${num(st.horas)}</b><span>HORAS</span></div><div class="stat"><b>${st.jornadas}</b><span>JORNADAS</span></div></div>
        ${barraCob(cobertura(z, a))}${embudo(st)}
        <p class="muted" style="font-size:12px;margin:8px 0 0">Última actividad: ${st.ultima ? fechaL(st.ultima) : 'sin movimiento todavía'} · Asignada el ${fechaL(a.inicio)}</p>`;
      if (e === 'vencida') {
        html += `<div class="decision"><h3>Venció el plazo de 90 días</h3><p class="muted" style="margin:0 0 12px;font-size:14px">Evaluá el trabajo de ${esc(as?.nombre || 'el asesor')} y decidí qué hacer con la zona.</p>
          <div class="grid2"><button class="btn primary" data-a="renovar">Renovar 90 días</button><button class="btn" data-a="asignar">Asignar a otro</button></div>
          <button class="btn ghost block sm" style="margin-top:8px" data-a="liberar">Dejar la zona libre</button></div>`;
      } else {
        html += `<div class="row" style="margin-top:12px"><button class="btn sm" data-a="renovar">Renovar 90 días</button><button class="btn sm" data-a="asignar">Reasignar</button><button class="btn sm ghost" data-a="liberar">Liberar</button>
          ${S.be.modo === 'demo' ? '<button class="btn sm ghost" data-a="simVencer" title="Sólo demo">⏱ Simular vencimiento</button>' : ''}</div>`;
      }
    } else {
      html += `<div class="card" style="margin-top:12px;text-align:center"><p class="muted" style="margin:0 0 12px">Esta zona no tiene asesor asignado.</p><button class="btn primary" data-a="asignar">Asignar a un asesor</button></div>`;
    }
    html += `<div class="tabs"><button class="${S.tabZona === 'actividad' ? 'on' : ''}" data-tab="actividad">Actividad</button><button class="${S.tabZona === 'cuadras' ? 'on' : ''}" data-tab="cuadras">Cuadras</button><button class="${S.tabZona === 'historial' ? 'on' : ''}" data-tab="historial">Historial</button></div><div id="tabZona"></div>
      <button class="btn danger block sm" style="margin-top:24px" data-a="borrarZona">Eliminar zona</button>`;
    abrirSheet(html, true);
    renderTabZona(z, a);
    if (S.map) {
      mostrarCuadras(z.cuadras || [], a ? stats([a.id]).v : []);
      const ring = z.geometria.coordinates[0].map(c => [c[1], c[0]]);
      const b = L.latLngBounds(ring);
      if (!S.map.getBounds().contains(b)) S.map.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
    }
  }

  function renderTabZona(z, a) {
    const el = $('#tabZona'); if (!el) return;
    if (S.tabZona === 'actividad') {
      if (!a) { el.innerHTML = '<p class="empty">Sin asignación vigente.</p>'; return; }
      const st = stats([a.id]);
      const qmap = new Map((z.cuadras || []).map(q => [q.id, q]));
      const jor = st.j.slice().sort((x, y) => y.fecha.localeCompare(x.fecha));
      const vis = st.v.slice().sort((x, y) => (y.creado || '').localeCompare(x.creado || ''));
      el.innerHTML = `<h3 style="font-size:14px;margin:4px 0 8px">Jornadas</h3>
        <div class="card" style="padding:8px 14px">${jor.length ? jor.map(j => `<div class="jor"><b>${num(j.horas)} h</b><span>${fecha(j.fecha)}</span><span class="grow">${esc(j.notas)}</span></div>`).join('') : '<p class="muted" style="font-size:13px">Todavía no registró jornadas.</p>'}</div>
        <div class="row" style="margin:18px 0 8px;justify-content:space-between"><h3 style="font-size:14px">Casas visitadas (${vis.length})</h3>${vis.length ? '<button class="btn sm" data-a="csv">Exportar CSV</button>' : ''}</div>
        ${vis.length ? vis.map(v => { const q = qmap.get(v.cuadra_id); return tarjetaVisita(v, { extra: q ? `<div class="muted" style="font-size:11px">${esc(entreTxt(q))}</div>` : '' }); }).join('') : '<p class="muted" style="font-size:13px">Todavía no cargó casas.</p>'}`;
      cargarFotos(el);
    } else if (S.tabZona === 'cuadras') {
      const porCalle = agrupar(z.cuadras || []);
      const sinNum = (z.cuadras || []).filter(q => q.desde == null).length;
      el.innerHTML = `${S.be.modo === 'supabase' ? `<button class="btn sm ${sinNum ? 'primary' : ''} block" style="margin-bottom:12px" data-a="numOficial">↻ Actualizar numeración y manos${sinNum ? ` (${sinNum} cuadras sin altura)` : ''}</button>` : ''}
        <p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 12px">Si la numeración de una calle no es correcta, escribí la altura de su <b>primera cuadra</b> y tocá Aplicar. Con ⇅ invertís el sentido.</p>
        ${porCalle.map(([calle, qs]) => `<details class="calle"><summary>${esc(calle)}${qs.some(q => q.perimetral) ? '<span class="perim">LÍMITE</span>' : ''}<span class="cnt">${qs.length}</span></summary>
          <div style="padding:0 14px 12px"><div class="calib"><input class="i" type="number" step="100" placeholder="Ej: 3200" value="${qs[0].desde ?? ''}" data-calib="${esc(calle)}"><button class="btn sm" data-a="calibrar" data-calle="${esc(calle)}">Aplicar</button><button class="btn sm ghost" data-a="invertir" data-calle="${esc(calle)}" title="Invertir sentido">⇅</button></div>
          <table class="t">${qs.map(q => `<tr><td><b>${q.desde != null ? `${q.desde}–${q.hasta}` : `Cuadra ${q.orden}`}</b>${q.aprox ? ' <span class="muted">aprox.</span>' : ''}</td><td class="muted">${esc(entreTxt(q))}</td>
            <td style="text-align:right">${q.perimetral ? `<button class="mano-btn ${q.mano ? 'on' : ''}" data-a="mano" data-q="${q.id}" title="Tocá para cambiar">${q.mano ? 'mano ' + q.mano : 'ambas manos'}</button>` : ''}</td></tr>`).join('')}</table></div></details>`).join('')}
        <p class="muted" style="font-size:12px;margin-top:10px">En las calles del límite, cada zona trabaja sólo la vereda que le corresponde. Si alguna está mal, tocá la etiqueta para cambiarla (par → impar → ambas).</p>`;
    } else {
      const hist = S.d.asignaciones.filter(x => x.zona_id === z.id).sort((x, y) => y.inicio.localeCompare(x.inicio));
      el.innerHTML = hist.length ? hist.map(h => { const st = stats([h.id]); const e = estadoAsig(h); return `<div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div class="row" style="justify-content:space-between"><b>${esc(nombre(perfil(h.asesor_id)))}</b>${e === 'finalizada' ? `<span class="badge">${h.motivo_fin === 'liberada' ? 'Liberada' : 'Reasignada'}</span>` : badge(e, false, h)}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">${fechaL(h.inicio)} → ${h.finalizada ? fechaL(h.finalizada) : fechaL(h.vence)}${h.renovaciones ? ` · ${h.renovaciones} renovación(es)` : ''}</div>
        <div style="font-size:13px;margin-top:6px">${cobertura(z, h).pct}% cubierta · ${st.visitas} casas · ${st.contactos} con teléfono · ${num(st.horas)} h en ${st.jornadas} jornadas · ${st.tasaciones} tasaciones · ${st.captaciones} captaciones</div></div>`; }).join('') : '<p class="empty">Sin historial.</p>';
    }
  }

  function agrupar(cuadras) {
    const m = new Map();
    for (const q of cuadras) { if (!m.has(q.calle)) m.set(q.calle, []); m.get(q.calle).push(q); }
    for (const qs of m.values()) qs.sort((a, b) => (a.desde != null && b.desde != null) ? a.desde - b.desde : a.orden - b.orden);
    return [...m.entries()].sort((a, b) => (b[1].some(q => q.perimetral) - a[1].some(q => q.perimetral)) || a[0].localeCompare(b[0], 'es'));
  }

  // ---------- Asignar ----------
  function sheetAsignar(zid) {
    const z = S.d.zonas.find(x => x.id === zid);
    const ases = S.d.perfiles.filter(p => p.rol !== 'admin').sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'));
    modal(`<h3>Asignar “${esc(z.nombre)}”</h3><p class="muted" style="margin:0;font-size:14px">El asesor recibe un mail con la zona y el acceso a su panel. Tiene 90 días.</p>
      ${ases.length ? `<label class="f">Asesor</label><select class="i" id="aSel"><option value="">＋ Asesor nuevo</option>${ases.map(p => `<option value="${p.id}">${esc(nombre(p))} — ${esc(p.email)}</option>`).join('')}</select>` : ''}
      <div id="aNuevo"><div class="grid2"><div><label class="f">Nombre</label><input class="i" id="aNom" autocomplete="off"></div><div><label class="f">Apellido</label><input class="i" id="aApe" autocomplete="off"></div></div>
      <label class="f">Correo electrónico</label><input class="i" id="aMail" type="email" autocomplete="off" placeholder="nombre@ejemplo.com"></div>
      <div id="aErr"></div>
      <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn ghost" data-a="cerrarModal">Cancelar</button><button class="btn primary" data-a="confirmarAsignar" data-z="${zid}">Asignar y enviar mail</button></div>`);
    const sel = $('#aSel'); if (sel) sel.onchange = () => $('#aNuevo').classList.toggle('hidden', !!sel.value);
  }

  async function confirmarAsignar(btn) {
    const zid = btn.dataset.z; const sel = $('#aSel');
    const asesor = sel && sel.value ? { id: sel.value } : { nombre: $('#aNom').value.trim(), apellido: $('#aApe').value.trim(), email: $('#aMail').value.trim() };
    if (!asesor.id && (!asesor.nombre || !asesor.apellido || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(asesor.email))) { $('#aErr').innerHTML = '<div class="err">Completá nombre, apellido y un correo válido.</div>'; return; }
    await conCarga(btn, async () => {
      try {
        const r = await S.be.asignar(zid, asesor);
        await recargar(); dibujarZonas(); herramientasMapa(); abrirZona(zid);
        mostrarResultadoAcceso(r, S.d.zonas.find(z => z.id === zid));
      } catch (e) { $('#aErr').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    });
  }

  function mostrarResultadoAcceso(r, z) {
    const p = r.asesor || {};
    const url = location.origin;
    const msg = `Hola ${p.nombre || ''}! ${z ? `Te asigné la zona de farming *${z.nombre}*.` : 'Te paso tus datos de acceso al panel de farming.'}\nIngresá en ${url}\nUsuario: ${p.email || ''}${r.passTemporal ? `\nContraseña: ${r.passTemporal}` : ''}`;
    modal(`<h3>${r.mail?.enviado ? '✓ Listo, mail enviado' : 'Listo'}</h3>
      ${r.mail?.enviado ? `<p class="muted" style="font-size:14px">Le llegó a ${esc(p.email || 'el asesor')} el mail${z ? ' con la zona' : ''} y el acceso.</p>` : `<div class="note">${esc(r.mail?.error || 'No se pudo enviar el mail.')} Compartile los datos por WhatsApp.</div>`}
      ${r.passTemporal ? `<div class="cred">Usuario: <code>${esc(p.email || '')}</code><br>Contraseña provisoria: <code>${esc(r.passTemporal)}</code></div>` : ''}
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Enviar por WhatsApp</a>
        <button class="btn primary" data-a="cerrarModal">Cerrar</button></div>`);
  }

  function csv(z, a) {
    const st = stats([a.id]);
    const qmap = new Map((z.cuadras || []).map(q => [q.id, q]));
    const filas = [['Fecha', 'Calle', 'Altura', 'Propietario', 'Teléfono', 'Resultado', 'En venta con colega', 'Inmobiliaria', 'Valor USD', 'A la venta desde', 'Último contacto', 'Etapa', 'Fecha tasación', 'Fecha captación', 'Notas', 'Seguimiento', 'Cuadra', 'Asesor']];
    const as = nombre(perfil(a.asesor_id));
    st.v.forEach(v => { const q = qmap.get(v.cuadra_id); filas.push([v.fecha, v.calle, v.altura ?? '', v.propietario, v.telefono, v.resultado, v.en_venta_colega ? 'Sí' : 'No', v.venta_inmobiliaria || '', v.venta_valor ?? '', v.venta_desde || '', v.ultimo_contacto || '', (ETAPAS.find(x => x[0] === etapaDe(v)) || ['', ''])[1], v.tasacion_fecha || '', v.captacion_fecha || '', v.notas, notasDe(v).slice().reverse().map(n => `${n.fecha}: ${n.texto}`).join(' | '), q ? entreTxt(q) : '', as]); });
    const txt = '﻿' + filas.map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob([txt], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `farming-${z.nombre.replace(/[^\w]+/g, '-')}.csv`; link.click();
  }

  // ---------- Vista: zonas ----------
  function vistaZonas() {
    const el = $('#vista');
    const zs = S.d.zonas.map(z => ({ z, ...estadoZona(z) }));
    const filtradas = zs.filter(x => S.filtro === 'todas' || (S.filtro === 'pronto' ? x.pronto : x.e === S.filtro));
    const orden = { vencida: 0, activa: 1, libre: 2 };
    filtradas.sort((a, b) => (orden[a.e] - orden[b.e]) || (a.a && b.a ? new Date(a.a.vence) - new Date(b.a.vence) : 0) || a.z.nombre.localeCompare(b.z.nombre));
    const c = k => zs.filter(x => k === 'todas' || (k === 'pronto' ? x.pronto : x.e === k)).length;
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h2>Zonas</h2><button class="btn sm primary" data-v="mapa">＋ Nueva zona en el mapa</button></div>
      <div class="filters">${[['todas', 'Todas'], ['vencida', 'Vencidas'], ['pronto', 'Por vencer'], ['activa', 'Activas'], ['libre', 'Libres']].map(([k, t]) => `<button class="${S.filtro === k ? 'on' : ''}" data-f="${k}">${t} (${c(k)})</button>`).join('')}</div>
      <div class="zl">${filtradas.length ? filtradas.map(({ z, a, e, pronto }) => { const st = a ? stats([a.id]) : null; return `<div class="zcard ${e}" data-zona="${z.id}">
        <div class="t"><span class="swatch" style="background:${z.color}"></span><b>${esc(z.nombre)}</b>${badge(e, pronto, a)}</div>
        <div class="m"><span>${a ? esc(nombre(perfil(a.asesor_id))) : 'Sin asesor'}</span>${z.barrio ? `<span class="serif">${esc(z.barrio)}</span>` : ''}<span>${(z.cuadras || []).length} cuadras</span></div>
        ${st ? `<div class="m"><span>🗺 ${cobertura(z, a).pct}% cubierta</span><span>🏠 ${st.visitas} casas</span><span>☎ ${st.contactos}</span><span>⏱ ${num(st.horas)} h</span>${st.captaciones ? `<span class="gold">🏆 ${st.captaciones}</span>` : ''}<span>${st.ultima ? 'Últ. ' + fecha(st.ultima) : 'Sin movimiento'}</span></div>` : ''}
        ${e === 'vencida' ? '<div class="row"><button class="btn sm primary" data-a="renovarZ" data-z="' + z.id + '">Renovar 90 días</button><button class="btn sm" data-a="asignarZ" data-z="' + z.id + '">Asignar a otro</button></div>' : ''}
      </div>`; }).join('') : `<div class="empty"><b>${S.d.zonas.length ? 'No hay zonas con este filtro' : 'Todavía no hay zonas'}</b>${S.d.zonas.length ? '' : 'Andá al mapa para crear la primera.'}</div>`}</div>`;
  }

  // ---------- Vista: contactos (buscador) ----------
  const CATS = [['todos', 'Todos'], ['oport', '⭐ Oportunidades'], ['ven', '🚨 Con intención de vender'], ['col', CARTEL.replace('class="cartel"', 'class="cartel chip-ic"') + ' En venta con firma colega'], ['tasar', 'Interesado en tasar'], ['tas', '💰 Tasación hecha'], ['cap', '🏆 Captación'], ['pend', '☎ Llamados pendientes'], ['no', 'No quiere vender'], ['otros', 'Otros']];
  const CAT_TXT = { todos: 'Todas las categorías', oport: '⭐ Oportunidades (todas)', ven: '🚨 Con intención de vender', col: 'En venta con firma colega', tasar: 'Interesado en tasar', tas: '💰 Tasación hecha', cap: '🏆 Captación', pend: '☎ Llamados pendientes', no: 'No quiere vender', otros: 'Otros' };
  function enCategoria(v, k, activas) {
    const ven = v.resultado === 'Interesado en vender' && v.etapa !== 'captacion';
    const col = !!v.en_venta_colega && v.etapa !== 'captacion';
    const tasar = v.resultado === 'Interesado en tasar' && !['tasacion', 'captacion'].includes(v.etapa);
    const tas = v.etapa === 'tasacion', cap = v.etapa === 'captacion', no = v.resultado === 'No quiere vender' && !v.etapa;
    switch (k) {
      case 'todos': return true;
      case 'oport': return ven || col || tas || cap;
      case 'ven': return ven; case 'col': return col; case 'tasar': return tasar; case 'tas': return tas; case 'cap': return cap; case 'no': return no;
      case 'pend': return activas.has(v.asignacion_id) && enSeguimiento(v) && proximoContacto(v) <= 0;
      case 'otros': return !(ven || col || tasar || tas || cap || no);
    }
    return true;
  }
  const etiquetaCuadra = q => q && q.desde != null ? `${q.desde}–${q.hasta}` : q && q.orden ? `Cuadra ${q.orden}` : 's/d';
  function vistaOportunidades() {
    const el = $('#vista');
    const B = S.bus = S.bus || { q: '', calle: '', cuadra: '', zona: '', asesor: '', cat: 'todos', orden: 'reciente', n: 40 };
    const adm = esAdmin();
    const misZonas = adm ? S.d.zonas : S.d.zonas.filter(z => S.d.asignaciones.some(a => a.zona_id === z.id && a.asesor_id === S.yo.id));
    const ases = S.d.perfiles.filter(p => p.rol !== 'admin').sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'));
    const zonaDeVisita = v => { const a = S.d.asignaciones.find(x => x.id === v.asignacion_id); return a ? S.d.zonas.find(z => z.id === a.zona_id) : null; };
    const universo = contactosVisibles();
    // Calles: todas las de las zonas (filtradas por la zona elegida), con la cantidad de contactos de cada una
    const zonasCalles = (B.zona ? misZonas.filter(z => z.id === B.zona) : misZonas);
    const cuadrasZonas = zonasCalles.flatMap(z => (z.cuadras || []).map(q => ({ q, z })));
    const nPorCalle = new Map(); universo.forEach(v => nPorCalle.set(v.calle, (nPorCalle.get(v.calle) || 0) + 1));
    const calles = [...new Set([...cuadrasZonas.map(x => x.q.calle), ...universo.map(v => v.calle)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const nPorCuadra = new Map(); universo.forEach(v => nPorCuadra.set(v.cuadra_id, (nPorCuadra.get(v.cuadra_id) || 0) + 1));
    const variasZonas = zonasCalles.length > 1;
    const cuadrasCalle = B.calle ? cuadrasZonas.filter(x => x.q.calle === B.calle)
      .sort((a, b) => (a.z.nombre.localeCompare(b.z.nombre)) || ((a.q.desde ?? 1e9) - (b.q.desde ?? 1e9)) || (a.q.orden - b.q.orden)) : [];
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h2>${adm ? 'Contactos' : 'Mis contactos'}</h2><button class="btn sm" data-a="csvBusqueda">Exportar CSV</button></div>
      <div class="buscador card">
        <input class="i" id="bQ" placeholder="🔎 Buscar por nombre, teléfono, inmobiliaria o nota…" value="${esc(B.q)}" autocomplete="off">
        <div class="bgrid">
          <label class="bf"><span>Calle</span><select class="i" data-b="calle"><option value="">Todas las calles (${calles.length})</option>${calles.map(c => `<option value="${esc(c)}" ${B.calle === c ? 'selected' : ''}>${esc(c)}${nPorCalle.get(c) ? ` · ${nPorCalle.get(c)}` : ''}</option>`).join('')}</select></label>
          <label class="bf"><span>Cuadra</span><select class="i" data-b="cuadra" ${B.calle ? '' : 'disabled'}><option value="">${B.calle ? 'Todas las cuadras' : 'Cuadra (elegí calle)'}</option>${cuadrasCalle.map(({ q, z }) => `<option value="${q.id}" ${B.cuadra === q.id ? 'selected' : ''}>${esc(etiquetaCuadra(q))}${q.entre && q.entre.filter(Boolean).length === 2 ? ` · e/ ${esc(q.entre[0])} y ${esc(q.entre[1])}` : ''}${variasZonas ? ` · ${esc(z.nombre)}` : ''}${nPorCuadra.get(q.id) ? ` · ${nPorCuadra.get(q.id)}` : ''}</option>`).join('')}</select></label>
          ${adm || misZonas.length > 1 ? `<label class="bf"><span>Zona</span><select class="i" data-b="zona"><option value="">Todas las zonas</option>${misZonas.map(z => `<option value="${z.id}" ${B.zona === z.id ? 'selected' : ''}>${esc(z.nombre)}</option>`).join('')}</select></label>` : ''}
          ${adm ? `<label class="bf"><span>Asesor</span><select class="i" data-b="asesor"><option value="">Todos los asesores</option>${ases.map(p => `<option value="${p.id}" ${B.asesor === p.id ? 'selected' : ''}>${esc(nombre(p))}</option>`).join('')}</select></label>` : ''}
          <label class="bf ancho"><span>Categoría</span><select class="i" data-b="cat" id="bCatSel">${CATS.map(([k]) => `<option value="${k}" ${B.cat === k ? 'selected' : ''}>${CAT_TXT[k]}</option>`).join('')}</select></label>
          <label class="bf"><span>Ordenar por</span><select class="i" data-b="orden">${[['reciente', 'Más recientes'], ['antiguo', 'Más antiguos'], ['calle', 'Por calle y altura'], ['venta', 'Más tiempo en venta']].map(([k, t]) => `<option value="${k}" ${B.orden === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="bf"><span>&nbsp;</span><button class="btn sm ghost" data-a="limpiarBusqueda">Limpiar filtros</button></label>
        </div>
      </div>
      <div class="filters" id="bCats"></div>
      <div id="bRes"></div>`;
    pintarResultados();
    $('#bQ').oninput = () => { B.q = $('#bQ').value; B.n = 40; pintarResultados(); };
  }
  // El broker ve todo; el asesor, sólo los contactos que cargó él
  const contactosVisibles = () => esAdmin() ? S.d.visitas : S.d.visitas.filter(v => v.asesor_id === S.yo.id);
  function filtrarContactos() {
    const B = S.bus;
    const activas = new Set(S.d.asignaciones.filter(a => estadoAsig(a) === 'activa').map(a => a.id));
    const zonaAsig = new Map(S.d.asignaciones.map(a => [a.id, a.zona_id]));
    const t = Geo.norm(B.q), td = B.q.replace(/\D/g, '');
    const base = contactosVisibles().filter(v => {
      if (B.calle && v.calle !== B.calle) return false;
      if (B.cuadra && v.cuadra_id !== B.cuadra) return false;
      if (B.zona && zonaAsig.get(v.asignacion_id) !== B.zona) return false;
      if (B.asesor && v.asesor_id !== B.asesor) return false;
      if (t) {
        const txt = Geo.norm([v.propietario, v.venta_inmobiliaria, v.notas, v.calle + ' ' + (v.altura ?? ''), ...notasDe(v).map(n => n.texto)].join(' '));
        const tel = String(v.telefono || '').replace(/\D/g, '');
        if (!txt.includes(t) && !(td.length >= 3 && tel.includes(td))) return false;
      }
      return true;
    });
    const conteo = Object.fromEntries(CATS.map(([k]) => [k, base.filter(v => enCategoria(v, k, activas)).length]));
    let lista = base.filter(v => enCategoria(v, B.cat, activas));
    const f = v => (v.creado || v.fecha || '');
    if (B.orden === 'reciente') lista.sort((a, b) => f(b).localeCompare(f(a)));
    else if (B.orden === 'antiguo') lista.sort((a, b) => f(a).localeCompare(f(b)));
    else if (B.orden === 'calle') lista.sort((a, b) => a.calle.localeCompare(b.calle, 'es') || (a.altura || 0) - (b.altura || 0));
    else if (B.orden === 'venta') lista.sort((a, b) => (a.venta_desde || '9').localeCompare(b.venta_desde || '9') || f(b).localeCompare(f(a)));
    return { lista, conteo };
  }
  function pintarResultados() {
    const B = S.bus; const { lista, conteo } = filtrarContactos();
    $('#bCats').innerHTML = CATS.map(([k, t]) => `<button class="${B.cat === k ? 'on' : ''}" data-cat="${k}">${t} (${conteo[k]})</button>`).join('');
    const sel = $('#bCatSel'); if (sel) sel.innerHTML = CATS.map(([k]) => `<option value="${k}" ${B.cat === k ? 'selected' : ''}>${CAT_TXT[k]} (${conteo[k]})</option>`).join('');
    const zonaDe = v => { const a = S.d.asignaciones.find(x => x.id === v.asignacion_id); return { a, z: a ? S.d.zonas.find(z => z.id === a.zona_id) : null }; };
    const vis = lista.slice(0, B.n);
    $('#bRes').innerHTML = `<p class="muted" style="font-size:13px;margin:0 0 8px">${lista.length} ${lista.length === 1 ? 'contacto' : 'contactos'}</p>
      ${vis.length ? `<div class="zl">${vis.map(v => { const { a, z } = zonaDe(v); const { q } = zonaYCuadraDe(v); const fin = a && estadoAsig(a) === 'finalizada';
        const adm = esAdmin();
        return tarjetaVisita(v, { calle: v.calle, puede: !adm && a && estadoAsig(a) === 'activa', extra: `<div class="muted" style="font-size:12px;margin-top:4px">${esc(v.calle)} ${esc(etiquetaCuadra(q))} · ${z ? (adm ? `<a href="#" data-zona="${z.id}">${esc(z.nombre)}</a> · ` : `${esc(z.nombre)} · `) : ''}${adm ? esc(nombre(perfil(v.asesor_id))) + ' · ' : ''}${fin ? 'gestión anterior · ' : ''}cargado el ${fecha(v.creado || v.fecha)}</div>` }); }).join('')}</div>
        ${lista.length > vis.length ? `<button class="btn block" style="margin-top:12px" data-a="verMasBusqueda">Ver ${Math.min(40, lista.length - vis.length)} más (quedan ${lista.length - vis.length})</button>` : ''}`
      : '<div class="empty"><b>No hay contactos con esos filtros</b>Probá cambiar la búsqueda o tocá “Limpiar filtros”.</div>'}`;
    cargarFotos($('#bRes'));
  }
  function csvContactos(lista) {
    const filas = [['Cargado', 'Calle', 'Altura', 'Cuadra', 'Propietario', 'Teléfono', 'Resultado', 'Etapa', 'En venta con colega', 'Inmobiliaria', 'Valor USD', 'A la venta desde', 'Último contacto', 'Notas', 'Seguimiento', 'Zona', 'Asesor']];
    lista.forEach(v => { const { q, z } = zonaYCuadraDe(v);
      filas.push([(v.creado || v.fecha || '').slice(0, 10), v.calle, v.altura ?? '', etiquetaCuadra(q), v.propietario, v.telefono, v.resultado, (ETAPAS.find(x => x[0] === etapaDe(v)) || ['', ''])[1], v.en_venta_colega ? 'Sí' : 'No', v.venta_inmobiliaria || '', v.venta_valor ?? '', v.venta_desde || '', v.ultimo_contacto || '', v.notas, notasDe(v).slice().reverse().map(n => `${n.fecha}: ${n.texto}`).join(' | '), z ? z.nombre : '', nombre(perfil(v.asesor_id))]); });
    const txt = '﻿' + filas.map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); link.download = `contactos-${hoyISO()}.csv`; link.click();
  }

  // ---------- Vista: equipo (tablero comparativo) ----------
  function vistaAsesores() {
    const el = $('#vista');
    const per = S.periodo || 'vigente';
    const desde = per === '30' ? new Date(Date.now() - 30 * DIA).toISOString() : per === '7' ? new Date(Date.now() - 7 * DIA).toISOString() : null;
    const enPer = f => !desde || (f && f >= desde.slice(0, f.length === 10 ? 10 : 30));
    const ases = S.d.perfiles.filter(p => p.rol !== 'admin');
    const filas = ases.map(p => {
      const asigs = S.d.asignaciones.filter(a => a.asesor_id === p.id);
      const vig = asigs.filter(a => a.estado !== 'finalizada');
      const base = per === 'vigente' ? vig : asigs;
      const ids = new Set(base.map(a => a.id));
      const v = S.d.visitas.filter(x => ids.has(x.asignacion_id));
      const j = S.d.jornadas.filter(x => ids.has(x.asignacion_id));
      const vv = v.filter(x => enPer(x.creado)), jj = j.filter(x => enPer(x.fecha));
      const cobs = vig.map(a => { const z = S.d.zonas.find(x => x.id === a.zona_id); return z ? cobertura(z, a) : null; }).filter(Boolean);
      const cob = cobs.length ? Math.round(cobs.reduce((s, c) => s + c.hechas, 0) / Math.max(1, cobs.reduce((s, c) => s + c.tot, 0)) * 100) : null;
      const ult = [...v.map(x => x.creado), ...j.map(x => x.creado)].filter(Boolean).sort().pop();
      return { p, vig, cob, ult,
        horas: jj.reduce((s, x) => s + Number(x.horas || 0), 0), jornadas: jj.length, casas: vv.length,
        contactos: vv.filter(x => (x.telefono || '').trim()).length,
        tasaciones: v.filter(x => x.tasacion_fecha && enPer(x.tasacion_fecha)).length,
        captaciones: v.filter(x => x.etapa === 'captacion' && enPer(x.captacion_fecha || x.creado)).length,
        pend: pendientes(v.filter(x => vig.some(a => a.id === x.asignacion_id && estadoAsig(a) === 'activa'))).length };
    }).sort((a, b) => (b.captaciones - a.captaciones) || (b.tasaciones - a.tasaciones) || (b.contactos - a.contactos) || (b.horas - a.horas) || nombre(a.p).localeCompare(nombre(b.p), 'es'));
    const tot = k => filas.reduce((s, f) => s + f[k], 0);
    const maxH = Math.max(1, ...filas.map(f => f.horas)), maxC = Math.max(1, ...filas.map(f => f.contactos));
    const medalla = i => filas[i] && (filas[i].captaciones || filas[i].tasaciones || filas[i].contactos) ? ['🥇', '🥈', '🥉'][i] || '' : '';
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h2>Equipo <span class="muted" style="font-size:15px;font-weight:500">(${ases.length})</span></h2></div>
      <div class="filters">${[['vigente', 'Zonas vigentes'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['todo', 'Histórico']].map(([k, t]) => `<button class="${per === k ? 'on' : ''}" data-per="${k}">${t}</button>`).join('')}</div>
      ${ases.length ? `<div class="card equipo-tot"><div class="stats six">
        <div class="stat"><b>${num(tot('horas'))}</b><span>HORAS</span></div><div class="stat"><b>${tot('jornadas')}</b><span>JORNADAS</span></div>
        <div class="stat"><b>${tot('casas')}</b><span>CASAS</span></div><div class="stat"><b>${tot('contactos')}</b><span>CONTACTOS</span></div>
        <div class="stat"><b>${tot('tasaciones')}</b><span>TASACIONES</span></div><div class="stat gold-stat"><b>${tot('captaciones')}</b><span>CAPTACIONES</span></div></div></div>` : ''}
      <div class="zl" style="margin-top:12px">${filas.length ? filas.map((f, i) => `<div class="card ase">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="min-width:0"><b style="font-size:16px">${medalla(i)} ${esc(nombre(f.p))}</b><div class="muted" style="font-size:12px">${esc(f.p.email)} · ${f.ult ? 'últ. actividad ' + fecha(f.ult) : 'sin actividad'}</div></div>
          <button class="btn sm ghost" data-a="reset" data-p="${f.p.id}">Reenviar acceso</button></div>
        <div class="row" style="margin-top:8px">${f.vig.length ? f.vig.map(a => { const z = S.d.zonas.find(x => x.id === a.zona_id); const e = estadoAsig(a); return z ? `<button class="badge ${e === 'vencida' ? 'vencida' : 'activa'}" style="border:0;cursor:pointer" data-zona="${z.id}">${esc(z.nombre)} · ${e === 'vencida' ? 'vencida' : restante(a).txt}</button>` : ''; }).join('') : '<span class="badge libre">Sin zona vigente</span>'}${f.pend ? `<span class="badge pronto">☎ ${f.pend} llamados atrasados</span>` : ''}</div>
        <div class="metr">
          <div><span>Cobertura</span><b>${f.cob == null ? '—' : f.cob + '%'}</b><i class="mb"><em style="width:${f.cob || 0}%"></em></i></div>
          <div><span>Horas</span><b>${num(f.horas)}</b><i class="mb"><em style="width:${100 * f.horas / maxH}%"></em></i></div>
          <div><span>Contactos</span><b>${f.contactos}</b><i class="mb"><em style="width:${100 * f.contactos / maxC}%"></em></i></div>
          <div><span>Jornadas</span><b>${f.jornadas}</b></div>
          <div><span>Casas</span><b>${f.casas}</b></div>
          <div><span>Tasaciones</span><b>${f.tasaciones}</b></div>
          <div class="cap"><span>Captaciones</span><b>${f.captaciones}</b></div>
        </div></div>`).join('') : '<div class="empty"><b>Todavía no hay asesores</b>Creá una zona en el mapa y asignala: ahí cargás nombre, apellido y correo.</div>'}</div>
      ${filas.length ? '<p class="muted" style="font-size:12px;margin-top:10px">Ordenado por captaciones, después tasaciones, contactos y horas. La cobertura es siempre sobre las zonas vigentes.</p>' : ''}`;
  }

  // =====================================================================
  //  PANEL DEL ASESOR
  // =====================================================================
  function renderAsesor() {
    document.body.classList.remove('has-nav');
    const vig = S.d.asignaciones.filter(a => a.asesor_id === S.yo.id && a.estado !== 'finalizada')
      .sort((a, b) => new Date(a.vence) - new Date(b.vence));
    if (!S.asigSel || !vig.find(a => a.id === S.asigSel)) S.asigSel = vig[0]?.id || null;
    const a = vig.find(x => x.id === S.asigSel);
    if (!a) {
      $('#app').innerHTML = topbar() + `<main><div class="wrap"><div class="empty"><b>Hola ${esc(S.yo.nombre)}</b>No tenés zonas asignadas en este momento.</div></div></main>`;
      return;
    }
    const tabsAsesor = `<div class="tabs asesor-tabs"><button class="${S.asesorTab !== 'contactos' ? 'on' : ''}" data-atab="zona">🗺 Mi zona</button><button class="${S.asesorTab === 'contactos' ? 'on' : ''}" data-atab="contactos">🔎 Mis contactos</button></div>`;
    if (S.asesorTab === 'contactos') {
      $('#app').innerHTML = topbar() + `<main><div class="wrap">${tabsAsesor}<div id="vista"></div></div></main>`;
      vistaOportunidades(); cambioRed(); return;
    }
    const z = S.d.zonas.find(x => x.id === a.zona_id);
    const e = estadoAsig(a), r = restante(a), pronto = e === 'activa' && r.ms < 10 * DIA;
    const st = stats([a.id]);
    const puede = e === 'activa';
    const jor = st.j.slice().sort((x, y) => y.fecha.localeCompare(x.fecha) || (y.creado || '').localeCompare(x.creado || ''));
    const pend = puede ? pendientes(st.v) : [];
    const vigIds = new Set(vig.filter(x => estadoAsig(x) === 'activa').map(x => x.id));
    tituloPestana(pendientes(S.d.visitas.filter(v => vigIds.has(v.asignacion_id))).length);
    const banner = pend.length ? `<div class="alerta-llamar ${S.verPend ? 'abierta' : ''}">
      <button class="al-h" data-a="togglePend"><span class="al-ic">☎</span><span class="grow"><b>${pend.length === 1 ? 'Tenés 1 contacto para llamar' : `Tenés ${pend.length} contactos para llamar`}</b><small>${S.verPend ? 'Tocá para ocultar' : 'Tocá para ver la lista'}</small></span><span class="al-n">${pend.length}</span></button>
      ${S.verPend ? `<div class="al-lista">${pend.map(v => { const atraso = -proximoContacto(v); return `<div class="al-item">
        <div class="grow"><b>${esc(v.propietario || 'Propietario')}</b> <span class="muted">· ${esc(v.calle)} ${v.altura ?? ''}</span>
          <div style="font-size:12px;color:var(--tx2)">${v.en_venta_colega ? `En venta con ${esc(v.venta_inmobiliaria || 'colega')}${v.venta_valor ? ' · ' + usd(v.venta_valor) : ''}${v.venta_desde ? ' · lleva ' + tiempoVenta(v.venta_desde) : ''}` : esc(v.resultado)}${atraso > 0 ? ` · <span style="color:var(--warn)">${atraso} ${atraso === 1 ? 'día' : 'días'} de atraso</span>` : ''}</div></div>
        <div class="al-acc">${v.telefono ? `<a class="btn sm" href="tel:${esc(v.telefono)}">📞 Llamar</a>` : ''}${btnWA(v)}<button class="btn sm primary" data-a="contactado" data-id="${v.id}">✓ Contactado</button></div></div>`; }).join('')}</div>` : ''}
    </div>` : '';
    $('#app').innerHTML = topbar() + `<main><div class="wrap">
      ${tabsAsesor}
      ${vig.length > 1 ? `<div class="filters">${vig.map(x => `<button class="${x.id === a.id ? 'on' : ''}" data-asig="${x.id}">${esc(S.d.zonas.find(z => z.id === x.zona_id)?.nombre || 'Zona')}</button>`).join('')}</div>` : ''}
      ${banner}
      ${sugerirInstalar() ? `<div class="card instalar-card"><div class="row" style="flex-wrap:nowrap;gap:12px"><img src="icono-192.png" alt="" width="44" height="44" style="border-radius:10px">
        <div class="grow" style="flex:1"><b>Instalá la app en tu celular</b><div class="muted" style="font-size:13px">Queda con ícono propio y funciona aunque te quedes sin señal en la calle.</div></div></div>
        <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn sm ghost" data-a="ocultarInstalar">Ahora no</button><button class="btn sm primary" data-a="instalar">Instalar</button></div></div>` : ''}
      <div class="card">
        <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:1px">TU ZONA</div>
        <h2 style="font-size:24px;margin-top:2px">${esc(z.nombre)}</h2>${z.barrio ? `<div class="serif gold">${esc(z.barrio)}</div>` : ''}
        <div class="row" style="margin-top:16px;justify-content:space-between;align-items:flex-end">
          <div><div class="count"><b style="color:${e === 'vencida' ? 'var(--bad)' : pronto ? 'var(--warn)' : 'var(--gold)'}">${e === 'vencida' ? 0 : r.v}</b><span>${e === 'vencida' ? 'días' : r.u} ${e === 'vencida' ? '' : 'restantes'}</span></div></div>
          <div class="muted" style="font-size:13px;text-align:right">${e === 'vencida' ? 'Venció' : 'Vence'} el<br><b style="color:var(--tx)">${fechaL(a.vence)}</b></div></div>
        <div class="bar ${e === 'vencida' ? 'bad' : pronto ? 'warn' : ''}"><i style="width:${pct(a)}%"></i></div>
        ${e === 'vencida' ? '<div class="err" style="margin-top:12px">Se cumplieron los 90 días. El broker está evaluando tu trabajo para renovar o reasignar la zona. Mientras tanto no se pueden cargar datos.</div>' : ''}
        <div class="stats" style="margin-top:14px"><div class="stat"><b>${st.visitas}</b><span>CASAS</span></div><div class="stat"><b>${st.contactos}</b><span>CON TELÉFONO</span></div><div class="stat"><b>${num(st.horas)}</b><span>HORAS</span></div><div class="stat"><b>${st.jornadas}</b><span>JORNADAS</span></div></div>
        ${barraCob(cobertura(z, a))}
        ${embudo(st)}
      </div>

      <div class="card"><h3 style="font-size:16px">Registrar jornada</h3>
        ${puede ? `<div class="row" style="margin-top:10px;align-items:flex-end"><div><label class="f" style="margin-top:0">Día</label><input class="i" type="date" id="jFecha" value="${hoyISO()}" max="${hoyISO()}" style="width:170px"></div>
          <div><label class="f" style="margin-top:0">Horas dedicadas</label><div class="stepper"><button data-a="hMenos">−</button><input id="jHoras" type="number" step="0.5" min="0.5" max="24" value="2" inputmode="decimal"><button data-a="hMas">＋</button></div></div></div>
          <label class="f">Notas (opcional)</label><input class="i" id="jNotas" placeholder="Ej: recorrí Pedro Morán de 4400 a 4700">
          <button class="btn primary block" style="margin-top:12px" data-a="addJornada">Guardar jornada</button>` : ''}
        <div style="margin-top:12px">${jor.length ? jor.slice(0, S.verTodasJ ? 999 : 5).map(j => `<div class="jor"><b>${num(j.horas)} h</b><span>${fecha(j.fecha)}</span><span class="grow">${esc(j.notas)}</span>${puede ? `<button class="vis x" style="background:none;border:0;color:var(--tx3);cursor:pointer" data-a="delJornada" data-id="${j.id}">✕</button>` : ''}</div>`).join('') +
          (jor.length > 5 && !S.verTodasJ ? `<button class="btn sm ghost" data-a="verTodasJ">Ver las ${jor.length}</button>` : '') : '<p class="muted" style="font-size:13px;margin:0">Todavía no registraste jornadas.</p>'}</div>
      </div>

      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="font-size:16px">Mapa de la zona</h3><span class="muted" style="font-size:12px">Dorado = trabajadas · Gris = pendientes</span></div>
        <div class="mini-map" id="miniMap"></div>${leyendaMarcas()}</div>

      <div style="margin-top:20px"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="font-size:18px">Calles y cuadras</h3><span class="muted" style="font-size:13px">${(z.cuadras || []).length} cuadras</span></div>
        <div class="row" style="flex-wrap:nowrap;margin-bottom:12px"><input class="i" id="buscar" placeholder="Buscar calle…" value="${esc(S.buscar)}" style="flex:1">
          <button class="btn sm ${S.soloPend ? 'primary' : ''}" data-a="soloPend" title="Mostrar sólo cuadras sin trabajar">${S.soloPend ? '✓ ' : ''}Pendientes</button></div>
        <div id="listaCalles"></div></div>
    </div></main>`;
    renderCalles(z, a);
    miniMapa(z, a);
    cambioRed();
    const b = $('#buscar'); b.oninput = () => { S.buscar = b.value; renderCalles(z, a); };
  }

  function miniMapa(z, a) {
    if (S.mini) { S.mini.remove(); S.mini = null; }
    const el = $('#miniMap'); if (!el) return;
    const m = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19 });
    capaMapa().addTo(m);
    const ring = z.geometria.coordinates[0].map(c => [c[1], c[0]]);
    const pol = L.polygon(ring, { color: z.color, weight: 2, fillOpacity: .12 }).addTo(m);
    m.fitBounds(pol.getBounds(), { padding: [10, 10] });
    mostrarCuadras(z.cuadras || [], stats([a.id]).v, m, 'mini');
    capaOportunidades(stats([a.id]).v, m, false);
    S.mini = m;
    setTimeout(() => m.invalidateSize(), 50);
  }

  function renderCalles(z, a) {
    const el = $('#listaCalles'); if (!el) return;
    const puede = estadoAsig(a) === 'activa';
    const st = stats([a.id]);
    const porCuadra = new Map(); st.v.forEach(v => { if (!porCuadra.has(v.cuadra_id)) porCuadra.set(v.cuadra_id, []); porCuadra.get(v.cuadra_id).push(v); });
    const idsZona = new Set((z.cuadras || []).map(x => x.id));
    const retomadas = new Set(st.v.map(x => x.previa_id).filter(Boolean));
    const antPorCuadra = new Map();
    S.d.visitas.filter(x => x.asignacion_id !== a.id && idsZona.has(x.cuadra_id) && !retomadas.has(x.id)).forEach(x => { if (!antPorCuadra.has(x.cuadra_id)) antPorCuadra.set(x.cuadra_id, []); antPorCuadra.get(x.cuadra_id).push(x); });
    const q = Geo.norm(S.buscar);
    const grupos = agrupar((z.cuadras || []).filter(x => !S.soloPend || !porCuadra.has(x.id))).filter(([c]) => !q || Geo.norm(c).includes(q));
    el.innerHTML = grupos.length ? grupos.map(([calle, qs]) => {
      const n = qs.reduce((s, x) => s + (porCuadra.get(x.id)?.length || 0), 0);
      return `<details class="calle" data-calle="${esc(calle)}" ${S.abiertas.has(calle) ? 'open' : ''}><summary>${esc(calle)}${qs.some(x => x.perimetral) ? '<span class="perim">LÍMITE</span>' : ''}<span class="cnt ${n ? 'on' : ''}">${n}</span></summary>
        ${qs.map(cq => { const vs = (porCuadra.get(cq.id) || []).slice().sort((x, y) => (x.altura || 0) - (y.altura || 0)); return `<div class="cuadra ${S.cuadraAbierta === cq.id ? 'open' : ''}" id="c_${cq.id}">
          <div class="cuadra-h" data-cuadra="${cq.id}"><div class="tt"><b>${cq.desde != null ? `${cq.desde} – ${cq.hasta}` : `Cuadra ${cq.orden}`}${cq.aprox ? ' <small>aprox.</small>' : ''}${cq.mano ? ` <span class="mano">sólo mano ${cq.mano}</span>` : ''}</b><small>${esc(entreTxt(cq))}${(antPorCuadra.get(cq.id) || []).length ? ` · ${antPorCuadra.get(cq.id).length} de la gestión anterior` : ''}</small></div><span class="cnt ${vs.length ? 'on' : ''}">${vs.length}</span></div>
          <div class="cuadra-b">${vs.map(v => tarjetaVisita(v, { calle: cq.calle, puede })).join('')}
            ${(antPorCuadra.get(cq.id) || []).length ? `<div class="ant-h">De la gestión anterior (${antPorCuadra.get(cq.id).length})</div>${antPorCuadra.get(cq.id).map(v => tarjetaVisita(v, { calle: cq.calle, anterior: true, retomable: puede })).join('')}` : ''}
            ${puede ? `<div class="vform" data-form="${cq.id}"><div class="grid2"><div><label class="f" style="margin-top:0">Altura</label><input class="i" name="altura" type="number" inputmode="numeric" placeholder="${cq.desde != null ? cq.desde + '…' + cq.hasta : 'Número'}${cq.mano ? ' (' + cq.mano + ')' : ''}"></div>
              <div><label class="f" style="margin-top:0">Resultado</label><select class="i" name="resultado"><option value="">—</option>${RESULTADOS.map(r => `<option>${r}</option>`).join('')}</select></div></div>
              <label class="f">Propietario</label><input class="i" name="propietario" placeholder="Nombre y apellido" autocomplete="off">
              <label class="f">Teléfono celular</label><input class="i" name="telefono" type="tel" inputmode="tel" placeholder="Ej: 11 6494 9902 · característica + número, sin 0 ni 15" autocomplete="off"><div class="telhint" data-telhint></div>
              <label class="f">¿En venta con colega?</label>
              <div class="sino"><label><input type="radio" name="colega_${cq.id}" value="no" data-colega checked><span>No</span></label><label><input type="radio" name="colega_${cq.id}" value="si" data-colega><span>Sí</span></label></div>
              <div class="colega-campos hidden">
                <label class="f">¿Hace cuánto está a la venta?</label>
                <div class="row" style="flex-wrap:nowrap"><input class="i" name="venta_cant" type="number" min="0" inputmode="numeric" placeholder="Ej: 4" style="flex:1"><select class="i" name="venta_unidad" style="flex:1"><option value="30.44">meses</option><option value="1">días</option><option value="365.25">años</option></select></div>
                <label class="f">Inmobiliaria que la tiene</label><input class="i" name="venta_inmobiliaria" placeholder="Escribí el nombre de la firma colega" autocomplete="off">
                <label class="f">Valor publicado (USD)</label><input class="i" name="venta_valor" type="number" min="0" inputmode="numeric" placeholder="Ej: 185000">
              </div>
              <label class="f">Notas</label><input class="i" name="notas" placeholder="Ej: PH al fondo, vende en 2027" autocomplete="off">
              <label class="f">Fotos (hasta 3)</label>
              <label class="btn sm fotobtn">📷 Agregar fotos<input type="file" accept="image/*" multiple data-fotos hidden></label>
              <div class="fotos prev" data-prev></div>
              <button class="btn primary block" style="margin-top:12px" data-a="addVisita" data-q="${cq.id}">Guardar casa</button></div>` : ''}</div></div>`; }).join('')}</details>`;
    }).join('') : `<p class="empty">${S.soloPend && !q ? '🎉 ¡Trabajaste todas las cuadras de tu zona!' : 'No hay calles que coincidan.'}</p>`;
    el.querySelectorAll('details.calle').forEach(d => d.addEventListener('toggle', () => { d.open ? S.abiertas.add(d.dataset.calle) : S.abiertas.delete(d.dataset.calle); }));
    cargarFotos(el);
  }

  function irACuadra(qid) {
    const z = S.d.zonas.find(x => (x.cuadras || []).some(q => q.id === qid)); if (!z) return;
    const q = z.cuadras.find(x => x.id === qid);
    S.buscar = ''; S.abiertas.add(q.calle); S.cuadraAbierta = qid;
    const a = S.d.asignaciones.find(x => x.id === S.asigSel);
    const b = $('#buscar'); if (b) b.value = '';
    renderCalles(z, a);
    const el = document.getElementById('c_' + qid); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Editar una casa ----------
  function zonaYCuadraDe(v) {
    for (const z of S.d.zonas) { const q = (z.cuadras || []).find(x => x.id === v.cuadra_id); if (q) return { z, q }; }
    return { z: null, q: { calle: v.calle } };
  }
  function modalEditar(v) {
    const { q } = zonaYCuadraDe(v);
    const meses = v.venta_desde ? Math.max(0, Math.round(diasDesde(v.venta_desde) / 30.44)) : '';
    const opt = (val, txt) => `<option value="${esc(val)}" ${v.resultado === val ? 'selected' : ''}>${esc(txt)}</option>`;
    modal(`<h3>Editar casa</h3><p class="muted" style="margin:0 0 4px;font-size:13px">${esc(v.calle)} ${v.altura ?? ''}${q.mano ? ` · tu zona trabaja la mano ${q.mano}` : ''}</p>
      <div class="vform" data-form="edit" data-id="${v.id}" data-meses="${meses}" style="border:0;padding:0;margin-top:6px">
        <div class="grid2"><div><label class="f">Altura</label><input class="i" name="altura" type="number" inputmode="numeric" value="${v.altura ?? ''}"></div>
          <div><label class="f">Resultado</label><select class="i" name="resultado">${opt('', '—')}${RESULTADOS.map(r => opt(r, r)).join('')}${v.resultado && !RESULTADOS.includes(v.resultado) ? opt(v.resultado, v.resultado) : ''}</select></div></div>
        <label class="f">Propietario</label><input class="i" name="propietario" value="${esc(v.propietario || '')}" autocomplete="off">
        <label class="f">Teléfono celular</label><input class="i" name="telefono" type="tel" inputmode="tel" value="${esc(v.telefono || '')}" placeholder="Ej: 11 6494 9902 · característica + número, sin 0 ni 15" autocomplete="off"><div class="telhint" data-telhint>${telHint(v.telefono)}</div>
        <label class="f">¿En venta con colega?</label>
        <div class="sino"><label><input type="radio" name="colega_edit" value="no" data-colega ${v.en_venta_colega ? '' : 'checked'}><span>No</span></label><label><input type="radio" name="colega_edit" value="si" data-colega ${v.en_venta_colega ? 'checked' : ''}><span>Sí</span></label></div>
        <div class="colega-campos ${v.en_venta_colega ? '' : 'hidden'}">
          <label class="f">¿Hace cuánto está a la venta?</label>
          <div class="row" style="flex-wrap:nowrap"><input class="i" name="venta_cant" type="number" min="0" inputmode="numeric" value="${meses}" style="flex:1"><select class="i" name="venta_unidad" style="flex:1"><option value="30.44">meses</option><option value="1">días</option><option value="365.25">años</option></select></div>
          <label class="f">Inmobiliaria que la tiene</label><input class="i" name="venta_inmobiliaria" value="${esc(v.venta_inmobiliaria || '')}" placeholder="Escribí el nombre de la firma colega" autocomplete="off">
          <label class="f">Valor publicado (USD)</label><input class="i" name="venta_valor" type="number" min="0" inputmode="numeric" value="${v.venta_valor ?? ''}">
        </div>
        <label class="f">Notas</label><input class="i" name="notas" value="${esc(v.notas || '')}" autocomplete="off">
        <label class="f">Fotos (hasta 3)</label>
        <div class="fotos" data-exist>${(v.fotos || []).map(f => `<span class="pv"><img data-foto="${esc(f)}" alt=""><button type="button" data-quitarexist="${esc(f)}">✕</button></span>`).join('')}</div>
        <label class="btn sm fotobtn" style="margin-top:6px">📷 Agregar fotos<input type="file" accept="image/*" multiple data-fotos hidden></label>
        <div class="fotos prev" data-prev></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Para registrar novedades con fecha (llamados, cambios de precio), usá <b>🗒 Seguimiento</b>.</p>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost" data-a="cerrarModal">Cancelar</button><button class="btn primary" data-a="guardarEdicion" data-id="${v.id}">Guardar cambios</button></div>
      </div>`);
    const form = $('#modalCard [data-form="edit"]'); form._exist = [...(v.fotos || [])]; form._fotos = [];
    cargarFotos($('#modalCard'));
  }
  async function refrescar() {
    if (!esAdmin()) return refrescarAsesor();
    await recargar();
    const zid = S.zonaAbierta, y = $('#sheetBody') ? $('#sheetBody').scrollTop : 0;
    if (S.vista === 'mapa') { dibujarZonas(); herramientasMapa(); } else renderAdmin();
    if (zid) { abrirZona(zid); $('#sheetBody').scrollTop = y; }
  }

  async function refrescarSinRecargar() { const y = window.scrollY; renderAsesor(); window.scrollTo(0, y); }
  async function refrescarVista() {
    const zid = S.zonaAbierta, y = $('#sheetBody') ? $('#sheetBody').scrollTop : 0;
    if (zid) { abrirZona(zid); $('#sheetBody').scrollTop = y; } else if (S.vista === 'oport') { const yy = window.scrollY; pintarResultados(); window.scrollTo(0, yy); }
  }
  async function refrescarAsesor() {
    await recargar();
    const y = window.scrollY; renderAsesor(); window.scrollTo(0, y);
  }

  // =====================================================================
  //  EVENTOS
  // =====================================================================
  document.addEventListener('click', async e => {
    const t = e.target;
    const v = t.closest('[data-v]'); if (v) { if (S.dibujo) terminarDibujo(true); cerrarSheet(); S.vista = v.dataset.v; renderAdmin(); return; }
    const f = t.closest('[data-f]'); if (f) { S.filtro = f.dataset.f; vistaZonas(); return; }
    const cat = t.closest('[data-cat]'); if (cat) { S.bus.cat = cat.dataset.cat; S.bus.n = 40; pintarResultados(); return; }
    const at = t.closest('[data-atab]'); if (at) { S.asesorTab = at.dataset.atab; window.scrollTo(0, 0); renderAsesor(); return; }
    const per = t.closest('[data-per]'); if (per) { S.periodo = per.dataset.per; vistaAsesores(); return; }
    const tab = t.closest('[data-tab]'); if (tab) { S.tabZona = tab.dataset.tab; abrirZona(S.zonaAbierta); return; }
    const as = t.closest('[data-asig]'); if (as) { S.asigSel = as.dataset.asig; S.abiertas.clear(); S.cuadraAbierta = null; renderAsesor(); return; }
    const cq = t.closest('[data-cuadra]'); if (cq) { const id = cq.dataset.cuadra; S.cuadraAbierta = S.cuadraAbierta === id ? null : id; document.querySelectorAll('.cuadra.open').forEach(x => x.classList.remove('open')); if (S.cuadraAbierta) document.getElementById('c_' + id)?.classList.add('open'); return; }
    const sw = t.closest('[data-color]'); if (sw && S.nueva) { S.nueva.color = sw.dataset.color; document.querySelectorAll('#zColores [data-color]').forEach(b => b.style.borderColor = b === sw ? '#fff' : 'transparent'); if (S.capas.preview) S.capas.preview.setStyle({ color: S.nueva.color }); return; }
    const zc = t.closest('[data-zona]'); if (zc && !t.closest('[data-a]')) {
      e.preventDefault();
      const id = zc.dataset.zona;
      if (S.vista !== 'mapa') { S.vista = 'mapa'; renderAdmin(); }
      setTimeout(() => abrirZona(id), 60); return;
    }
    const b = t.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    const zona = () => S.d.zonas.find(x => x.id === S.zonaAbierta);
    const asigZ = () => vigente(S.zonaAbierta);
    switch (a) {
      case 'cuenta': modalCuenta(); break;
      case 'cerrarModal': cerrarModal(); break;
      case 'salir': { cerrarModal(); try { await S.be.logout(); } catch (er) { break; } destruirMapa(); cerrarSheet(); S.yo = null; S.d = null; dibujarZonas._fit = false; pantallaLogin(); break; }
      case 'instalar': await instalar(); break;
      case 'ocultarInstalar': try { localStorage.setItem('farming_no_instalar', '1'); } catch { } b.closest('.instalar-card')?.remove(); break;
      case 'reiniciarDemo': if (await confirmar('Borrar demo', 'Se eliminan todas las zonas y asesores de prueba de este navegador.', 'Borrar', true)) { S.be.reiniciar(); location.reload(); } break;
      case 'cambiarPass': {
        const p1 = $('#np1').value, p2 = $('#np2').value;
        if (p1.length < 6) return toast('Mínimo 6 caracteres', true);
        if (p1 !== p2) return toast('Las contraseñas no coinciden', true);
        await conCarga(b, async () => { await S.be.cambiarPassword(p1); cerrarModal(); toast('Contraseña actualizada'); });
        break;
      }
      case 'cerrarSheet': cerrarSheet(); break;
      case 'dibujar': if (S.dibujo) terminarDibujo(true); S.nueva = null; iniciarDibujo(); break;
      case 'deshacer': { const D = S.dibujo; if (!D || !D.pts.length) break; D.pts.pop(); S.map.removeLayer(D.markers.pop()); redibujarTrazo(); barraDibujo(); break; }
      case 'cancelarDibujo': terminarDibujo(true); break;
      case 'terminarDibujo': { const pts = terminarDibujo(); if (pts && pts.length >= 3) nuevaZona(pts, [], null); break; }
      case 'porCalles': if (S.dibujo) terminarDibujo(true); sheetPorCalles(); break;
      case 'masCalle': { const c = $('#callesIn'); c.insertAdjacentHTML('beforeend', filaCalle(c.children.length)); c.lastElementChild.querySelector('input').focus(); break; }
      case 'trazarCalles': trazarCalles(b); break;
      case 'reintentarCalles': prepararCallejero(); break;
      case 'volverCalles': sheetPorCalles(S.nueva?.valoresCalles); limpiarCapa('preview'); break;
      case 'cancelarNueva': S.nueva = null; cerrarSheet(); break;
      case 'reintentarCuadras': if (S.nueva) nuevaZona(S.nueva.ring, S.nueva.calles_limite, S.nueva.valoresCalles); break;
      case 'guardarZona': guardarZona(b); break;
      case 'asignar': sheetAsignar(S.zonaAbierta); break;
      case 'asignarZ': sheetAsignar(b.dataset.z); break;
      case 'confirmarAsignar': confirmarAsignar(b); break;
      case 'renovar': case 'renovarZ': {
        const zid = b.dataset.z || S.zonaAbierta; const asg = vigente(zid); const z = S.d.zonas.find(x => x.id === zid);
        if (!asg) break;
        if (!await confirmar('Renovar plazo', `${esc(nombre(perfil(asg.asesor_id)))} conserva <b>${esc(z.nombre)}</b> por 90 días más, a partir de hoy.`, 'Renovar')) break;
        await conCarga(b, async () => { await S.be.renovar(asg); await recargar(); toast('Plazo renovado por 90 días'); if (S.vista === 'zonas') renderAdmin(); else { dibujarZonas(); herramientasMapa(); abrirZona(zid); } });
        break;
      }
      case 'liberar': {
        const asg = asigZ(); if (!asg) break;
        if (!await confirmar('Liberar zona', 'La zona queda sin asesor. Todo lo que cargó queda guardado en el historial.', 'Liberar', true)) break;
        await conCarga(b, async () => { await S.be.liberar(asg); await recargar(); dibujarZonas(); herramientasMapa(); abrirZona(S.zonaAbierta); toast('Zona liberada'); });
        break;
      }
      case 'simVencer': S.be.simularVencimiento(asigZ().id); await recargar(); dibujarZonas(); herramientasMapa(); abrirZona(S.zonaAbierta); renderAdmin(); break;
      case 'borrarZona': {
        const z = zona();
        if (!await confirmar('Eliminar zona', `Se borra <b>${esc(z.nombre)}</b> con todo su historial, casas y jornadas cargadas. No se puede deshacer.`, 'Eliminar', true)) break;
        await conCarga(b, async () => { await S.be.borrarZona(z.id); await recargar(); cerrarSheet(); dibujarZonas(); herramientasMapa(); toast('Zona eliminada'); });
        break;
      }
      case 'csv': { const z = zona(); const asg = asigZ(); if (z && asg) csv(z, asg); break; }
      case 'numOficial': {
        const z = zona();
        await conCarga(b, async () => {
          const cuadras = await numeracionOficial(JSON.parse(JSON.stringify(z.cuadras)), anilloZona(z));
          const n = cuadras.filter(q => q.desde != null).length, nm = cuadras.filter(q => q.mano).length;
          await S.be.guardarZona({ ...z, cuadras }); await recargar(); abrirZona(z.id);
          toast(S.motivoNum ? `No se pudo consultar la numeración oficial (${S.motivoNum})` : `${n} de ${cuadras.length} cuadras con numeración · ${nm} del límite con mano asignada`, !!S.motivoNum);
        });
        break;
      }
      case 'mano': {
        const z = zona(); const cuadras = JSON.parse(JSON.stringify(z.cuadras)); const q = cuadras.find(x => x.id === b.dataset.q);
        q.mano = q.mano === 'par' ? 'impar' : q.mano === 'impar' ? undefined : 'par';
        if (!q.mano) delete q.mano;
        await conCarga(null, async () => { await S.be.guardarZona({ ...z, cuadras }); await recargar(); abrirZona(z.id); });
        break;
      }
      case 'calibrar': case 'invertir': {
        const z = zona(); const calle = b.dataset.calle;
        const inp = [...document.querySelectorAll('[data-calib]')].find(i => i.dataset.calib === calle);
        const base = inp && inp.value !== '' ? Math.floor(Number(inp.value) / 100) * 100 : null;
        if (a === 'calibrar' && base == null) return toast('Escribí la altura de la primera cuadra', true);
        const cuadras = JSON.parse(JSON.stringify(z.cuadras));
        const cs = cuadras.filter(q => q.calle === calle).sort((x, y) => x.orden - y.orden);
        const b0 = base != null ? base : (cs[0] && cs[0].desde != null ? cs[0].desde : null);
        Geo.calibrarCalle(cuadras, calle, b0, a === 'invertir');
        await conCarga(b, async () => { await S.be.guardarZona({ ...z, cuadras }); await recargar(); abrirZona(z.id); toast('Numeración actualizada'); });
        break;
      }
      case 'reset': {
        const p = perfil(b.dataset.p);
        if (!await confirmar('Reenviar acceso', `Se genera una contraseña nueva para ${esc(nombre(p))} y se le envía por mail.`, 'Generar')) break;
        await conCarga(b, async () => { const r = await S.be.resetAcceso(p.id); mostrarResultadoAcceso({ ...r, asesor: p }, null); });
        break;
      }
      // ---- asesor ----
      case 'hMenos': case 'hMas': { const i = $('#jHoras'); i.value = Math.max(0.5, Math.min(24, (Number(i.value) || 0) + (a === 'hMas' ? 0.5 : -0.5))); break; }
      case 'addJornada': {
        const horas = Number($('#jHoras').value), fechaJ = $('#jFecha').value;
        if (!(horas > 0 && horas <= 24)) return toast('Indicá las horas (entre 0,5 y 24)', true);
        if (!fechaJ) return toast('Elegí el día', true);
        await conCarga(b, async () => { await S.be.agregar('jornadas', { asignacion_id: S.asigSel, fecha: fechaJ, horas, notas: $('#jNotas').value.trim() }); toast(S.be.offline || !navigator.onLine ? 'Jornada guardada en el celular · se sube sola' : 'Jornada registrada'); await refrescarAsesor(); });
        break;
      }
      case 'delJornada': if (await confirmar('Borrar jornada', '¿Seguro?', 'Borrar', true)) { await conCarga(null, async () => { await S.be.borrar('jornadas', b.dataset.id); await refrescarAsesor(); }); } break;
      case 'verTodasJ': S.verTodasJ = true; renderAsesor(); break;
      case 'addVisita': {
        const form = b.closest('[data-form]'); const qid = b.dataset.q;
        const z = S.d.zonas.find(x => (x.cuadras || []).some(q => q.id === qid)); const q = z.cuadras.find(x => x.id === qid);
        const val = n => form.querySelector(`[name=${n}]`).value.trim();
        const altura = val('altura') ? parseInt(val('altura'), 10) : null;
        if (!altura && !val('propietario') && !val('telefono')) return toast('Cargá al menos la altura de la casa', true);
        if (altura && q.mano && (altura % 2 === 0 ? 'par' : 'impar') !== q.mano) {
          if (!await confirmar('Vereda de la zona vecina', `En ${esc(q.calle)} tu zona trabaja sólo la <b>mano ${q.mano}</b>. El ${altura} está en la vereda de enfrente, que corresponde a la zona vecina. ¿Querés cargarla igual?`, 'Cargar igual')) return;
        }
        const colega = form.querySelector('[data-colega]:checked')?.value === 'si';
        let venta = { en_venta_colega: false, venta_desde: null, venta_inmobiliaria: '', venta_valor: null };
        if (colega) {
          const cant = Number(val('venta_cant'));
          if (!val('venta_inmobiliaria')) return toast('Indicá qué inmobiliaria la tiene a la venta', true);
          if (!(cant >= 0) || val('venta_cant') === '') return toast('Indicá hace cuánto está a la venta', true);
          const dias = Math.round(cant * Number(val('venta_unidad')));
          const d = new Date(Date.now() - dias * DIA); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          venta = { en_venta_colega: true, venta_desde: d.toISOString().slice(0, 10), venta_inmobiliaria: val('venta_inmobiliaria'), venta_valor: val('venta_valor') ? Number(val('venta_valor')) : null };
        }
        const archivos = (form._fotos || []).slice(0, 3);
        await conCarga(b, async () => {
          const fotos = [];
          for (const f of archivos) fotos.push(await S.be.subirFoto(await comprimir(f)));
          await S.be.agregar('visitas', { asignacion_id: S.asigSel, cuadra_id: qid, calle: q.calle, altura, propietario: val('propietario'), telefono: val('telefono'), resultado: val('resultado'), notas: val('notas'), fecha: hoyISO(), ...venta, fotos });
          S.cuadraAbierta = qid; S.abiertas.add(q.calle);
          toast(S.be.offline || !navigator.onLine ? 'Guardada en el celular · se sube sola cuando vuelva la señal' : 'Casa guardada'); await refrescarAsesor();
        });
        break;
      }
      case 'csvBusqueda': csvContactos(filtrarContactos().lista); break;
      case 'verMasBusqueda': S.bus.n += 40; pintarResultados(); break;
      case 'limpiarBusqueda': S.bus = null; vistaOportunidades(); break;
      case 'editarCasa': { const v = S.d.visitas.find(x => x.id === b.dataset.id); if (v) modalEditar(v); break; }
      case 'guardarEdicion': {
        const form = b.closest('[data-form]'); const v = S.d.visitas.find(x => x.id === b.dataset.id); if (!v) break;
        const { q } = zonaYCuadraDe(v);
        const val = n => form.querySelector(`[name=${n}]`).value.trim();
        const altura = val('altura') ? parseInt(val('altura'), 10) : null;
        if (!altura && !val('propietario') && !val('telefono')) return toast('Dejá al menos la altura de la casa', true);
        if (!esAdmin() && altura && q.mano && altura !== v.altura && (altura % 2 === 0 ? 'par' : 'impar') !== q.mano) {
          if (!await confirmar('Vereda de la zona vecina', `En ${esc(q.calle)} tu zona trabaja sólo la <b>mano ${q.mano}</b>. ¿Guardar igual el ${altura}?`, 'Guardar igual')) { modalEditar(v); return; }
        }
        const colega = form.querySelector('[data-colega]:checked')?.value === 'si';
        let venta = { en_venta_colega: false, venta_desde: null, venta_inmobiliaria: '', venta_valor: null };
        if (colega) {
          if (!val('venta_inmobiliaria')) return toast('Indicá qué inmobiliaria la tiene a la venta', true);
          if (val('venta_cant') === '' || !(Number(val('venta_cant')) >= 0)) return toast('Indicá hace cuánto está a la venta', true);
          let desde = v.venta_desde;
          const sinCambio = v.venta_desde && val('venta_cant') === String(form.dataset.meses) && val('venta_unidad') === '30.44';
          if (!sinCambio) { const d = new Date(Date.now() - Math.round(Number(val('venta_cant')) * Number(val('venta_unidad'))) * DIA); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); desde = d.toISOString().slice(0, 10); }
          venta = { en_venta_colega: true, venta_desde: desde, venta_inmobiliaria: val('venta_inmobiliaria'), venta_valor: val('venta_valor') ? Number(val('venta_valor')) : null };
        }
        const exist = form._exist || [], nuevas = (form._fotos || []).slice(0, Math.max(0, 3 - exist.length));
        const quitadas = (v.fotos || []).filter(f => !exist.includes(f));
        await conCarga(b, async () => {
          const fotos = [...exist];
          for (const f of nuevas) fotos.push(await S.be.subirFoto(await comprimir(f)));
          await S.be.editar('visitas', v.id, { altura, propietario: val('propietario'), telefono: val('telefono'), resultado: val('resultado'), notas: val('notas'), ...venta, fotos });
          if (quitadas.length) S.be.borrarFotos(quitadas);
          cerrarModal(); toast('Cambios guardados'); await refrescar();
        });
        break;
      }
      case 'verNotas': { const id = b.dataset.id; S.notasAbiertas.has(id) ? S.notasAbiertas.delete(id) : S.notasAbiertas.add(id); await (esAdmin() ? refrescarVista() : refrescarSinRecargar()); break; }
      case 'addNota': {
        const id = b.dataset.id; const ta = document.querySelector(`[data-nota="${id}"]`); const texto = (ta?.value || '').trim();
        if (!texto) return toast('Escribí la nota', true);
        const hable = document.querySelector(`[data-hable="${id}"]`)?.checked;
        await conCarga(b, async () => {
          await S.be.agregar('notas', { visita_id: id, texto, fecha: hoyISO(), autor_nombre: nombre(S.yo) });
          if (hable) await S.be.editar('visitas', id, { ultimo_contacto: hoyISO() });
          S.notasAbiertas.add(id); toast('Nota agregada'); await refrescar();
        });
        break;
      }
      case 'delNota': if (await confirmar('Borrar nota', '¿Seguro que querés borrar esta nota?', 'Borrar', true)) { await conCarga(null, async () => { await S.be.borrar('notas', b.dataset.id); await refrescar(); }); } break;
      case 'retomar': {
        const v = S.d.visitas.find(x => x.id === b.dataset.id); if (!v) break;
        if (!await confirmar('Retomar contacto', `${esc(v.propietario || 'Este contacto')} (${esc(v.calle)} ${v.altura ?? ''}) pasa a tu lista para que le hagas seguimiento. Su historial de notas queda a la vista.`, 'Retomar')) break;
        await conCarga(null, async () => {
          await S.be.agregar('visitas', { asignacion_id: S.asigSel, cuadra_id: v.cuadra_id, calle: v.calle, altura: v.altura, propietario: v.propietario || '', telefono: v.telefono || '', resultado: v.resultado || '', notas: v.notas || '', fecha: hoyISO(),
            en_venta_colega: !!v.en_venta_colega, venta_desde: v.venta_desde || null, venta_inmobiliaria: v.venta_inmobiliaria || '', venta_valor: v.venta_valor ?? null, fotos: [], previa_id: v.id });
          toast('Contacto retomado'); await refrescarAsesor();
        });
        break;
      }
      case 'contactado': await conCarga(b, async () => { await S.be.editar('visitas', b.dataset.id, { ultimo_contacto: hoyISO() }); toast(`Listo. Te recordamos de nuevo en ${SEGUIR_CADA} días`); await refrescarAsesor(); }); break;
      case 'togglePend': S.verPend = !S.verPend; renderAsesor(); break;
      case 'soloPend': { S.soloPend = !S.soloPend; const a2 = S.d.asignaciones.find(x => x.id === S.asigSel); const z2 = S.d.zonas.find(x => x.id === a2.zona_id); b.classList.toggle('primary', S.soloPend); b.textContent = (S.soloPend ? '✓ ' : '') + 'Pendientes'; renderCalles(z2, a2); break; }
      case 'etapa': {
        const id = b.dataset.id, et = b.dataset.e; const v = S.d.visitas.find(x => x.id === id); if (!v) break;
        if (etapaDe(v) === et) break;
        const textos = { contacto: 'Volver la etapa a <b>Contacto</b>.', tasacion: 'Marcar que se hizo la <b>tasación</b> de esta propiedad.', captacion: '🏆 Marcar la <b>captación firmada</b> (autorización de venta). Deja de recordarte llamarlo.' };
        if (!await confirmar('Etapa: ' + ETAPAS.find(x => x[0] === et)[1], textos[et], 'Confirmar')) break;
        const cambio = { etapa: et };
        if (et === 'tasacion' && !v.tasacion_fecha) cambio.tasacion_fecha = hoyISO();
        if (et === 'captacion') cambio.captacion_fecha = hoyISO();
        if (et === 'contacto') { cambio.captacion_fecha = null; cambio.tasacion_fecha = null; }
        if (et === 'tasacion') cambio.captacion_fecha = null;
        await conCarga(null, async () => { await S.be.editar('visitas', id, cambio); toast(et === 'captacion' ? '🏆 ¡Captación registrada!' : 'Etapa actualizada'); await refrescar(); });
        break;
      }
      case 'delVisita': if (await confirmar('Borrar casa', '¿Seguro que querés borrar este registro?', 'Borrar', true)) { await conCarga(null, async () => { await S.be.borrar('visitas', b.dataset.id); await refrescarAsesor(); }); } break;
    }
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') cerrarModal(); });
  document.addEventListener('input', e => {
    if (e.target.matches('[data-form] [name=telefono]')) { const h = e.target.parentElement.querySelector('[data-telhint]'); if (h) h.innerHTML = telHint(e.target.value); }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-b]') && S.bus) { S.bus[t.dataset.b] = t.value; if (t.dataset.b === 'calle') { S.bus.cuadra = ''; } if (t.dataset.b === 'zona') { S.bus.calle = ''; S.bus.cuadra = ''; } S.bus.n = 40; if (t.dataset.b === 'calle' || t.dataset.b === 'zona') vistaOportunidades(); else pintarResultados(); return; }
    if (t.matches('[data-colega]')) {
      const form = t.closest('[data-form]');
      form.querySelector('.colega-campos').classList.toggle('hidden', t.value !== 'si');
    }
    if (t.matches('[data-fotos]')) {
      const form = t.closest('[data-form]');
      const nuevas = [...t.files].filter(f => f.type.startsWith('image/'));
      form._fotos = [...(form._fotos || []), ...nuevas];
      const lugar = 3 - (form._exist ? form._exist.length : 0);
      if (form._fotos.length > lugar) { toast('Máximo 3 fotos por casa', true); form._fotos = form._fotos.slice(0, Math.max(0, lugar)); }
      t.value = '';
      pintarPrevias(form);
    }
  });
  function pintarPrevias(form) {
    const prev = form.querySelector('[data-prev]');
    prev.innerHTML = (form._fotos || []).map((f, i) => `<span class="pv"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-quitar="${i}">✕</button></span>`).join('');
  }
  document.addEventListener('click', e => {
    const q = e.target.closest('[data-quitar]');
    if (q) { const form = q.closest('[data-form]'); form._fotos.splice(Number(q.dataset.quitar), 1); pintarPrevias(form); return; }
    const qe = e.target.closest('[data-quitarexist]');
    if (qe) { const form = qe.closest('[data-form]'); form._exist = form._exist.filter(f => f !== qe.dataset.quitarexist); qe.closest('.pv').remove(); return; }
    const img = e.target.closest('img[data-foto]');
    if (img && img.src && !img.closest('[data-form="edit"]')) modal(`<img src="${img.src}" style="width:100%;border-radius:10px;display:block" alt="Foto"><button class="btn block" style="margin-top:12px" data-a="cerrarModal">Cerrar</button>`);
  });

  // Refrescar contadores cada minuto
  setInterval(() => {
    if (!S.yo || !S.d || $('#modal').classList.contains('open')) return;
    if (S.yo.rol === 'admin' && S.vista === 'mapa' && !S.dibujo && S.map) { herramientasMapa(); }
  }, 60000);

  init();
})();
