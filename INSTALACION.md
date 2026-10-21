# Farming C21 Inmopul — Guía de instalación

Tiempo estimado: 30–40 minutos, una sola vez. Conviene hacerlo desde una computadora.
Todo es gratuito para el volumen de un equipo de asesores.

Vas a usar tres servicios:

| Servicio | Para qué | Costo |
|---|---|---|
| **Supabase** | Base de datos y usuarios (guarda zonas, casas, jornadas) | Gratis |
| **GitHub** | Guarda los archivos del sistema | Gratis |
| **Netlify** | Publica la página en internet y envía los mails | Gratis |

> **Antes de configurar nada**, la página ya funciona en **modo demostración**: se guarda todo en el navegador y no envía mails. Sirve para probarla.

---

## 1. Supabase (base de datos)

1. Entrá a **supabase.com** → *Start your project* → registrate.
2. *New project*:
   - Nombre: `farming-c21`
   - Contraseña de base de datos: inventá una y guardala.
   - Región: **South America (São Paulo)**.
3. Esperá un par de minutos a que se cree.
4. Menú izquierdo → **SQL Editor** → *New query*. Abrí el archivo `supabase/esquema.sql`, copiá **todo** el contenido, pegalo y tocá **Run**. Debe decir *Success*.
5. Menú izquierdo → **Authentication → Users → Add user → Create new user**:
   - Tu correo y una contraseña.
   - Tildá **Auto Confirm User**.
   - **Importante:** el primer usuario que se crea queda como **broker (administrador)**. Creá el tuyo antes que cualquier otro.
6. **Authentication → Sign In / Providers** (o *Settings*): desactivá **Allow new users to sign up**. Así nadie puede crearse una cuenta por su cuenta; los asesores los das de alta vos al asignarles una zona.
7. **Project Settings → API** (o *Data API* / *API Keys*). Copiá y guardá:
   - **Project URL** (empieza con `https://…supabase.co`)
   - **anon public** key
   - **service_role** key (es secreta: no la compartas con nadie)

## 2. Datos del correo (para enviar los mails)

Los mails salen desde tu casilla. Necesitás sus datos SMTP:

- **Si tu correo es de Google Workspace** (entrás por Gmail):
  - Servidor: `smtp.gmail.com` · Puerto: `465`
  - Usuario: tu correo completo
  - Contraseña: una **contraseña de aplicación**. Se genera en *myaccount.google.com → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones*. Requiere tener activada la verificación en 2 pasos.
- **Si es de otro proveedor:** pedile a quien administra el correo de Century 21 el *servidor SMTP*, el *puerto* y si podés usar tu contraseña para enviar desde aplicaciones.

## 3. GitHub (archivos del sistema)

1. Entrá a **github.com** → registrate.
2. Arriba a la derecha **+ → New repository**:
   - Nombre: `farming-c21`
   - Marcá **Private**.
   - *Create repository*.
3. En la página del repositorio vacío, tocá **uploading an existing file**.
4. Descomprimí el ZIP en tu computadora. Abrí la carpeta `farming-c21` y **arrastrá todo su contenido** (las carpetas `public`, `netlify`, `supabase` y los archivos `netlify.toml`, `package.json`, `INSTALACION.md`) a la página de GitHub.
5. Abajo, **Commit changes**.

## 4. Netlify (publicar la página)

1. Entrá a **netlify.com** → registrate **con tu cuenta de GitHub**.
2. **Add new site → Import an existing project → GitHub** → elegí `farming-c21`.
3. No toques nada de la configuración de build → **Deploy**.
4. Cuando termine, andá a **Site configuration → Environment variables → Add a variable → Add a single variable** y cargá una por una:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | Project URL de Supabase |
| `SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SMTP_HOST` | p. ej. `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `Diego.pulvirenti@devoto.c21inmopulsrl.com.ar` |
| `SMTP_PASS` | contraseña de aplicación / de la casilla |
| `MAIL_FROM` | `Diego Pulvirenti · C21 Inmopul <Diego.pulvirenti@devoto.c21inmopulsrl.com.ar>` |
| `ADMIN_EMAIL` | tu correo (ahí llegan las alertas de vencimiento) |

5. **Deploys → Trigger deploy → Deploy site** para que tome las variables.
6. **Site configuration → Change site name**: por ejemplo `farming-inmopul` → tu dirección queda `https://farming-inmopul.netlify.app`.

## 5. Primer uso

1. Abrí tu dirección de Netlify e ingresá con el usuario que creaste en Supabase.
2. **Mapa → Dibujar zona** (tocás las esquinas en el mapa) o **Zona por calles** (escribís las calles que la encierran, en orden).
   - La primera vez descarga el callejero de los tres barrios; tarda unos segundos.
3. Guardá la zona y asignala: nombre, apellido y correo del asesor. Le llega un mail con la zona, su usuario y una contraseña provisoria.
4. Si el mail no llega, la pantalla te muestra los datos y un botón para mandárselos por **WhatsApp**.

## Actualización v2 (si ya tenías la versión anterior instalada)

1. Supabase → **SQL Editor → New snippet**: pegá todo el archivo `supabase/actualizacion-v2.sql` y tocá **Run**. Agrega los campos nuevos y habilita las fotos.
2. Subí a GitHub el contenido de la carpeta como siempre (reemplaza los archivos).

Si instalás desde cero, no hace falta: `esquema.sql` ya lo incluye.

## Avisos automáticos (todos los días a las 8:00)

| Aviso | A quién |
|---|---|
| Zona vencida / le quedan 7 días | Broker |
| Le quedan 30 días: "dar vuelta la racha" | Asesor |
| 7 días sin cargar casas ni jornadas (se repite cada semana) | Asesor, con copia al broker |
| Contactos que quieren vender o están en venta con colegas: llamar cada 15 días | Asesor |

## Cómo funciona el plazo de 90 días

- Cada asignación dura 90 días desde que la hacés. El asesor ve la cuenta regresiva en su panel.
- Todos los días a las 8:00 el sistema revisa los plazos. Te avisa por mail **7 días antes** y **cuando vence**.
- Al vencer, la zona aparece marcada en rojo en tu panel y el asesor ya no puede cargar datos. Vos decidís: **Renovar 90 días**, **Asignar a otro** o **Dejarla libre**.
- Todo lo cargado queda en el **Historial** de la zona aunque la reasignes.

## Numeración de las cuadras

Las calles y esquinas salen de OpenStreetMap y se cortan solas en cuadras. La altura (por ejemplo 3200–3299) se toma de las direcciones cargadas en el mapa. Si alguna calle no tiene numeración o está invertida, corregila en la zona → pestaña **Cuadras**: escribís la altura de la primera cuadra y tocás *Aplicar* (con ⇅ invertís el sentido).

## Si algo falla

- **La página entra en "modo demostración" aunque cargué todo:** revisá que `SUPABASE_URL` y `SUPABASE_ANON_KEY` estén bien escritas y volvé a hacer *Trigger deploy*.
- **No salen los mails:** revisá las variables `SMTP_…`. En Netlify → *Logs → Functions → asignar* aparece el motivo.
- **Olvidaron la contraseña:** pestaña **Asesores → Reenviar acceso**.
- **Agregar otro administrador:** en Supabase → SQL Editor:
  `update public.perfiles set rol = 'admin' where email = 'correo@ejemplo.com';`
