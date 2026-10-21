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
  class SupabaseBackend {
    constructor(url, key) {
      this.modo = 'supabase';
      this.c = root.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
    }
    async perfil() {
      const { data: { session } } = await this.c.auth.getSession();
      if (!session) return null;
      const { data, error } = await this.c.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
      if (error) throw error;
      return data;
    }
    async login(email, password) {
      const { error } = await this.c.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Usuario o contraseña incorrectos.' : error.message);
      const p = await this.perfil();
      if (!p) throw new Error('Tu usuario no tiene perfil. Pedile al broker que te asigne una zona.');
      return p;
    }
    async logout() { await this.c.auth.signOut(); }
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
      const [perfiles, zonas, asignaciones, visitas, jornadas] = await Promise.all(
        ['perfiles', 'zonas', 'asignaciones', 'visitas', 'jornadas'].map(t => this.todo(t)));
      return { perfiles, zonas, asignaciones, visitas, jornadas };
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
      const { data, error } = await this.c.from(tabla).insert(row).select().single();
      if (error) throw new Error(error.message.includes('row-level') ? 'Tu plazo de la zona venció: no se pueden cargar datos.' : error.message);
      return data;
    }
    async editar(tabla, id, row) {
      const { data, error } = await this.c.from(tabla).update(row).eq('id', id).select().single();
      if (error) throw error; return data;
    }
    async borrar(tabla, id) {
      if (tabla === 'visitas') {
        const { data } = await this.c.from('visitas').select('fotos').eq('id', id).maybeSingle();
        if (data && data.fotos && data.fotos.length) await this.c.storage.from('fotos').remove(data.fotos);
      }
      const { error } = await this.c.from(tabla).delete().eq('id', id); if (error) throw error;
    }
    // Fotos: se guardan en la carpeta del asesor y se ven con enlaces temporales
    async subirFoto(blob) {
      const { data: { session } } = await this.c.auth.getSession();
      const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await this.c.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error('No se pudo subir la foto: ' + error.message);
      return path;
    }
    async urlsFotos(paths) {
      if (!paths.length) return {};
      const { data, error } = await this.c.storage.from('fotos').createSignedUrls(paths, 3600);
      if (error) return {};
      const out = {}; (data || []).forEach(d => { if (d.signedUrl) out[d.path] = d.signedUrl; });
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
        zonas: [], asignaciones: [], visitas: [], jornadas: [],
      };
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
        d.visitas = d.visitas.filter(v => v.asesor_id === yo.id);
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
    async resetAcceso() { return { passTemporal: 'C21-demo-0000', mail: { enviado: false, error: 'Modo demostración: no se envían mails.' } }; }
    async renovar(a) { const x = this.d.asignaciones.find(y => y.id === a.id); Object.assign(x, { estado: 'activa', vence: new Date(Date.now() + 90 * DIA).toISOString(), renovaciones: (x.renovaciones || 0) + 1 }); this.save(); return x; }
    async subirFoto(blob) {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      return url; // en la demo la foto queda guardada en el navegador
    }
    async urlsFotos(paths) { const o = {}; paths.forEach(p => o[p] = p); return o; }
    async liberar(a) { const x = this.d.asignaciones.find(y => y.id === a.id); Object.assign(x, { estado: 'finalizada', finalizada: new Date().toISOString(), motivo_fin: 'liberada' }); this.save(); return x; }
    async agregar(tabla, row) {
      const a = this.d.asignaciones.find(x => x.id === row.asignacion_id);
      const yo = await this.perfil();
      if (yo.rol !== 'admin' && (!a || a.estado !== 'activa' || new Date(a.vence) < new Date())) throw new Error('Tu plazo de la zona venció: no se pueden cargar datos.');
      const r = { ...row, id: uid(), asesor_id: row.asesor_id || yo.id, creado: new Date().toISOString() };
      this.d[tabla].push(r); this.save(); return r;
    }
    async editar(tabla, id, row) { const x = this.d[tabla].find(y => y.id === id); Object.assign(x, row); this.save(); return x; }
    async borrar(tabla, id) { this.d[tabla] = this.d[tabla].filter(x => x.id !== id); this.save(); }
    // utilidades sólo para la demo
    simularVencimiento(asigId) { const a = this.d.asignaciones.find(x => x.id === asigId); a.vence = new Date(Date.now() - 3600e3).toISOString(); this.save(); }
    reiniciar() { localStorage.removeItem(this.k); this.load(); }
  }

  async function crearBackend() {
    try {
      const r = await fetch('/api/config', { cache: 'no-store' });
      if (r.ok) {
        const c = await r.json();
        if (c.supabaseUrl && c.supabaseAnonKey && root.supabase) return new SupabaseBackend(c.supabaseUrl, c.supabaseAnonKey);
      }
    } catch { }
    return new DemoBackend();
  }

  root.Datos = { crearBackend, DIA };
})(window);
