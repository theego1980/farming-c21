/* ======================================================================
   Motor geográfico: barrios, callejero (OpenStreetMap), zonas por calles,
   corte en cuadras y estimación de alturas. Sin dependencias externas.
   Coordenadas internas: [lat, lon]
   ====================================================================== */
(function (root) {
  'use strict';

  // Área de trabajo: Villa Devoto, Villa del Parque y Villa Pueyrredón (con margen)
  const BBOX = { s: -34.637, w: -58.545, n: -34.562, e: -58.458 };
  const BARRIOS = ['Villa Devoto', 'Villa del Parque', 'Villa Pueyrredón'];
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  const CACHE_DIAS = 30;

  // ---------------- Geometría en metros ----------------
  const LAT0 = -34.6, LON0 = -58.5;
  const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574;
  const xy = p => [(p[1] - LON0) * KX, (p[0] - LAT0) * KY];
  const ll = q => [q[1] / KY + LAT0, q[0] / KX + LON0];
  const dist = (a, b) => { const A = xy(a), B = xy(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); };

  function distPtSeg(p, a, b) {
    const P = xy(p), A = xy(a), B = xy(b);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
  }
  function distPtLine(p, line) {
    let m = Infinity;
    for (let i = 1; i < line.length; i++) m = Math.min(m, distPtSeg(p, line[i - 1], line[i]));
    return m;
  }
  function distPtRing(p, ring) {
    const r = closeRing(ring);
    return distPtLine(p, r);
  }
  function closeRing(r) {
    if (!r.length) return r;
    const a = r[0], b = r[r.length - 1];
    return (a[0] === b[0] && a[1] === b[1]) ? r : r.concat([a]);
  }
  function pip(p, ring) {
    let inside = false;
    const x = p[1], y = p[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][1], yi = ring[i][0], xj = ring[j][1], yj = ring[j][0];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function area(ring) {
    let s = 0; const r = ring.map(xy);
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return Math.abs(s / 2);
  }
  function bboxOf(pts) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of pts) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
    return { s, w, n, e };
  }
  function expand(b, m) {
    const dLat = m / KY, dLon = m / KX;
    return { s: b.s - dLat, w: b.w - dLon, n: b.n + dLat, e: b.e + dLon };
  }
  const bboxHit = (a, b) => !(a.e < b.w || a.w > b.e || a.n < b.s || a.s > b.n);
  function centroid(ring) {
    const r = ring.map(xy); let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) { const m = r.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]); return ll([m[0] / r.length, m[1] / r.length]); }
    return ll([cx / (3 * a), cy / (3 * a)]);
  }
  function lineLength(line) { let s = 0; for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]); return s; }
  function pointAlong(line, d) {
    for (let i = 1; i < line.length; i++) {
      const L = dist(line[i - 1], line[i]);
      if (d <= L || i === line.length - 1) {
        const t = L ? Math.min(1, d / L) : 0;
        return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
      }
      d -= L;
    }
    return line[0];
  }
  const midpoint = line => pointAlong(line, lineLength(line) / 2);

  // Superposición aproximada entre dos polígonos (m²), ignorando el borde compartido
  function overlapArea(A, B, paso = 8, borde = 7) {
    const ba = bboxOf(A), bb = bboxOf(B);
    if (!bboxHit(ba, bb)) return 0;
    const box = { s: Math.max(ba.s, bb.s), n: Math.min(ba.n, bb.n), w: Math.max(ba.w, bb.w), e: Math.min(ba.e, bb.e) };
    const dLat = paso / KY, dLon = paso / KX;
    let n = 0;
    for (let la = box.s + dLat / 2; la < box.n; la += dLat) {
      for (let lo = box.w + dLon / 2; lo < box.e; lo += dLon) {
        const p = [la, lo];
        if (pip(p, A) && pip(p, B) && distPtRing(p, A) > borde && distPtRing(p, B) > borde) n++;
      }
    }
    return n * paso * paso;
  }

  // ---------------- Nombres de calles ----------------
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.,'"`´]/g, ' ')
      .replace(/^\s*(avenida|av|avda|pasaje|pje|psje|calle|boulevard|bv|bvd)\s+/, '')
      .replace(/\s+/g, ' ').trim();
  }

  // ---------------- Caché (IndexedDB) ----------------
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        try {
          const r = indexedDB.open('farming-c21', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => { this.db = r.result; res(this.db); };
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    },
    async get(k) {
      try {
        const db = await this.open();
        return await new Promise(res => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
      } catch { return null; }
    },
    async set(k, v) {
      try {
        const db = await this.open();
        await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
      } catch { /* sin caché */ }
    },
  };

  // Consulta los servidores de OpenStreetMap en paralelo y se queda con el primero que responde
  async function overpass(q, timeoutMs = 60000) {
    const ctrls = OVERPASS.map(() => new AbortController());
    const to = setTimeout(() => ctrls.forEach(c => c.abort()), timeoutMs);
    const intento = async (url, i) => {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrls[i].signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !Array.isArray(j.elements)) throw new Error('respuesta inválida');
      if (j.remark && /runtime error|timed out/i.test(j.remark) && !j.elements.length) throw new Error(j.remark);
      return j;
    };
    try {
      const j = await Promise.any(OVERPASS.map((u, i) => intento(u, i)));
      ctrls.forEach(c => c.abort());
      return j;
    } catch (e) {
      const det = e && e.errors ? e.errors.map(x => x.message).join(', ') : (e && e.message) || '';
      throw new Error('No pude descargar el mapa de calles (los servidores de OpenStreetMap no respondieron). Probá de nuevo en un minuto.' + (det ? ` (${det})` : ''));
    } finally { clearTimeout(to); }
  }
  const bb = b => `${b.s},${b.w},${b.n},${b.e}`;

  async function cached(key, loader) {
    const c = await idb.get(key);
    if (c && c.t && (Date.now() - c.t) < CACHE_DIAS * 864e5) return c.v;
    const v = await loader();
    await idb.set(key, { t: Date.now(), v });
    return v;
  }

  // ---------------- Barrios ----------------
  // Une los tramos (ways) de una relación en anillos cerrados
  function assembleRings(ways) {
    const segs = ways.map(w => w.slice());
    const rings = [];
    const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
    while (segs.length) {
      let ring = segs.shift();
      let guard = 0;
      while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 5000) {
        const end = key(ring[ring.length - 1]);
        const i = segs.findIndex(s => key(s[0]) === end || key(s[s.length - 1]) === end);
        if (i < 0) break;
        let s = segs.splice(i, 1)[0];
        if (key(s[0]) !== end) s = s.reverse();
        ring = ring.concat(s.slice(1));
      }
      if (ring.length > 3) rings.push(ring);
    }
    return rings;
  }

  async function loadBarrios() {
    return cached('barrios_v2', async () => {
      const q = `[out:json][timeout:60];
relation["name"~"^(Villa Devoto|Villa del Parque|Villa Pueyrred[oó]n)$"]["type"~"^(boundary|multipolygon)$"](${bb(BBOX)});
out geom;`;
      const data = await overpass(q);
      const out = [];
      for (const rel of data.elements || []) {
        if (rel.type !== 'relation') continue;
        const outer = (rel.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry)
          .map(m => m.geometry.map(g => [g.lat, g.lon]));
        const rings = assembleRings(outer);
        if (rings.length) {
          rings.sort((a, b) => area(b) - area(a));
          out.push({ nombre: rel.tags.name, ring: rings[0] });
        }
      }
      // Si OSM devolvió duplicados (p. ej. dos niveles administrativos), quedarse con uno por nombre
      const porNombre = new Map();
      for (const b of out) if (!porNombre.has(b.nombre) || area(b.ring) > area(porNombre.get(b.nombre).ring)) porNombre.set(b.nombre, b);
      return [...porNombre.values()];
    });
  }

  // ---------------- Callejero ----------------
  class Callejero {
    constructor(ways) {
      this.ways = ways;                     // [{id, name, nodes:[id], geom:[[lat,lon]]}]
      this.coord = new Map();               // nodo -> [lat,lon]
      this.nodeNames = new Map();           // nodo -> Set(nombre normalizado)
      this.display = new Map();             // nombre normalizado -> nombre para mostrar
      this.byName = new Map();              // nombre normalizado -> [ways]
      for (const w of ways) {
        const k = norm(w.name);
        if (!k) continue;
        if (!this.display.has(k) || w.name.length > this.display.get(k).length) this.display.set(k, w.name);
        if (!this.byName.has(k)) this.byName.set(k, []);
        this.byName.get(k).push(w);
        w.k = k;
        w.nodes.forEach((n, i) => {
          this.coord.set(n, w.geom[i]);
          if (!this.nodeNames.has(n)) this.nodeNames.set(n, new Set());
          this.nodeNames.get(n).add(k);
        });
      }
      this.graphs = new Map();
    }

    names() { return [...this.display.values()].sort((a, b) => a.localeCompare(b, 'es')); }

    // Encuentra la calle que mejor coincide con lo que escribió el usuario
    find(input) {
      const q = norm(input);
      if (!q) return null;
      if (this.byName.has(q)) return q;
      const cands = [...this.byName.keys()].filter(k => k.includes(q) || q.includes(k));
      if (!cands.length) {
        // coincidencia por palabras (p.ej. "beiro" -> "francisco beiro")
        const words = q.split(' ').filter(w => w.length > 2);
        const c2 = [...this.byName.keys()].filter(k => words.every(w => k.includes(w)));
        if (!c2.length) return null;
        return c2.sort((a, b) => a.length - b.length)[0];
      }
      // preferir la que empieza igual, después la más corta
      return cands.sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || (Math.abs(a.length - q.length) - Math.abs(b.length - q.length)))[0];
    }

    graph(k) {
      if (this.graphs.has(k)) return this.graphs.get(k);
      const adj = new Map();
      const add = (a, b) => {
        const w = dist(this.coord.get(a), this.coord.get(b));
        if (!adj.has(a)) adj.set(a, new Map());
        if (!adj.has(b)) adj.set(b, new Map());
        adj.get(a).set(b, w); adj.get(b).set(a, w);
      };
      for (const w of this.byName.get(k) || []) for (let i = 1; i < w.nodes.length; i++) if (w.nodes[i] !== w.nodes[i - 1]) add(w.nodes[i - 1], w.nodes[i]);
      this.graphs.set(k, adj);
      return adj;
    }

    // Esquinas entre dos calles, agrupadas (avenidas con doble mano dan varios nodos)
    corners(a, b) {
      const pts = [];
      for (const [n, set] of this.nodeNames) if (set.has(a) && set.has(b)) pts.push({ node: n, p: this.coord.get(n) });
      if (!pts.length) {
        // Calles que se cruzan sin compartir nodo: buscar la mínima distancia
        const nodesA = [...this.graph(a).keys()], nodesB = [...this.graph(b).keys()];
        let best = null;
        for (const na of nodesA) for (const nb of nodesB) {
          const d = dist(this.coord.get(na), this.coord.get(nb));
          if (d < 35 && (!best || d < best.d)) best = { d, na, nb };
        }
        if (best) pts.push({ node: best.na, p: this.coord.get(best.na), nb: best.nb });
      }
      const clusters = [];
      for (const c of pts) {
        const cl = clusters.find(k => dist(k.center, c.p) < 90);
        if (cl) { cl.items.push(c); const m = cl.items.length; cl.center = [cl.center[0] + (c.p[0] - cl.center[0]) / m, cl.center[1] + (c.p[1] - cl.center[1]) / m]; }
        else clusters.push({ center: c.p, items: [c] });
      }
      return clusters;
    }

    // Camino más corto por la geometría de una calle entre dos grupos de nodos
    path(k, fromNodes, toNodes) {
      const g = this.graph(k);
      const src = fromNodes.filter(n => g.has(n)), dst = new Set(toNodes.filter(n => g.has(n)));
      if (!src.length || !dst.size) return null;
      const d = new Map(), prev = new Map(), done = new Set();
      src.forEach(n => d.set(n, 0));
      while (true) {
        let u = null, du = Infinity;
        for (const [n, v] of d) if (!done.has(n) && v < du) { du = v; u = n; }
        if (u === null) return null;
        if (dst.has(u)) {
          const out = [u];
          while (prev.has(out[0])) out.unshift(prev.get(out[0]));
          return out.map(n => this.coord.get(n));
        }
        done.add(u);
        if (du > 6000) return null;
        for (const [v, w] of g.get(u) || []) {
          const nd = du + w;
          if (nd < (d.has(v) ? d.get(v) : Infinity)) { d.set(v, nd); prev.set(v, u); }
        }
      }
    }

    nearestNode(k, p) {
      let best = null, bd = Infinity;
      for (const n of this.graph(k).keys()) { const dd = dist(this.coord.get(n), p); if (dd < bd) { bd = dd; best = n; } }
      return best;
    }

    // Polígono a partir de calles en orden (recorriendo el perímetro)
    zoneFromStreets(inputs) {
      const raw = inputs.map(s => String(s || '').trim()).filter(Boolean);
      if (raw.length < 3) throw new Error('Necesito al menos 3 calles que encierren la zona, en orden.');
      const ks = raw.map(s => {
        const k = this.find(s);
        if (!k) throw new Error(`No encuentro la calle “${s}” dentro de los tres barrios.`);
        return k;
      });
      const n = ks.length;
      const cornerOpts = [];
      for (let i = 0; i < n; i++) {
        const a = ks[i], b = ks[(i + 1) % n];
        const cl = this.corners(a, b);
        if (!cl.length) throw new Error(`${this.display.get(a)} y ${this.display.get(b)} no se cruzan. Revisá el orden de las calles (tienen que ir recorriendo el borde de la zona).`);
        cornerOpts.push(cl);
      }
      // Elegir la esquina correcta cuando dos calles se cruzan en más de un lugar
      const chosen = cornerOpts.map(o => o.length === 1 ? o[0] : null);
      for (let iter = 0; iter < 3; iter++) {
        const fixed = chosen.filter(Boolean);
        const ref = fixed.length ? [fixed.reduce((s, c) => s + c.center[0], 0) / fixed.length, fixed.reduce((s, c) => s + c.center[1], 0) / fixed.length]
          : cornerOpts[0][0].center;
        cornerOpts.forEach((o, i) => { if (!chosen[i]) chosen[i] = o.slice().sort((x, y) => dist(x.center, ref) - dist(y.center, ref))[0]; });
      }
      // Recorrer cada calle entre sus dos esquinas
      const ring = [];
      for (let i = 0; i < n; i++) {
        const k = ks[i];
        const from = chosen[(i - 1 + n) % n], to = chosen[i];
        const nodes = c => {
          const ns = c.items.map(x => x.node).filter(x => this.graph(k).has(x));
          c.items.forEach(x => { if (x.nb && this.graph(k).has(x.nb)) ns.push(x.nb); });
          return ns.length ? ns : [this.nearestNode(k, c.center)];
        };
        const p = this.path(k, nodes(from), nodes(to));
        const seg = p && p.length > 1 ? p : [from.center, to.center];
        if (ring.length) seg.shift();
        ring.push(...seg);
      }
      const clean = ring.filter((p, i) => i === 0 || dist(p, ring[i - 1]) > 0.5);
      if (clean.length < 3 || area(clean) < 2000) throw new Error('Con esas calles no se forma una zona válida. Revisá el orden.');
      return { ring: clean, calles: ks.map(k => this.display.get(k)), esquinas: chosen.map(c => c.center) };
    }

    // Divide las calles de la zona en cuadras (de esquina a esquina)
    cuadras(ring, direcciones = []) {
      const box = expand(bboxOf(ring), 40);
      const out = [];
      for (const [k, ways] of this.byName) {
        if (!ways.some(w => bboxHit(bboxOf(w.geom), box))) continue;
        const g = this.graph(k);
        const isBreak = n => (this.nodeNames.get(n)?.size || 0) > 1 || (g.get(n)?.size || 0) !== 2;
        const seen = new Set();
        const ekey = (a, b) => a < b ? a + '_' + b : b + '_' + a;
        for (const start of g.keys()) {
          if (!isBreak(start)) continue;
          for (const nb of g.get(start).keys()) {
            if (seen.has(ekey(start, nb))) continue;
            const nodes = [start]; let prev = start, cur = nb, guard = 0;
            seen.add(ekey(start, nb));
            while (!isBreak(cur) && guard++ < 2000) {
              nodes.push(cur);
              const nxt = [...g.get(cur).keys()].find(x => x !== prev);
              if (nxt === undefined) break;
              seen.add(ekey(cur, nxt)); prev = cur; cur = nxt;
            }
            nodes.push(cur);
            const coords = nodes.map(x => this.coord.get(x));
            const largo = lineLength(coords);
            if (largo < 15) continue;
            const mid = midpoint(coords);
            const dBorde = distPtRing(mid, ring);
            const dentro = pip(mid, ring);
            if (!dentro && dBorde > 14) continue;
            const entre = [nodes[0], nodes[nodes.length - 1]].map(n => {
              const others = [...(this.nodeNames.get(n) || [])].filter(x => x !== k);
              return others.length ? this.display.get(others.sort((a, b) => a.length - b.length)[0]) : null;
            });
            // cruce del boulevard de una avenida de doble mano: no es una cuadra
            if (entre[0] && entre[0] === entre[1] && largo < 70) continue;
            out.push({ k, calle: this.display.get(k), coords, largo, mid, perimetral: dBorde < 16, entre });
          }
        }
      }
      // Avenidas de doble mano: quedarse con una cuadra por tramo
      const uniq = new Map();
      for (const c of out) {
        const pair = c.entre.every(Boolean) ? c.entre.slice().sort().join('|') : null;
        const key = pair ? c.k + '#' + pair : c.k + '@' + c.mid[0].toFixed(4) + ',' + c.mid[1].toFixed(4);
        const prev = uniq.get(key);
        if (!prev) uniq.set(key, c);
        else if (pair && dist(prev.mid, c.mid) < 80) { if (c.largo > prev.largo) uniq.set(key, c); }
        else uniq.set(key + '~' + c.mid[0].toFixed(5), c);
      }
      const cuadras = [...uniq.values()];
      return asignarAlturas(cuadras, direcciones);
    }
  }

  // Ordena las cuadras de cada calle y estima su numeración (alturas)
  function asignarAlturas(cuadras, direcciones) {
    const porCalle = new Map();
    for (const c of cuadras) { if (!porCalle.has(c.k)) porCalle.set(c.k, []); porCalle.get(c.k).push(c); }
    const dirPorCalle = new Map();
    for (const d of direcciones) {
      const k = norm(d.calle);
      if (!dirPorCalle.has(k)) dirPorCalle.set(k, []);
      dirPorCalle.get(k).push(d);
    }
    const result = [];
    for (const [k, cs] of porCalle) {
      // eje principal de la calle
      let A = cs[0].mid, B = cs[0].mid, best = -1;
      for (const a of cs) for (const b of cs) { const d = dist(a.mid, b.mid); if (d > best) { best = d; A = a.mid; B = b.mid; } }
      const a = xy(A), b = xy(B); let vx = b[0] - a[0], vy = b[1] - a[1]; const L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
      cs.forEach(c => { const m = xy(c.mid); c._t = (m[0] - a[0]) * vx + (m[1] - a[1]) * vy; });
      cs.sort((x, y) => x._t - y._t);
      // alturas conocidas por direcciones cercanas
      const ds = dirPorCalle.get(k) || [];
      cs.forEach(c => {
        const nums = ds.filter(d => d.q ? d.q === c.id : distPtLine(d.p, c.coords) < 45).map(d => d.n).sort((x, y) => x - y);
        c._base = nums.length ? Math.floor(nums[Math.floor(nums.length / 2)] / 100) * 100 : null;
      });
      const known = cs.map((c, i) => ({ i, b: c._base })).filter(x => x.b != null);
      let dir = 0;
      if (known.length >= 2) {
        let s = 0; for (let i = 1; i < known.length; i++) s += Math.sign((known[i].b - known[i - 1].b) * (known[i].i - known[i - 1].i));
        dir = s >= 0 ? 1 : -1;
      } else if (known.length === 1) {
        // Convención de CABA: las calles este-oeste crecen hacia el oeste; las norte-sur, al norte de Rivadavia, crecen hacia el norte
        dir = Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? 1 : -1) : (vy > 0 ? 1 : -1);
      }
      cs.forEach((c, i) => {
        let desde = c._base, aprox = false;
        if (desde == null && known.length && dir) {
          const nk = known.slice().sort((x, y) => Math.abs(x.i - i) - Math.abs(y.i - i))[0];
          desde = Math.max(0, nk.b + dir * 100 * (i - nk.i)); aprox = true;
        }
        c.desde = desde; c.aprox = aprox;
      });
      if (dir < 0) cs.reverse();
      cs.forEach((c, i) => {
        result.push({
          id: c.id || 'q' + hash(k + '|' + c.mid[0].toFixed(4) + ',' + c.mid[1].toFixed(4)),
          calle: c.calle,
          orden: i + 1,
          desde: c.desde,
          hasta: c.desde != null ? c.desde + 99 : null,
          aprox: !!c.aprox,
          entre: c.entre,
          perimetral: c.perimetral,
          largo: Math.round(c.largo),
          coords: c.coords.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]),
        });
      });
    }
    return result;
  }

  // Recalibra las alturas de una calle: primera cuadra = base, sentido 1 o -1
  function calibrarCalle(cuadras, calle, base, invertir) {
    const cs = cuadras.filter(c => c.calle === calle).sort((a, b) => a.orden - b.orden);
    if (invertir) cs.reverse();
    cs.forEach((c, i) => {
      c.orden = i + 1;
      c.desde = base != null && base !== '' ? Number(base) + i * 100 : null;
      c.hasta = c.desde != null ? c.desde + 99 : null;
      c.aprox = false;
    });
    return cuadras;
  }

  // ¿El nombre de la ciudad (USIG, ej. "LAMARCA, EMILIO" o "BEIRO, FRANCISCO, AV.") es la misma calle que la de OSM?
  function mismaCalle(osm, usig) {
    const pal = t => norm(t).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 2 && !['avenida', 'av', 'pje', 'pasaje', 'del', 'los', 'las', 'gral', 'general', 'dr', 'presidente', 'pres'].includes(w));
    const a = new Set(pal(osm)), b = pal(usig.replace(/,/g, ' '));
    if (!b.length || !a.size) return false;
    const comunes = b.filter(w => a.has(w)).length;
    return comunes >= Math.min(b.length, a.size, 2) || (comunes >= 1 && b.some(w => a.has(w) && w.length >= 5));
  }

  // Aplica la numeración oficial: resultados[i] corresponde a cuadras[i] (punto medio de la cuadra)
  function aplicarAlturasOficiales(cuadras, resultados) {
    const dirs = [];
    let ok = 0;
    cuadras.forEach((c, i) => {
      const r = resultados[i];
      if (r && r.altura && mismaCalle(c.calle, r.calle)) { dirs.push({ calle: c.calle, n: r.altura, q: c.id }); ok++; }
    });
    const internas = cuadras.map(c => ({ ...c, k: norm(c.calle), mid: midpoint(c.coords), desde: undefined }));
    return { cuadras: asignarAlturas(internas, dirs), detectadas: ok };
  }

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  async function loadCallejero() {
    const ways = await cached('calles_v2', async () => {
      const q = `[out:json][timeout:90];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|primary_link|secondary_link|tertiary_link)$"]["name"](${bb(BBOX)});
out body geom;`;
      const data = await overpass(q, 90000);
      return (data.elements || []).filter(e => e.type === 'way' && e.geometry && e.nodes)
        .map(e => ({ id: e.id, name: e.tags.name, nodes: e.nodes, geom: e.geometry.map(g => [+g.lat.toFixed(7), +g.lon.toFixed(7)]) }));
    });
    return new Callejero(ways);
  }

  async function loadDirecciones(ring) {
    const box = expand(bboxOf(ring), 250);
    try {
      const data = await overpass(`[out:json][timeout:60];
nwr["addr:housenumber"]["addr:street"](${bb(box)});
out center tags;`, 45000);
      return (data.elements || []).map(e => {
        const p = e.type === 'node' ? [e.lat, e.lon] : (e.center ? [e.center.lat, e.center.lon] : null);
        const n = parseInt(String(e.tags['addr:housenumber']).replace(/[^\d].*$/, ''), 10);
        return p && n ? { calle: e.tags['addr:street'], n, p } : null;
      }).filter(Boolean);
    } catch { return []; }
  }

  function barrioDe(p, barrios) {
    const b = barrios.find(b => pip(p, b.ring));
    return b ? b.nombre : null;
  }

  root.Geo = {
    BBOX, BARRIOS, norm, pip, area, centroid, dist, distPtLine, overlapArea, bboxOf, closeRing,
    loadBarrios, loadCallejero, loadDirecciones, barrioDe, calibrarCalle, asignarAlturas, Callejero, assembleRings, midpoint,
    mismaCalle, aplicarAlturasOficiales,
  };
})(typeof window !== 'undefined' ? window : globalThis);
