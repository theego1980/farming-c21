/* ======================================================================
   FARMING · C21 Inmopul Devoto — aplicación
   ====================================================================== */
(function () {
  'use strict';
  const DIA = 864e5;
  const COLORES = ['#BEAF87', '#5B8DEF', '#E07A5F', '#81B29A', '#C38FD8', '#F2CC8F', '#4FB0C6', '#E76F9A', '#7FB069', '#B0A8E8', '#E9B44C', '#9AA0A6'];
  const RESULTADOS = ['Interesado en vender', 'No quiere vender', 'Interesado en tasar', 'Contacto con propietario', 'Volver a visitar', 'No atendió', 'Inquilino'];
  const SEGUIR_CADA = 15; // días entre recordatorios de seguimiento
  const CENTRO = [-34.598, -58.505];

  const S = { be: null, yo: null, d: null, vista: 'mapa', filtro: 'todas', barrios: [], callejero: null, callejeroP: null,
    map: null, capas: {}, dibujo: null, zonaAbierta: null, tabZona: 'actividad', asigSel: null, abiertas: new Set(), cuadraAbierta: null, buscar: '' };

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
  const enSeguimiento = v => v.resultado === 'Interesado en vender' || !!v.en_venta_colega;
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

  // Tarjeta de una casa visitada (la usan el broker y el asesor)
  function tarjetaVisita(v, { calle, puede, extra = '' } = {}) {
    const prox = enSeguimiento(v) ? proximoContacto(v) : null;
    return `<div class="vis">
      <div class="h"><b>${esc(calle || v.calle)} ${v.altura ?? 's/n'}</b><span class="muted" style="font-size:12px">${fecha(v.fecha)}</span>${puede ? `<button class="x" data-a="delVisita" data-id="${v.id}" title="Borrar">✕</button>` : ''}</div>
      ${v.propietario || v.telefono ? `<div>${esc(v.propietario)}${v.telefono ? ` · <a href="tel:${esc(v.telefono)}">${esc(v.telefono)}</a>` : ''}</div>` : ''}
      ${v.resultado ? `<div class="r">${esc(v.resultado)}</div>` : ''}
      ${v.en_venta_colega ? `<div class="colega"><div>En venta con <b>${esc(v.venta_inmobiliaria || 'otra inmobiliaria')}</b>${v.venta_valor ? ` · <b>${usd(v.venta_valor)}</b>` : ''}</div>
        ${v.venta_desde ? `<div class="reloj">⏱ Lleva <b>${tiempoVenta(v.venta_desde)}</b> a la venta <span class="muted">(desde ${fechaL(v.venta_desde + 'T12:00:00')})</span></div>` : ''}</div>` : ''}
      ${v.notas ? `<div class="muted" style="font-size:13px">${esc(v.notas)}</div>` : ''}
      ${(v.fotos || []).length ? `<div class="fotos">${v.fotos.map(f => `<img data-foto="${esc(f)}" alt="Foto de la casa">`).join('')}</div>` : ''}
      ${prox != null ? `<div class="seg ${prox <= 0 ? 'hoy' : ''}"><span>${prox <= 0 ? '☎ Toca llamar' : `☎ Próximo llamado en ${prox} ${prox === 1 ? 'día' : 'días'}`}${v.ultimo_contacto ? ` · últ. contacto ${fecha(v.ultimo_contacto)}` : ''}</span>
        ${puede ? `<button class="btn sm" data-a="contactado" data-id="${v.id}">✓ Contactado</button>` : ''}</div>` : ''}
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
    const s = $('#sheet'); s.classList.add('open'); s.classList.toggle('tall', !!tall); s.setAttribute('aria-hidden', 'false');
  }
  function cerrarSheet() {
    $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true');
    S.zonaAbierta = null; limpiarCapa('cuadras'); limpiarCapa('preview');
  }
  async function conCarga(btn, fn) {
    const t = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'; }
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || 'Error', true); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = t; } }
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
    const d = Math.ceil(ms / DIA);
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
      ultima: fechas.length ? fechas[fechas.length - 1] : null, v, j,
    };
  }
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
    S.be = await Datos.crearBackend();
    S.yo = await S.be.perfil().catch(() => null);
    if (!S.yo) return pantallaLogin();
    await entrar();
  }
  async function entrar() {
    try { await recargar(); } catch (e) { toast('No pude cargar los datos: ' + e.message, true); }
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
      ${S.be.modo === 'demo' ? '<span class="chip-demo">DEMO</span>' : ''}</div>
      ${navHtml || '<div style="margin-left:auto"></div>'}
      <button class="iconbtn" data-a="cuenta" title="Mi cuenta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></button></header>`;
  }

  function modalCuenta() {
    modal(`<h3>Mi cuenta</h3><p class="muted" style="margin:0">${esc(nombre(S.yo))} · ${esc(S.yo.email)}</p>
      ${S.be.modo === 'supabase' ? `<label class="f">Nueva contraseña</label><input class="i" type="password" id="np1" minlength="6">
      <label class="f">Repetila</label><input class="i" type="password" id="np2" minlength="6">
      <button class="btn block" style="margin-top:12px" data-a="cambiarPass">Cambiar contraseña</button>` : ''}
      ${S.be.modo === 'demo' && S.yo.rol === 'admin' ? '<button class="btn danger block" style="margin-top:12px" data-a="reiniciarDemo">Borrar datos de la demostración</button>' : ''}
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
      <button class="${S.vista === 'oport' ? 'on' : ''}" data-v="oport">Oportunidades${np ? `<span class="dot warn">${np}</span>` : ''}</button>
      <button class="${S.vista === 'asesores' ? 'on' : ''}" data-v="asesores">Asesores</button></nav>`;
    if (S.vista === 'mapa') {
      if (!S.map || !document.getElementById('map')) {
        $('#app').innerHTML = topbar(nav) + `<main><div class="map-wrap"><div id="map"></div>
          <div class="map-tools" id="mapTools"></div><div class="map-alert" id="mapAlert"></div><div id="drawBar"></div></div></main>`;
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
      msg.innerHTML = '<div class="note" style="margin-top:12px">Descargando las calles de los tres barrios… <b>0 s</b><br><span style="font-size:12px">Sólo la primera vez. Puede tardar hasta un minuto; podés tocar “Trazar zona” igual y espera solo.</span></div>';
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
      cuadras = await numeracionOficial(cuadras);
      if (!S.nueva || S.nueva.ring !== ring) return;
      S.nueva.cuadras = cuadras;
      const calles = new Set(cuadras.map(q => q.calle));
      const conAltura = cuadras.filter(q => q.desde != null).length;
      $('#zCuadras').innerHTML = `<b>${calles.size} calles · ${cuadras.length} cuadras</b><br><span style="font-size:12px">${conAltura === cuadras.length ? 'Todas con numeración.' : `${conAltura} con numeración. Las demás se ordenan por recorrido y podés fijar la altura después, en la pestaña “Cuadras”.`}</span>${S.motivoNum ? `<div style="font-size:11px;margin-top:6px;opacity:.75">No se pudo consultar la numeración oficial (${esc(S.motivoNum)}).</div>` : ''}`;
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
  async function numeracionOficial(cuadras) {
    const puntos = cuadras.map(q => Geo.midpoint(q.coords));
    let res = null, motivo = '';
    try {
      const r = await S.be.alturasOficiales(puntos);
      if (r) { res = r.resultados; if (r.errores && r.errores.length) motivo = 'servidor: ' + r.errores.join(', '); }
    } catch (e) { motivo = 'servidor: ' + e.message; }
    if (S.be.modo === 'supabase' && (!res || !res.some(Boolean))) {
      try { res = await usigDirecto(puntos); } catch (e) { motivo += (motivo ? ' · ' : '') + 'navegador: ' + e.message; }
    }
    if (!res || !res.some(Boolean)) { S.motivoNum = motivo || 'el servicio de la Ciudad no devolvió alturas'; return cuadras; }
    S.motivoNum = '';
    return Geo.aplicarAlturasOficiales(cuadras, res).cuadras;
  }

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
      el.innerHTML = `${S.be.modo === 'supabase' ? `<button class="btn sm ${sinNum ? 'primary' : ''} block" style="margin-bottom:12px" data-a="numOficial">↻ Buscar numeración oficial${sinNum ? ` (${sinNum} cuadras sin altura)` : ''}</button>` : ''}
        <p class="muted" style="font-size:13px;line-height:1.5;margin:0 0 12px">Si la numeración de una calle no es correcta, escribí la altura de su <b>primera cuadra</b> y tocá Aplicar. Con ⇅ invertís el sentido.</p>
        ${porCalle.map(([calle, qs]) => `<details class="calle"><summary>${esc(calle)}${qs.some(q => q.perimetral) ? '<span class="perim">LÍMITE</span>' : ''}<span class="cnt">${qs.length}</span></summary>
          <div style="padding:0 14px 12px"><div class="calib"><input class="i" type="number" step="100" placeholder="Ej: 3200" value="${qs[0].desde ?? ''}" data-calib="${esc(calle)}"><button class="btn sm" data-a="calibrar" data-calle="${esc(calle)}">Aplicar</button><button class="btn sm ghost" data-a="invertir" data-calle="${esc(calle)}" title="Invertir sentido">⇅</button></div>
          <table class="t">${qs.map(q => `<tr><td><b>${q.desde != null ? `${q.desde}–${q.hasta}` : `Cuadra ${q.orden}`}</b>${q.aprox ? ' <span class="muted">aprox.</span>' : ''}</td><td class="muted">${esc(entreTxt(q))}</td></tr>`).join('')}</table></div></details>`).join('')}`;
    } else {
      const hist = S.d.asignaciones.filter(x => x.zona_id === z.id).sort((x, y) => y.inicio.localeCompare(x.inicio));
      el.innerHTML = hist.length ? hist.map(h => { const st = stats([h.id]); const e = estadoAsig(h); return `<div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div class="row" style="justify-content:space-between"><b>${esc(nombre(perfil(h.asesor_id)))}</b>${e === 'finalizada' ? `<span class="badge">${h.motivo_fin === 'liberada' ? 'Liberada' : 'Reasignada'}</span>` : badge(e, false, h)}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">${fechaL(h.inicio)} → ${h.finalizada ? fechaL(h.finalizada) : fechaL(h.vence)}${h.renovaciones ? ` · ${h.renovaciones} renovación(es)` : ''}</div>
        <div style="font-size:13px;margin-top:6px">${st.visitas} casas · ${st.contactos} con teléfono · ${num(st.horas)} h en ${st.jornadas} jornadas</div></div>`; }).join('') : '<p class="empty">Sin historial.</p>';
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
    const filas = [['Fecha', 'Calle', 'Altura', 'Propietario', 'Teléfono', 'Resultado', 'En venta con colega', 'Inmobiliaria', 'Valor USD', 'A la venta desde', 'Último contacto', 'Notas', 'Cuadra', 'Asesor']];
    const as = nombre(perfil(a.asesor_id));
    st.v.forEach(v => { const q = qmap.get(v.cuadra_id); filas.push([v.fecha, v.calle, v.altura ?? '', v.propietario, v.telefono, v.resultado, v.en_venta_colega ? 'Sí' : 'No', v.venta_inmobiliaria || '', v.venta_valor ?? '', v.venta_desde || '', v.ultimo_contacto || '', v.notas, q ? entreTxt(q) : '', as]); });
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
        ${st ? `<div class="m"><span>🏠 ${st.visitas} casas</span><span>☎ ${st.contactos}</span><span>⏱ ${num(st.horas)} h</span><span>${st.ultima ? 'Últ. ' + fecha(st.ultima) : 'Sin movimiento'}</span></div>` : ''}
        ${e === 'vencida' ? '<div class="row"><button class="btn sm primary" data-a="renovarZ" data-z="' + z.id + '">Renovar 90 días</button><button class="btn sm" data-a="asignarZ" data-z="' + z.id + '">Asignar a otro</button></div>' : ''}
      </div>`; }).join('') : `<div class="empty"><b>${S.d.zonas.length ? 'No hay zonas con este filtro' : 'Todavía no hay zonas'}</b>${S.d.zonas.length ? '' : 'Andá al mapa para crear la primera.'}</div>`}</div>`;
  }

  // ---------- Vista: oportunidades ----------
  function vistaOportunidades() {
    const el = $('#vista');
    const f = S.filtroOp || 'colega';
    const zonaDe = v => { const a = S.d.asignaciones.find(x => x.id === v.asignacion_id); return { a, z: a ? S.d.zonas.find(z => z.id === a.zona_id) : null }; };
    let lista = S.d.visitas.filter(v => f === 'colega' ? v.en_venta_colega : f === 'vender' ? v.resultado === 'Interesado en vender' : f === 'tasar' ? v.resultado === 'Interesado en tasar' : (enSeguimiento(v) && proximoContacto(v) <= 0));
    if (f === 'colega') lista.sort((a, b) => (a.venta_desde || '9').localeCompare(b.venta_desde || '9'));
    else lista.sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
    const c = k => S.d.visitas.filter(v => k === 'colega' ? v.en_venta_colega : k === 'vender' ? v.resultado === 'Interesado en vender' : k === 'tasar' ? v.resultado === 'Interesado en tasar' : (enSeguimiento(v) && proximoContacto(v) <= 0)).length;
    el.innerHTML = `<h2>Oportunidades</h2>
      <p class="muted" style="font-size:14px;margin:6px 0 0">Las casas en venta con colegas aparecen primero las que llevan más tiempo en el mercado.</p>
      <div class="filters">${[['colega', 'En venta con colegas'], ['vender', 'Quieren vender'], ['tasar', 'Quieren tasar'], ['atrasados', 'Llamados pendientes']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-fop="${k}">${t} (${c(k)})</button>`).join('')}</div>
      ${lista.length ? `<div class="zl">${lista.map(v => { const { a, z } = zonaDe(v); return tarjetaVisita(v, { extra: `<div class="muted" style="font-size:12px;margin-top:2px">${z ? `<a href="#" data-zona="${z.id}">${esc(z.nombre)}</a> · ` : ''}${esc(nombre(perfil(v.asesor_id)))}</div>` }); }).join('')}</div>`
        : '<div class="empty"><b>Nada por acá todavía</b>A medida que los asesores carguen casas, van a aparecer.</div>'}`;
    cargarFotos(el);
  }

  // ---------- Vista: asesores ----------
  function vistaAsesores() {
    const el = $('#vista');
    const ases = S.d.perfiles.filter(p => p.rol !== 'admin').sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'));
    el.innerHTML = `<h2>Asesores <span class="muted" style="font-size:15px;font-weight:500">(${ases.length})</span></h2>
      <p class="muted" style="font-size:14px">Los asesores se dan de alta al asignarles una zona. No hay límite de cantidad.</p>
      <div class="zl">${ases.length ? ases.map(p => {
        const asigs = S.d.asignaciones.filter(a => a.asesor_id === p.id);
        const vig = asigs.filter(a => a.estado !== 'finalizada');
        const st = stats(asigs.map(a => a.id));
        return `<div class="card"><div class="row" style="justify-content:space-between"><div><b style="font-size:16px">${esc(nombre(p))}</b><div class="muted" style="font-size:13px">${esc(p.email)}</div></div>
          <button class="btn sm" data-a="reset" data-p="${p.id}">Reenviar acceso</button></div>
          <div class="row" style="margin-top:10px">${vig.length ? vig.map(a => { const z = S.d.zonas.find(x => x.id === a.zona_id); const e = estadoAsig(a); return z ? `<button class="badge ${e === 'vencida' ? 'vencida' : 'activa'}" style="border:0;cursor:pointer" data-zona="${z.id}">${esc(z.nombre)} · ${e === 'vencida' ? 'vencida' : restante(a).txt}</button>` : ''; }).join('') : '<span class="badge libre">Sin zona vigente</span>'}</div>
          <div class="muted" style="font-size:13px;margin-top:8px">Total histórico: ${st.visitas} casas · ${st.contactos} con teléfono · ${num(st.horas)} h en ${st.jornadas} jornadas</div></div>`;
      }).join('') : '<div class="empty"><b>Todavía no hay asesores</b>Creá una zona en el mapa y asignala: ahí cargás nombre, apellido y correo.</div>'}</div>`;
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
        <div class="al-acc">${v.telefono ? `<a class="btn sm" href="tel:${esc(v.telefono)}">📞 Llamar</a>` : ''}<button class="btn sm primary" data-a="contactado" data-id="${v.id}">✓ Contactado</button></div></div>`; }).join('')}</div>` : ''}
    </div>` : '';
    $('#app').innerHTML = topbar() + `<main><div class="wrap">
      ${vig.length > 1 ? `<div class="filters">${vig.map(x => `<button class="${x.id === a.id ? 'on' : ''}" data-asig="${x.id}">${esc(S.d.zonas.find(z => z.id === x.zona_id)?.nombre || 'Zona')}</button>`).join('')}</div>` : ''}
      ${banner}
      <div class="card">
        <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:1px">TU ZONA</div>
        <h2 style="font-size:24px;margin-top:2px">${esc(z.nombre)}</h2>${z.barrio ? `<div class="serif gold">${esc(z.barrio)}</div>` : ''}
        <div class="row" style="margin-top:16px;justify-content:space-between;align-items:flex-end">
          <div><div class="count"><b style="color:${e === 'vencida' ? 'var(--bad)' : pronto ? 'var(--warn)' : 'var(--gold)'}">${e === 'vencida' ? 0 : r.v}</b><span>${e === 'vencida' ? 'días' : r.u} ${e === 'vencida' ? '' : 'restantes'}</span></div></div>
          <div class="muted" style="font-size:13px;text-align:right">${e === 'vencida' ? 'Venció' : 'Vence'} el<br><b style="color:var(--tx)">${fechaL(a.vence)}</b></div></div>
        <div class="bar ${e === 'vencida' ? 'bad' : pronto ? 'warn' : ''}"><i style="width:${pct(a)}%"></i></div>
        ${e === 'vencida' ? '<div class="err" style="margin-top:12px">Se cumplieron los 90 días. El broker está evaluando tu trabajo para renovar o reasignar la zona. Mientras tanto no se pueden cargar datos.</div>' : ''}
        <div class="stats" style="margin-top:14px"><div class="stat"><b>${st.visitas}</b><span>CASAS</span></div><div class="stat"><b>${st.contactos}</b><span>CON TELÉFONO</span></div><div class="stat"><b>${num(st.horas)}</b><span>HORAS</span></div><div class="stat"><b>${st.jornadas}</b><span>JORNADAS</span></div></div>
      </div>

      <div class="card"><h3 style="font-size:16px">Registrar jornada</h3>
        ${puede ? `<div class="row" style="margin-top:10px;align-items:flex-end"><div><label class="f" style="margin-top:0">Día</label><input class="i" type="date" id="jFecha" value="${hoyISO()}" max="${hoyISO()}" style="width:170px"></div>
          <div><label class="f" style="margin-top:0">Horas dedicadas</label><div class="stepper"><button data-a="hMenos">−</button><input id="jHoras" type="number" step="0.5" min="0.5" max="24" value="2" inputmode="decimal"><button data-a="hMas">＋</button></div></div></div>
          <label class="f">Notas (opcional)</label><input class="i" id="jNotas" placeholder="Ej: recorrí Pedro Morán de 4400 a 4700">
          <button class="btn primary block" style="margin-top:12px" data-a="addJornada">Guardar jornada</button>` : ''}
        <div style="margin-top:12px">${jor.length ? jor.slice(0, S.verTodasJ ? 999 : 5).map(j => `<div class="jor"><b>${num(j.horas)} h</b><span>${fecha(j.fecha)}</span><span class="grow">${esc(j.notas)}</span>${puede ? `<button class="vis x" style="background:none;border:0;color:var(--tx3);cursor:pointer" data-a="delJornada" data-id="${j.id}">✕</button>` : ''}</div>`).join('') +
          (jor.length > 5 && !S.verTodasJ ? `<button class="btn sm ghost" data-a="verTodasJ">Ver las ${jor.length}</button>` : '') : '<p class="muted" style="font-size:13px;margin:0">Todavía no registraste jornadas.</p>'}</div>
      </div>

      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="font-size:16px">Mapa de la zona</h3><span class="muted" style="font-size:12px">Dorado = cuadras trabajadas</span></div>
        <div class="mini-map" id="miniMap"></div></div>

      <div style="margin-top:20px"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="font-size:18px">Calles y cuadras</h3><span class="muted" style="font-size:13px">${(z.cuadras || []).length} cuadras</span></div>
        <input class="i" id="buscar" placeholder="Buscar calle…" value="${esc(S.buscar)}" style="margin-bottom:12px">
        <div id="listaCalles"></div></div>
    </div></main>`;
    renderCalles(z, a);
    miniMapa(z, a);
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
    S.mini = m;
    setTimeout(() => m.invalidateSize(), 50);
  }

  function renderCalles(z, a) {
    const el = $('#listaCalles'); if (!el) return;
    const puede = estadoAsig(a) === 'activa';
    const st = stats([a.id]);
    const porCuadra = new Map(); st.v.forEach(v => { if (!porCuadra.has(v.cuadra_id)) porCuadra.set(v.cuadra_id, []); porCuadra.get(v.cuadra_id).push(v); });
    const q = Geo.norm(S.buscar);
    const grupos = agrupar(z.cuadras || []).filter(([c]) => !q || Geo.norm(c).includes(q));
    el.innerHTML = grupos.length ? grupos.map(([calle, qs]) => {
      const n = qs.reduce((s, x) => s + (porCuadra.get(x.id)?.length || 0), 0);
      return `<details class="calle" data-calle="${esc(calle)}" ${S.abiertas.has(calle) ? 'open' : ''}><summary>${esc(calle)}${qs.some(x => x.perimetral) ? '<span class="perim">LÍMITE</span>' : ''}<span class="cnt ${n ? 'on' : ''}">${n}</span></summary>
        ${qs.map(cq => { const vs = (porCuadra.get(cq.id) || []).slice().sort((x, y) => (x.altura || 0) - (y.altura || 0)); return `<div class="cuadra ${S.cuadraAbierta === cq.id ? 'open' : ''}" id="c_${cq.id}">
          <div class="cuadra-h" data-cuadra="${cq.id}"><div class="tt"><b>${cq.desde != null ? `${cq.desde} – ${cq.hasta}` : `Cuadra ${cq.orden}`}${cq.aprox ? ' <small>aprox.</small>' : ''}</b><small>${esc(entreTxt(cq))}</small></div><span class="cnt ${vs.length ? 'on' : ''}">${vs.length}</span></div>
          <div class="cuadra-b">${vs.map(v => tarjetaVisita(v, { calle: cq.calle, puede })).join('')}
            ${puede ? `<div class="vform" data-form="${cq.id}"><div class="grid2"><div><label class="f" style="margin-top:0">Altura</label><input class="i" name="altura" type="number" inputmode="numeric" placeholder="${cq.desde != null ? cq.desde + '…' + cq.hasta : 'Número'}"></div>
              <div><label class="f" style="margin-top:0">Resultado</label><select class="i" name="resultado"><option value="">—</option>${RESULTADOS.map(r => `<option>${r}</option>`).join('')}</select></div></div>
              <label class="f">Propietario</label><input class="i" name="propietario" placeholder="Nombre y apellido" autocomplete="off">
              <label class="f">Teléfono</label><input class="i" name="telefono" type="tel" inputmode="tel" autocomplete="off">
              <label class="f">¿En venta con colega?</label>
              <div class="sino"><label><input type="radio" name="colega_${cq.id}" value="no" data-colega checked><span>No</span></label><label><input type="radio" name="colega_${cq.id}" value="si" data-colega><span>Sí</span></label></div>
              <div class="colega-campos hidden">
                <label class="f">¿Hace cuánto está a la venta?</label>
                <div class="row" style="flex-wrap:nowrap"><input class="i" name="venta_cant" type="number" min="0" inputmode="numeric" placeholder="Ej: 4" style="flex:1"><select class="i" name="venta_unidad" style="flex:1"><option value="30.44">meses</option><option value="1">días</option><option value="365.25">años</option></select></div>
                <label class="f">Inmobiliaria que la tiene</label><input class="i" name="venta_inmobiliaria" placeholder="Ej: Remax Devoto" autocomplete="off">
                <label class="f">Valor publicado (USD)</label><input class="i" name="venta_valor" type="number" min="0" inputmode="numeric" placeholder="Ej: 185000">
              </div>
              <label class="f">Notas</label><input class="i" name="notas" placeholder="Ej: PH al fondo, vende en 2027" autocomplete="off">
              <label class="f">Fotos (hasta 3)</label>
              <label class="btn sm fotobtn">📷 Agregar fotos<input type="file" accept="image/*" multiple data-fotos hidden></label>
              <div class="fotos prev" data-prev></div>
              <button class="btn primary block" style="margin-top:12px" data-a="addVisita" data-q="${cq.id}">Guardar casa</button></div>` : ''}</div></div>`; }).join('')}</details>`;
    }).join('') : '<p class="empty">No hay calles que coincidan.</p>';
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
    const fop = t.closest('[data-fop]'); if (fop) { S.filtroOp = fop.dataset.fop; vistaOportunidades(); return; }
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
      case 'salir': cerrarModal(); destruirMapa(); cerrarSheet(); await S.be.logout(); S.yo = null; dibujarZonas._fit = false; pantallaLogin(); break;
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
          const cuadras = await numeracionOficial(JSON.parse(JSON.stringify(z.cuadras)));
          const n = cuadras.filter(q => q.desde != null).length;
          await S.be.guardarZona({ ...z, cuadras }); await recargar(); abrirZona(z.id);
          toast(S.motivoNum ? `No se pudo consultar la numeración oficial (${S.motivoNum})` : `${n} de ${cuadras.length} cuadras con numeración`, !!S.motivoNum);
        });
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
        await conCarga(b, async () => { await S.be.agregar('jornadas', { asignacion_id: S.asigSel, fecha: fechaJ, horas, notas: $('#jNotas').value.trim() }); toast('Jornada registrada'); await refrescarAsesor(); });
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
          toast('Casa guardada'); await refrescarAsesor();
        });
        break;
      }
      case 'contactado': await conCarga(b, async () => { await S.be.editar('visitas', b.dataset.id, { ultimo_contacto: hoyISO() }); toast(`Listo. Te recordamos de nuevo en ${SEGUIR_CADA} días`); await refrescarAsesor(); }); break;
      case 'togglePend': S.verPend = !S.verPend; renderAsesor(); break;
      case 'delVisita': if (await confirmar('Borrar casa', '¿Seguro que querés borrar este registro?', 'Borrar', true)) { await conCarga(null, async () => { await S.be.borrar('visitas', b.dataset.id); await refrescarAsesor(); }); } break;
    }
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') cerrarModal(); });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-colega]')) {
      const form = t.closest('[data-form]');
      form.querySelector('.colega-campos').classList.toggle('hidden', t.value !== 'si');
    }
    if (t.matches('[data-fotos]')) {
      const form = t.closest('[data-form]');
      const nuevas = [...t.files].filter(f => f.type.startsWith('image/'));
      form._fotos = [...(form._fotos || []), ...nuevas];
      if (form._fotos.length > 3) { toast('Máximo 3 fotos por casa', true); form._fotos = form._fotos.slice(0, 3); }
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
    const img = e.target.closest('img[data-foto]');
    if (img && img.src) modal(`<img src="${img.src}" style="width:100%;border-radius:10px;display:block" alt="Foto"><button class="btn block" style="margin-top:12px" data-a="cerrarModal">Cerrar</button>`);
  });

  // Refrescar contadores cada minuto
  setInterval(() => {
    if (!S.yo || !S.d || $('#modal').classList.contains('open')) return;
    if (S.yo.rol === 'admin' && S.vista === 'mapa' && !S.dibujo && S.map) { herramientasMapa(); }
  }, 60000);

  init();
})();
