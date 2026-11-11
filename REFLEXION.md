# Reflexión · Práctica CI/CD con Firebase Hosting y Hardening HTTP

## 1. Salida de `check-headers.mjs` antes (B1) y después (B5)

### Antes (B1 - Medición inicial sin headers configurados)
```text
▶ HTML: https://practica-cicd-cursos-28354.web.app/
  status 200
  ✘ content-security-policy (falta)
  ✘ strict-transport-security (falta)
  ✘ x-content-type-options (falta)
  ✘ x-frame-options (falta)
  ✘ referrer-policy (falta)
  ✘ permissions-policy (falta)
  · cache-control: max-age=3600

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✘ cache-control: max-age=3600

❌ 7 control(es) pendiente(s).
```
- **Calificación inicial en securityheaders.com:** `F`

### Después (B5 - Con headers de seguridad, CSP con hashes y caché diferenciada)
```text
▶ HTML: https://practica-cicd-cursos-28354.web.app/
  status 200
  ✔ content-security-policy: default-src 'self'; script-src 'self' 'sha256-ohBYDP4jDEhpM4V4o0iLmc/txsVyq1JPbtSx6ah7HBw=' 'sha256-OBTN3RiyCV…
  ✔ strict-transport-security: max-age=31536000; includeSubDomains; preload
  ✔ x-content-type-options: nosniff
  ✔ x-frame-options: DENY
  ✔ referrer-policy: strict-origin-when-cross-origin
  ✔ permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
  · cache-control: public, max-age=0, must-revalidate

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✔ cache-control: public, max-age=31536000, immutable

✅ Todos los controles pasaron.
```
- **Calificación final en securityheaders.com:** `A` / `A+`

---

## 2. Respuestas a las preguntas de reflexión

### 1. ¿Por qué el preview tiene vencimiento? ¿Qué riesgos tendría un preview que no vence nunca?
El preview tiene vencimiento (`3d`) porque es un entorno temporal que solo sirve para revisar un Pull Request antes de integrarlo a `main`.
Si no venciera nunca:
- Quedarían publicadas versiones viejas con posibles errores o fallas de seguridad ya corregidas en producción.
- Cualquier persona con el link podría ver funciones incompletas o de prueba.
- Se acumularían canales innecesarios consumiendo el límite gratuito de Firebase Hosting.

### 2. ¿Qué diferencia hay entre *desplegar* y *liberar*? ¿Dónde aparece cada concepto en este flujo?
- **Desplegar (*deploy*):** es subir los archivos compilados al servidor o hosting.
- **Liberar (*release*):** es hacer que esa versión quede visible para los usuarios reales en producción.
- **En nuestro flujo:** cuando abrimos un PR, **desplegamos sin liberar** a producción (va a una URL temporal de preview). En cambio, al hacer un **rollback** en la consola de Firebase o clonar un preview a `live` (`firebase hosting:clone`), **liberamos sin volver a compilar ni desplegar**, cambiando solo qué versión apunta al canal `live`.

### 3. ¿Por qué la clave de la service account va en un secreto y no en el repo? ¿Qué podría hacer alguien que la obtenga? ¿Cómo limitarías el daño?
- **Por qué va en un secreto:** porque si se sube al repositorio queda expuesta en el historial de Git y cualquiera con acceso al repo podría copiarla. En GitHub Secrets viaja cifrada y no se muestra en los logs.
- **Qué podría hacer un atacante:** podría subir contenido falso o malicioso a nuestro sitio en producción o borrar versiones anteriores.
- **Cómo limitar el daño:** dándole a la cuenta de servicio solo permisos sobre Firebase Hosting (*Principio de mínimo privilegio*) y, si se filtra, revocando y rotando la clave de inmediato desde Google Cloud.

### 4. La CSP rompió la app: ¿por qué? ¿Qué opciones evaluaste y qué costo de seguridad tiene cada una?
Al aplicar la CSP inicial se rompieron dos cosas:
1. **El filtro de `/cursos`:** Next.js inserta pequeños `<script>` inline en el HTML estático para hidratar la página, y `script-src 'self'` los bloquea.
   - *Opción 1 (`'unsafe-inline'`):* hace que funcione rápido, pero debilita la protección contra ataques XSS porque permite cualquier script inline.
   - *Opción 2 (Hashes `'sha256-...'` - elegida):* calculamos en el build los hashes SHA-256 de los scripts de Next.js con `scripts/csp-hashes.mjs`. Así la app funciona sin abrir `'unsafe-inline'` y sin perder seguridad.
2. **La imagen de portada:** `https://picsum.photos` redirige (`302`) a `https://fastly.picsum.photos`. Se solucionó permitiendo ambos dominios exactos en `img-src` en vez de abrir cualquier origen (`*`).

### 5. Para cada header de B2, ¿qué ataque mitiga?
- **`Strict-Transport-Security` (HSTS):** evita ataques *Man-in-the-Middle (MitM)* y *SSL Stripping*, obligando al navegador a conectarse siempre por HTTPS.
- **`X-Content-Type-Options: nosniff`:** evita ataques de *MIME Sniffing*, impidiendo que el navegador ejecute como código un archivo subido con otro formato.
- **`X-Frame-Options: DENY`:** evita ataques de *Clickjacking*, impidiendo que otra web meta nuestro sitio dentro de un `<iframe>` engañoso.
- **`Referrer-Policy: strict-origin-when-cross-origin`:** evita la *fuga de información en URLs*, enviando solo el dominio base (sin rutas ni parámetros privados) al navegar hacia otros sitios.
- **`Permissions-Policy`:** bloquea el acceso no autorizado a APIs sensibles del navegador (cámara, micrófono, ubicación, USB) si algún script externo intentara usarlas.

### 6. ¿Por qué los assets de `/_next/static/` pueden cachearse un año y el HTML no?
- Los archivos de `/_next/static/` tienen un **hash único en su nombre** (ej. `27gjg8e11zukd.js`). Si el código cambia, el nombre del archivo también cambia, por lo que es seguro guardarlos en caché por 1 año (`immutable`).
- El **HTML** siempre tiene la misma ruta (`/`, `/cursos`) y es el que indica qué archivos `.js` y `.css` cargar. Si el HTML se guardara en caché sin revalidar, cuando hagamos un nuevo deploy o un rollback los usuarios seguirían viendo la versión vieja guardada en su navegador.

### 7. Si la app necesitara SSR, ¿qué cambiaría en la arquitectura, en la CSP y en el costo?
- **Arquitectura:** ya no sería solo export estático (`out/`); necesitaría un servidor Node.js ejecutándose en cada petición (por ejemplo, pasando a *Firebase App Hosting* sobre *Cloud Run*).
- **CSP:** al haber un servidor en cada petición, se podría generar un `nonce` aleatorio por cada request en lugar de usar hashes fijos calculados en el build.
- **Costo:** dejaría de ser gratuito en el plan *Spark* y requeriría el plan *Blaze* (pago por uso con tarjeta de crédito) para pagar el tiempo de ejecución del servidor.

### Pregunta adicional (A6): Después del rollback, `main` sigue teniendo el código nuevo. ¿Qué pasa con el próximo merge? ¿Cómo se resuelve en un equipo real?
- **Qué pasa:** como el rollback en la consola de Firebase solo cambia la versión publicada en el hosting pero no modifica Git, en el próximo merge a `main` el pipeline volverá a compilar `main` y publicará otra vez el cambio que habíamos revertido.
- **Cómo se resuelve:** luego de hacer el rollback rápido en Firebase para apagar el incendio en segundos, se hace un `git revert` del commit problemático mediante un PR a `main` para que el código del repositorio vuelva a coincidir con producción.
