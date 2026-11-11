# Reflexión y Resultados · Práctica CI/CD con Firebase Hosting y Hardening HTTP

---

## Entregable 4 · Medición de Headers (`check-headers.mjs`)

### B1 · Medición inicial (antes de configurar `firebase.json`)

Con `headers: []` en `firebase.json`:

```text
▶ HTML: https://<PROJECT_ID>.web.app/
  status 200
  ✘ content-security-policy (falta)
  ✘ strict-transport-security (falta)
  ✘ x-content-type-options (falta)
  ✘ x-frame-options (falta)
  ✘ referrer-policy (falta)
  ✘ permissions-policy (falta)
  · cache-control: max-age=3600

▶ Asset estático: /_next/static/chunks/2r4s4h5xul1n-.js
  ✘ cache-control: max-age=3600

❌ 7 control(es) pendiente(s).
```
- **Calificación inicial en SecurityHeaders.com:** `F` (ningún header de seguridad presente).

---

### B5 · Medición final (después de configurar `firebase.json` + hashes CSP en el pipeline)

```text
▶ HTML: https://<PROJECT_ID>.web.app/
  status 200
  ✔ content-security-policy: default-src 'self'; script-src 'self' 'sha256-mF3f98N7xi7PbfvF+949N3d3IC8c5fQp+p/7bV/uI4E=' 'sha256-47DEQpj8HBSa…
  ✔ strict-transport-security: max-age=31536000; includeSubDomains; preload
  ✔ x-content-type-options: nosniff
  ✔ x-frame-options: DENY
  ✔ referrer-policy: strict-origin-when-cross-origin
  ✔ permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
  · cache-control: public, max-age=0, must-revalidate

▶ Asset estático: /_next/static/chunks/2r4s4h5xul1n-.js
  ✔ cache-control: public, max-age=31536000, immutable

✅ Todos los controles pasaron.
```
- **Calificación final en SecurityHeaders.com:** `A+`.

---

## Entregable 5 · Respuestas a las preguntas de reflexión (Sección 8)

### 1. ¿Por qué el preview tiene vencimiento? ¿Qué riesgos tendría un preview que no vence nunca?
Un canal de preview es un **entorno efímero** cuyo único propósito es validar los cambios de un Pull Request antes de integrarlos a `main`. Configuramos `expires: 3d` porque una vez revisado y mergeado (o cerrado) el PR, el entorno ya cumplió su función.

Si los previews no vencieran nunca, existirían tres riesgos concretos:
1. **Superficie de ataque con código obsoleto ("Zombie environments"):** Versiones viejas con vulnerabilidades ya corregidas en `main` seguirían publicadas bajo el mismo dominio raíz (`*.web.app`), exponiendo endpoints de API de prueba, lógica experimental o dependencias vulnerables.
2. **Confusión y filtración de funcionalidades no lanzadas:** Las URLs de preview son públicas por defecto en Firebase Hosting; enlaces compartidos o indexados accidentalmente permitirían acceder a features incompletas o descartadas.
3. **Límites de cuota y almacenamiento:** Firebase Hosting impone límites en la cantidad de canales activos y almacenamiento total del plan Spark; no expirar canales agotaría la cuota y bloquearía nuevos PRs.

---

### 2. ¿Qué diferencia hay entre *desplegar* y *liberar*? ¿Dónde aparece cada concepto en este flujo?
- **Desplegar (*Deploy*):** Es el acto técnico de compilar artefactos e instalarlos en la infraestructura de hosting (subir los archivos de `out/` a los servidores de Firebase). No implica necesariamente que los usuarios finales los vean.
- **Liberar (*Release*):** Es el acto de negocio/operativo de hacer que una versión ya desplegada reciba el tráfico real de los usuarios en producción.

**Dónde aparecen en nuestro flujo:**
- En cada Pull Request **desplegamos sin liberar** a producción: el código se sube a un canal aislado (`pr-N`) sin afectar a los usuarios reales.
- Cuando ejecutamos un **rollback** desde el historial de versiones de Firebase o promovemos un canal con `npx firebase hosting:clone <PROJECT_ID>:<CANAL> <PROJECT_ID>:live`, estamos **liberando sin volver a compilar ni desplegar**: Firebase simplemente cambia el puntero del canal `live` hacia un artefacto inmutable ya almacenado en su CDN.

---

### 3. ¿Por qué la clave de la service account va en un secreto y no en el repo? ¿Qué podría hacer alguien que la obtenga? ¿Cómo limitarías el daño?
- **Por qué va en un secreto:** Si el JSON de la Service Account se commiteara en el repositorio, quedaría grabado de forma permanente en el historial de Git y cualquier persona con acceso de lectura al repo (o cualquiera en internet si el repo es público) podría extraer la clave privada criptográfica. En cambio, en GitHub Actions Secrets se almacena cifrada, nunca se expone a forks y se enmascara (`***`) en los logs.
- **Qué podría hacer un atacante que la obtenga:** Podría autenticar la CLI o la API de Google Cloud/Firebase y **reemplazar el sitio en producción** (ataque de *defacement*, inyección de scripts de *phishing* o *magecart* para robar credenciales/tarjetas de usuarios) o borrar canales y versiones previas para impedir un rollback rápido.
- **Cómo limitar el daño (Principio de Mínimo Privilegio y Respuesta a Incidentes):**
  1. **Rol acotado (Least Privilege):** Otorgar a la Service Account únicamente el rol `Firebase Hosting Admin` (`roles/firebasehosting.admin`), sin permisos sobre Firestore, Auth, Cloud Run ni IAM.
  2. **Revocación y rotación inmediata:** Ante una filtración, eliminar la clave comprometida en *Google Cloud Console → IAM & Admin → Service Accounts → Keys* e inyectar una nueva en GitHub Secrets.
  3. **Alternativa en equipos reales (Workload Identity Federation - OIDC):** Eliminar por completo las claves JSON de larga duración y usar federación de identidad OIDC entre GitHub Actions y Google Cloud (`google-github-actions/auth`), generando tokens efímeros por ejecución.

---

### 4. La CSP rompió la app: ¿por qué? ¿Qué opciones evaluaste y qué costo de seguridad tiene cada una?
Al aplicar la CSP base (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; ...`), se rompieron dos funcionalidades:

1. **El filtro interactivo en `/cursos` dejó de funcionar:**
   - **Causa:** Aunque nuestro código está en archivos `.js` externos bajo `/_next/static/chunks/`, el export estático de Next.js App Router inyecta en `out/cursos.html` y `out/index.html` bloques `<script>` inline (como `self.__next_f.push(...)`) que contienen el payload de React Server Components (RSC) y el bootstrap de Turbopack necesarios para hidratar los Client Components (`FiltroCursos`). Con `script-src 'self'`, el navegador bloquea todo script inline.
   - **Opciones evaluadas y costo de seguridad:**
     - *Opción A (`'unsafe-inline'` en `script-src`):* Hace que la app funcione rápido, pero **neutraliza la principal defensa de CSP contra XSS**, ya que cualquier inyección de HTML permitiría ejecutar `<script>` arbitrarios.
     - *Opción B (`nonce-<valor>`):* No es viable en Firebase Hosting (plan Spark) porque sirve archivos estáticos pregenerados y no hay un servidor backend que genere un nonce único por cada request HTTP.
     - *Opción C (Hashes `'sha256-...'` calculados en el pipeline — **Opción elegida / Nivel Destacado**):* Creamos el script [`scripts/csp-hashes.mjs`](./scripts/csp-hashes.mjs) que se ejecuta tras `next build`, recorre todos los `.html` de `out/`, calcula el hash SHA-256 en base64 de cada `<script>` inline y actualiza `script-src` en `firebase.json`. **Costo de seguridad nulo:** mantiene bloqueo total de scripts inline no autorizados sin requerir servidor.

2. **La imagen de portada en `/` se bloqueó:**
   - **Causa:** El `<img src="https://picsum.photos/seed/programacion-avanzada/960/320">` solicita la imagen a `https://picsum.photos`, pero ese servidor responde con una redirección HTTP `302` hacia el CDN `https://fastly.picsum.photos/...`. Según el estándar CSP, ante una redirección deben estar autorizados **tanto el origen inicial como el origen destino**.
   - **Solución y costo:** Se configuró `img-src 'self' https://picsum.photos https://fastly.picsum.photos` (restringido exclusivamente a esos dos orígenes HTTPS exactos, en lugar de abrir `https:` o `*` que permitirían exfiltrar datos vía *tracking pixels* a cualquier dominio).

---

### 5. Para cada header de B2 (y adicionales), ¿qué ataque mitiga?

| Header configurado | Valor aplicado | Ataque que mitiga |
| :--- | :--- | :--- |
| `Strict-Transport-Security` (HSTS) | `max-age=31536000; includeSubDomains; preload` | **SSL Stripping / Man-in-the-Middle (MitM) y Downgrade Attacks:** Fuerza al navegador a conectarse exclusivamente por HTTPS durante 1 año (incluso si el usuario escribe `http://`), impidiendo que un atacante en la red local intercepte la primera petición en texto plano. |
| `X-Content-Type-Options` | `nosniff` | **MIME Confusion / Drive-by Download XSS:** Impide que el navegador ignore el `Content-Type` declarado e intente "adivinar" (*sniff*) el formato ejecutando, por ejemplo, un archivo de texto o imagen malicioso como si fuera HTML o JavaScript. |
| `X-Frame-Options` | `DENY` | **Clickjacking (UI Redressing):** Impide que un sitio malicioso embeba nuestra aplicación dentro de un `<iframe>` invisible para engañar al usuario y hacerle clickear botones sin saberlo (complementado por `frame-ancestors 'none'` en la CSP). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **Information Disclosure / Fuga de datos sensibles en URLs:** Al navegar hacia un sitio externo en HTTPS, envía únicamente el origen (`https://dominio.web.app/`) sin la ruta ni los *query params* internos; si cae a HTTP, no envía nada. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), ...` | **Abuso de APIs de hardware/navegador:** Deshabilita a nivel documento (y para cualquier iframe) el acceso a cámara, micrófono, geolocalización y USB; si ocurriera un XSS o dependencia maliciosa, no podría espiar a través de estos sensores. |
| `Cross-Origin-Opener-Policy` (COOP) | `same-origin` | **Ataques Cross-Origin (XS-Leaks / Spectre / Tabnabbing):** Aísla el grupo de contexto de navegación de la pestaña para que ventanas externas abiertas no compartan proceso ni referencia `window.opener`. |

---

### 6. ¿Por qué los assets de `/_next/static/` pueden cachearse un año y el HTML no?
- **Assets de `/_next/static/**` (`public, max-age=31536000, immutable`):** Next.js aplica *Cache Busting* mediante **hashes de contenido en el nombre del archivo** (por ejemplo, `/_next/static/chunks/27gjg8e11zukd.js`). Si cambia una sola línea de código, el próximo build generará un archivo con un nombre distinto. Como el contenido para una misma URL jamás cambia, el navegador y el CDN pueden guardarlo por 1 año sin ni siquiera consultar si cambió (`immutable`).
- **Archivos HTML (`public, max-age=0, must-revalidate`):** Las rutas que visita el usuario (`/`, `/cursos`) tienen **URLs fijas sin hash en el nombre**, y son el punto de entrada que referencia qué nombres de chunks `.js` y `.css` deben cargarse.
- **Impacto en deploys y rollbacks:** Si el HTML se cacheara por un año sin revalidar, cuando publiquemos una nueva versión o ejecutemos un **rollback de emergencia**, los usuarios que ya visitaron la web seguirían viendo la versión vieja guardada en la caché de su navegador y ni se enterarían del rollback. Con `max-age=0, must-revalidate`, el navegador valida el `ETag` del HTML en cada carga: si no hubo deploy recibe un `304 Not Modified` liviano, y si hubo deploy o rollback descarga de inmediato el nuevo HTML junto con los nuevos chunks.

---

### 7. Si la app necesitara SSR, ¿qué cambiaría en la arquitectura, en la CSP y en el costo?
1. **En la arquitectura:** Ya no podríamos usar `output: "export"` ni servir únicamente una carpeta estática `out/`. Necesitaríamos un runtime Node.js bajo demanda para ejecutar las páginas en cada request: en el ecosistema Firebase pasaríamos de Firebase Hosting estático a **Firebase App Hosting** (que empaqueta la app Next.js con Cloud Build y la ejecuta en contenedores serverless sobre **Google Cloud Run** detrás del CDN).
2. **En la CSP:** Al existir un servidor que genera el HTML dinámicamente por cada petición HTTP, podríamos implementar un **Middleware (`middleware.ts` / `proxy.ts`) en Next.js que genere un `nonce` criptográfico aleatorio por request** (`script-src 'self' 'nonce-<valor>' 'strict-dynamic'`), en lugar de tener un header estático en `firebase.json` con hashes precalculados en build-time.
3. **En el costo:** Dejaría de ser costo cero garantizado bajo el plan **Spark**. Firebase App Hosting / Cloud Run exige obligatoriamente actualizar el proyecto al plan **Blaze** (pago por uso con tarjeta de crédito asociada), facturando CPU/memoria por tiempo de cómputo de las instancias de Cloud Run, almacenamiento de imágenes en Artifact Registry y tráfico de red saliente cuando supere la capa gratuita mensual.

---

### Pregunta adicional (A6) · Después del rollback en la consola de Firebase, `main` sigue teniendo el código nuevo. ¿Qué pasa con el próximo merge? ¿Cómo se resuelve en un equipo real?
- **¿Qué pasa con el próximo merge?**
  El rollback desde la consola de Firebase actúa únicamente sobre el **artefacto liberado en Firebase Hosting** (mueve el puntero del canal `live` a un release anterior), pero **no modifica el historial de Git**. Por lo tanto, la rama `main` sigue conteniendo el commit defectuoso. En cuanto alguien mergee cualquier otro Pull Request a `main`, el workflow `firebase-hosting-merge.yml` compilará `main` desde su `HEAD` actual y **volverá a desplegar el código roto en producción**, pisando el rollback manual.
- **¿Cómo se resuelve en un equipo real?**
  1. **Mitigación inmediata (minutos 0–1):** Se ejecuta el rollback desde la consola de Firebase Hosting (o con `firebase hosting:clone`) para restaurar el servicio a los usuarios en segundos sin esperar lo que tarda un build de CI.
  2. **Sincronización de la fuente de verdad (GitOps):** Inmediatamente después, se abre y mergea un Pull Request con `git revert <SHA-defectuoso>` sobre `main` (o un *hotfix* que corrija la causa raíz). Así el estado de `main` vuelve a coincidir con lo que está en producción y el pipeline automático despliega una nueva versión limpia sin reintroducir la regresión en futuros merges.
