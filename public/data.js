/* ======================================================================
   Capa de datos. Dos modos:
   - Supabase (producción): cuando Netlify tiene configuradas las claves.
   - Demo: todo queda en este navegador, para probar antes de configurar.
   ====================================================================== */
(function (root) {
  'use strict';
  const DIA = 864e5;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

  // ------------------------------------------------------------------
  // Modo sin señal: lo que se carga sin conexión queda en el celular (IndexedDB) y se sube solo al volver la señal
  const esRed = e => !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|err_internet|aborted/i.test(String((e && (e.message || e.error_description || e)) || ''));
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const Cola = {
    db: null, mem: { items: [], blobs: new Map(), n: 0 },
    open() {
      if (this.db || this.db === false) return Promise.resolve(this.db);
      return new Promise(res => {
        try {
          const r = indexedDB.open('farming-cola', 1);
          r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'k', autoIncrement: true }); r.result.createObjectStore('blobs'); };
          r.onsuccess = () => { this.db = r.result; res(this.db); };
          r.onerror = () => { this.db = false; res(false); };
        } catch { this.db = false; res(false); }
      });
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      if (!db) return fn(null);
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode); const st = t.objectStore(store); let out;
        Promise.resolve(fn(st)).then(v => { out = v; });
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
      });
    },
    req: r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
    async todos() { return this.tx('items', 'readonly', st => st ? this.req(st.getAll()) : this.mem.items.slice()); },
    async agregar(it) { return this.tx('items', 'readwrite', st => { if (st) return this.req(st.add(it)); it.k = ++this.mem.n; this.mem.items.push(it); return it.k; }); },
    async guardar(it) { return this.tx('items', 'readwrite', st => { if (st) return this.req(st.put(it)); const i = this.mem.items.findIndex(x => x.k === it.k); this.mem.items[i] = it; }); },
    async borrar(k) { return this.tx('items', 'readwrite', st => { if (st) return this.req(st.delete(k)); this.mem.items = this.mem.items.filter(x => x.k !== k); }); },
    async ponerBlob(k, b) { return this.tx('blobs', 'readwrite', st => st ? this.req(st.put(b, k)) : this.mem.blobs.set(k, b)); },
    async blob(k) { return this.tx('blobs', 'readonly', st => st ? this.req(st.get(k)) : this.mem.blobs.get(k)); },
    async borrarBlob(k) { return this.tx('blobs', 'readwrite', st => st ? this.req(st.delete(k)) : this.mem.blobs.delete(k)); },
  };

  class SupabaseBackend {
    constructor(url, key) {
      this.modo = 'supabase';
      this.offline = false;
      this.fallidos = [];
      this.onCambio = null;
      this.c = root.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
      root.addEventListener('online', () => this.sincronizar());
      root.addEventListener('offline', () => { this.offline = true; this.avisar(); });
      setInterval(() => this.sincronizar(), 30000);
    }
    avisar(extra) { try { this.onCambio && this.onCambio(extra || {}); } catch (e) { console.warn(e); } }
    async perfil() {
      const cache = lsGet('farming_perfil');
      let session = null;
      try { ({ data: { session } } = await this.c.auth.getSession()); } catch { }
      if (!session) { if (cache && !navigator.onLine) { this.offline = true; return cache; } return null; }
      try {
        const { data, error } = await this.c.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
        if (error) throw error;
        if (data) lsSet('farming_perfil', data);
        this.offline = false;
        return data;
      } catch (e) {
        if (esRed(e) && cache && cache.id === session.user.id) { this.offline = true; return cache; }
        throw e;
      }
    }
    async miId() {
      try { const { data: { session } } = await this.c.auth.getSession(); if (session) return session.user.id; } catch { }
      const p = lsGet('farming_perfil'); return p ? p.id : null;
    }
    async login(email, password) {
      const { error } = await this.c.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Usuario o contraseña incorrectos.' : error.message);
      const p = await this.perfil();
      if (!p) throw new Error('Tu usuario no tiene perfil. Pedile al broker que te asigne una zona.');
      return p;
    }
    async logout() {
      if ((await Cola.todos()).length && !confirm('Hay datos cargados sin señal que todavía no se subieron. Si cerrás sesión se pierden. ¿Cerrar igual?')) throw new Error('Cancelado');
      try { localStorage.removeItem('farming_perfil'); Object.keys(localStorage).filter(k => k.startsWith('farming_snap_')).forEach(k => localStorage.removeItem(k)); } catch { }
      await this.c.auth.signOut();
    }
    async cambiarPassword(pass) {
      const { error } = await this.c.auth.updateUser({ password: pass });
      if (error) throw new Error(error.message);
    }
    async todo(tabla, filtro) {
      const out = []; let from = 0; const paso = 1000;
      while (true) {
        let q = this.c.from(tabla).select('*').range(from, from + paso - 1).order('creado', { ascending: true });
        if (filtro) q = filtro(q);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...data);
        if (data.length < paso) break;
        from += paso;
      }
      return out;
    }
    async cargar() {
      const id = await this.miId();
      const k = 'farming_snap_' + id;
      let d;
      try {
        if (!navigator.onLine) throw new Error('Failed to fetch');
        const [perfiles, zonas, asignaciones, visitas, jornadas, notas] = await Promise.all([
          ...['perfiles', 'zonas', 'asignaciones', 'visitas', 'jornadas'].map(t => this.todo(t)),
          this.todo('notas').catch(e => { if (esRed(e)) throw e; return []; }), // si todavía no se corrió la actualización v4
        ]);
        d = { perfiles, zonas, asignaciones, visitas, jornadas, notas };
        this.offline = false;
        const yo = lsGet('farming_perfil');
        if (yo && yo.rol !== 'admin') lsSet(k, d); // el asesor guarda una copia para trabajar sin señal
      } catch (e) {
        if (!esRed(e)) throw e;
        d = lsGet(k);
        if (!d) throw new Error('Sin conexión. Abrí la app una vez con señal para poder usarla sin conexión.');
        d.notas = d.notas || [];
        this.offline = true;
      }
      // Aplicar lo que está esperando para subirse
      for (const it of await Cola.todos()) {
        const t = d[it.tabla]; if (!t) continue;
        if (it.op === 'insert') t.push({ ...it.row });
        else if (it.op === 'update') { const r = t.find(x => x.id === it.id); if (r) Object.assign(r, it.row, { pendiente: true }); }
        else if (it.op === 'delete') d[it.tabla] = t.filter(x => x.id !== it.id);
      }
      this.avisar();
      return d;
    }
    async pendientesSubir() { return (await Cola.todos()).length; }
    async encolar(it) { await Cola.agregar(it); this.offline = !navigator.onLine || this.offline; this.avisar(); }
    async sincronizar() {
      if (this.sincronizando || !navigator.onLine) return;
      const items = (await Cola.todos()).sort((a, b) => a.k - b.k);
      if (!items.length) { if (this.offline) { this.offline = false; this.avisar(); } return; }
      this.sincronizando = true; this.avisar();
      const mapa = new Map(); let subidos = 0, corte = false;
      try {
        for (const it of items) {
          try {
            if (it.op === 'insert') {
              const row = { ...it.row }; const tmp = row.id;
              delete row.id; delete row.pendiente;
              for (const c in row) if (typeof row[c] === 'string' && mapa.has(row[c])) row[c] = mapa.get(row[c]); // referencias a datos cargados sin señal
              if (Array.isArray(row.fotos)) {
                const reales = [];
                for (const f of row.fotos) {
                  if (String(f).startsWith('pendiente:')) { const bk = f.slice(10); const b = await Cola.blob(bk); if (b) reales.push(await this._subir(b)); }
                  else reales.push(f);
                }
                row.fotos = reales;
              }
              const { data, error } = await this.c.from(it.tabla).insert(row).select().single();
              if (error) throw error;
              mapa.set(tmp, data.id);
              for (const f of it.row.fotos || []) if (String(f).startsWith('pendiente:')) await Cola.borrarBlob(f.slice(10));
            } else {
              const id = mapa.get(it.id) || it.id;
              if (String(id).startsWith('tmp-')) { await Cola.borrar(it.k); continue; }
              const q = it.op === 'update' ? this.c.from(it.tabla).update(it.row).eq('id', id) : this.c.from(it.tabla).delete().eq('id', id);
              if (it.op === 'update' && it.row.fotos) for (let i = 0; i < it.row.fotos.length; i++) { const f = it.row.fotos[i]; if (String(f).startsWith('pendiente:')) { const bl = await Cola.blob(f.slice(10)); it.row.fotos[i] = bl ? await this._subir(bl) : null; } }
              if (it.op === 'update' && it.row.fotos) it.row.fotos = it.row.fotos.filter(Boolean);
              const { error } = await q; if (error) throw error;
            }
            await Cola.borrar(it.k); subidos++;
          } catch (e) {
            if (esRed(e)) { corte = true; break; }
            this.fallidos.push(e.message && e.message.includes('row-level') ? 'Un dato cargado sin señal no se pudo subir porque el plazo de la zona ya había vencido.' : 'No se pudo subir un dato: ' + (e.message || e));
            await Cola.borrar(it.k);
          }
        }
      } finally {
        this.sincronizando = false;
        this.offline = corte;
        this.avisar({ subidos, recargar: subidos > 0 });
      }
    }
    async guardarZona(z) {
      const row = { nombre: z.nombre, color: z.color, geometria: z.geometria, calles_limite: z.calles_limite || [], cuadras: z.cuadras || [], barrio: z.barrio || null };
      const q = z.id ? this.c.from('zonas').update(row).eq('id', z.id) : this.c.from('zonas').insert(row);
      const { data, error } = await q.select().single();
      if (error) throw error;
      return data;
    }
    async borrarZona(id) { const { error } = await this.c.from('zonas').delete().eq('id', id); if (error) throw error; }
    async api(path, body) {
      const { data: { session } } = await this.c.auth.getSession();
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session?.access_token || '') }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Error del servidor (' + r.status + ')');
      return j;
    }
    asignar(zona_id, asesor) { return this.api('/api/asignar', { zona_id, asesor }); }
    resetAcceso(asesor_id) { return this.api('/api/acceso', { asesor_id }); }
    async alturasOficiales(puntos) { return await this.api('/api/alturas', { puntos }); }
    async renovar(a) {
      const { data, error } = await this.c.from('asignaciones').update({
        estado: 'activa', vence: new Date(Date.now() + 90 * DIA).toISOString(),
        renovaciones: (a.renovaciones || 0) + 1, alerta_enviada: false, aviso_previo: false, aviso_30: false,
      }).eq('id', a.id).select().single();
      if (error) throw error; return data;
    }
    async liberar(a) {
      const { data, error } = await this.c.from('asignaciones').update({ estado: 'finalizada', finalizada: new Date().toISOString(), motivo_fin: 'liberada' })
        .eq('id', a.id).select().single();
      if (error) throw error; return data;
    }
    async agregar(tabla, row) {
      const offline = async () => {
        const yo = await this.miId();
        const r = { ...row, id: 'tmp-' + uid(), ...(tabla === 'notas' ? { autor_id: yo } : { asesor_id: row.asesor_id || yo }), creado: new Date().toISOString(), pendiente: true };
        await this.encolar({ op: 'insert', tabla, row: r });
        return r;
      };
      if (!navigator.onLine || (row.fotos || []).some(f => String(f).startsWith('pendiente:'))) return offline();
      const { data, error } = await this.c.from(tabla).insert(row).select().single();
      if (error) {
        if (esRed(error)) return offline();
        throw new Error(error.message.includes('row-level') ? 'Tu plazo de la zona venció: no se pueden cargar datos.' : error.message);
      }
      return data;
    }
    async editar(tabla, id, row) {
      if (String(id).startsWith('tmp-')) {
        const it = (await Cola.todos()).find(x => x.op === 'insert' && x.row.id === id);
        if (it) { Object.assign(it.row, row); await Cola.guardar(it); this.avisar(); return it.row; }
      }
      if (!navigator.onLine || (row.fotos || []).some(f => String(f).startsWith('pendiente:'))) { await this.encolar({ op: 'update', tabla, id, row }); return { id, ...row }; }
      const { data, error } = await this.c.from(tabla).update(row).eq('id', id).select().single();
      if (error) { if (esRed(error)) { await this.encolar({ op: 'update', tabla, id, row }); return { id, ...row }; } throw error; }
      return data;
    }
    async borrar(tabla, id) {
      if (String(id).startsWith('tmp-')) {
        const it = (await Cola.todos()).find(x => x.op === 'insert' && x.row.id === id);
        if (it) { for (const f of it.row.fotos || []) if (String(f).startsWith('pendiente:')) await Cola.borrarBlob(f.slice(10)); await Cola.borrar(it.k); this.avisar(); }
        return;
      }
      if (!navigator.onLine) { await this.encolar({ op: 'delete', tabla, id }); return; }
      if (tabla === 'visitas') {
        const { data } = await this.c.from('visitas').select('fotos').eq('id', id).maybeSingle();
        if (data && data.fotos && data.fotos.length) await this.c.storage.from('fotos').remove(data.fotos);
      }
      const { error } = await this.c.from(tabla).delete().eq('id', id); if (error) throw error;
    }
    // Fotos: se guardan en la carpeta del asesor y se ven con enlaces temporales
    async borrarFotos(paths) {
      const reales = (paths || []).filter(p => !String(p).startsWith('pendiente:'));
      if (reales.length && navigator.onLine) { try { await this.c.storage.from('fotos').remove(reales); } catch { } }
    }
    async _subir(blob) {
      const id = await this.miId();
      const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await this.c.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw esRed(error) ? new Error('Failed to fetch') : new Error('No se pudo subir la foto: ' + error.message);
      return path;
    }
    async subirFoto(blob) {
      const guardarLocal = async () => { const k = 'f-' + uid(); await Cola.ponerBlob(k, blob); return 'pendiente:' + k; };
      if (!navigator.onLine) return guardarLocal();
      try { return await this._subir(blob); }
      catch (e) { if (esRed(e)) return guardarLocal(); throw e; }
    }
    async urlsFotos(paths) {
      const out = {};
      const pend = paths.filter(p => String(p).startsWith('pendiente:'));
      for (const p of pend) { const b = await Cola.blob(p.slice(10)); if (b) out[p] = URL.createObjectURL(b); }
      const reales = paths.filter(p => !String(p).startsWith('pendiente:'));
      if (!reales.length || !navigator.onLine) return out;
      const { data, error } = await this.c.storage.from('fotos').createSignedUrls(reales, 3600);
      if (error) return out;
      (data || []).forEach(d => { if (d.signedUrl) out[d.path] = d.signedUrl; });
      return out;
    }
  }

  // ------------------------------------------------------------------
  class DemoBackend {
    constructor() { this.modo = 'demo'; this.k = 'farming_demo_v1'; this.load(); }
    load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(this.k)); } catch { }
      this.d = d || {
        yo: null,
        perfiles: [{ id: 'admin', nombre: 'Diego', apellido: 'Pulvirenti', email: 'broker@demo', rol: 'admin', creado: new Date().toISOString() }],
        zonas: [], asignaciones: [], visitas: [], jornadas: [], notas: [],
      };
      this.d.notas = this.d.notas || [];
    }
    save() { try { localStorage.setItem(this.k, JSON.stringify(this.d)); } catch { } }
    async perfil() { return this.d.perfiles.find(p => p.id === this.d.yo) || null; }
    async loginComo(id) { this.d.yo = id; this.save(); return this.perfil(); }
    async login() { throw new Error('En modo demostración elegí con qué usuario entrar.'); }
    async logout() { this.d.yo = null; this.save(); }
    async cambiarPassword() { }
    async cargar() {
      const yo = await this.perfil();
      const d = JSON.parse(JSON.stringify(this.d));
      if (yo && yo.rol !== 'admin') {
        d.asignaciones = d.asignaciones.filter(a => a.asesor_id === yo.id);
        const zs = new Set(d.asignaciones.filter(a => a.estado !== 'finalizada').map(a => a.zona_id));
        d.zonas = d.zonas.filter(z => zs.has(z.id));
        const asigZona = new Set(this.d.asignaciones.filter(a => zs.has(a.zona_id)).map(a => a.id));
        d.visitas = d.visitas.filter(v => v.asesor_id === yo.id || asigZona.has(v.asignacion_id));
        const vis = new Set(d.visitas.map(v => v.id));
        d.notas = (d.notas || []).filter(n => vis.has(n.visita_id));
        d.jornadas = d.jornadas.filter(v => v.asesor_id === yo.id);
        d.perfiles = d.perfiles.filter(p => p.id === yo.id);
      }
      return d;
    }
    async guardarZona(z) {
      if (z.id) { const i = this.d.zonas.findIndex(x => x.id === z.id); this.d.zonas[i] = { ...this.d.zonas[i], ...z }; this.save(); return this.d.zonas[i]; }
      const row = { ...z, id: uid(), creado: new Date().toISOString() };
      this.d.zonas.push(row); this.save(); return row;
    }
    async borrarZona(id) {
      const as = new Set(this.d.asignaciones.filter(a => a.zona_id === id).map(a => a.id));
      this.d.zonas = this.d.zonas.filter(z => z.id !== id);
      this.d.asignaciones = this.d.asignaciones.filter(a => a.zona_id !== id);
      this.d.visitas = this.d.visitas.filter(v => !as.has(v.asignacion_id));
      this.d.jornadas = this.d.jornadas.filter(v => !as.has(v.asignacion_id));
      this.save();
    }
    async asignar(zona_id, asesor) {
      let p = asesor.id ? this.d.perfiles.find(x => x.id === asesor.id) : this.d.perfiles.find(x => x.email === asesor.email.trim().toLowerCase());
      let passTemporal = null;
      if (!p) {
        if (!asesor.nombre || !asesor.apellido || !/@/.test(asesor.email || '')) throw new Error('Completá nombre, apellido y correo.');
        p = { id: uid(), nombre: asesor.nombre.trim(), apellido: asesor.apellido.trim(), email: asesor.email.trim().toLowerCase(), rol: 'asesor', creado: new Date().toISOString() };
        this.d.perfiles.push(p); passTemporal = 'C21-demo-0000';
      }
      const now = new Date();
      this.d.asignaciones.forEach(a => { if (a.zona_id === zona_id && a.estado !== 'finalizada') { a.estado = 'finalizada'; a.finalizada = now.toISOString(); a.motivo_fin = 'reasignada'; } });
      const a = { id: uid(), zona_id, asesor_id: p.id, inicio: now.toISOString(), vence: new Date(now.getTime() + 90 * DIA).toISOString(), estado: 'activa', renovaciones: 0, creado: now.toISOString() };
      this.d.asignaciones.push(a); this.save();
      return { asignacion: a, asesor: p, passTemporal, mail: { enviado: false, error: 'Modo demostración: no se envían mails.' } };
    }
    async alturasOficiales() { return null; }
    async resetAcceso() { return { passTemporal: 'C21-demo-0000', mail: { enviado: false, error: 'Modo demostración: no se envían mails.' } }; }
    async renovar(a) { const x = this.d.asignaciones.find(y => y.id === a.id); Object.assign(x, { estado: 'activa', vence: new Date(Date.now() + 90 * DIA).toISOString(), renovaciones: (x.renovaciones || 0) + 1 }); this.save(); return x; }
    async subirFoto(blob) {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      return url; // en la demo la foto queda guardada en el navegador
    }
    async urlsFotos(paths) { const o = {}; paths.forEach(p => o[p] = p); return o; }
    async liberar(a) { const x = this.d.asignaciones.find(y => y.id === a.id); Object.assign(x, { estado: 'finalizada', finalizada: new Date().toISOString(), motivo_fin: 'liberada' }); this.save(); return x; }
    async agregar(tabla, row) {
      const asigId = tabla === 'notas' ? (this.d.visitas.find(v => v.id === row.visita_id) || {}).asignacion_id : row.asignacion_id;
      const a = this.d.asignaciones.find(x => x.id === asigId);
      const yo = await this.perfil();
      if (yo.rol !== 'admin' && (!a || a.estado !== 'activa' || new Date(a.vence) < new Date())) throw new Error('Tu plazo de la zona venció: no se pueden cargar datos.');
      const r = tabla === 'notas' ? { ...row, id: uid(), autor_id: yo.id, creado: new Date().toISOString() } : { ...row, id: uid(), asesor_id: row.asesor_id || yo.id, creado: new Date().toISOString() };
      this.d[tabla].push(r); this.save(); return r;
    }
    async editar(tabla, id, row) { const x = this.d[tabla].find(y => y.id === id); Object.assign(x, row); this.save(); return x; }
    async borrar(tabla, id) { this.d[tabla] = this.d[tabla].filter(x => x.id !== id); if (tabla === 'visitas') this.d.notas = this.d.notas.filter(n => n.visita_id !== id); this.save(); }
    async borrarFotos() { }
    // utilidades sólo para la demo
    simularVencimiento(asigId) { const a = this.d.asignaciones.find(x => x.id === asigId); a.vence = new Date(Date.now() - 3600e3).toISOString(); this.save(); }
    reiniciar() { localStorage.removeItem(this.k); this.load(); }
  }

  async function crearBackend() {
    let c = null;
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok) { c = await r.json(); if (c.supabaseUrl) lsSet('farming_config', c); }
    } catch { }
    if (!c || !c.supabaseUrl) c = lsGet('farming_config') || c; // sin señal: usar la última configuración conocida
    if (c && c.supabaseUrl && c.supabaseAnonKey && root.supabase) return new SupabaseBackend(c.supabaseUrl, c.supabaseAnonKey);
    if (c && c.supabaseUrl && !root.supabase) throw new Error('Sin conexión. Abrí la app una vez con señal para poder usarla sin conexión.');
    return new DemoBackend();
  }

  root.Datos = { crearBackend, DIA };
})(window);
