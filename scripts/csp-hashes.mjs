#!/usr/bin/env node
/**
 * Calcula los hashes SHA-256 de todos los <script> inline generados por
 * `next build` en la carpeta `out/` y actualiza la directiva `script-src`
 * de la Content-Security-Policy en `firebase.json`, eliminando la necesidad
 * de usar `'unsafe-inline'`.
 *
 * Se ejecuta automáticamente después de `npm run build` (postbuild) y en el
 * pipeline de CI/CD antes del despliegue a Firebase Hosting.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "out";
const FIREBASE_JSON_PATH = "firebase.json";

function obtenerArchivosHtml(dir) {
  const resultados = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      resultados.push(...obtenerArchivosHtml(ruta));
    } else if (ruta.endsWith(".html")) {
      resultados.push(ruta);
    }
  }
  return resultados;
}

const hashes = new Set();
const regexScriptInline = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

for (const archivo of obtenerArchivosHtml(OUT_DIR)) {
  const html = readFileSync(archivo, "utf8");
  for (const match of html.matchAll(regexScriptInline)) {
    const contenido = match[1];
    if (contenido) {
      const sha256 = createHash("sha256").update(contenido, "utf8").digest("base64");
      hashes.add(`'sha256-${sha256}'`);
    }
  }
}

const listaHashes = Array.from(hashes);
if (listaHashes.length === 0) {
  console.error("No se encontraron scripts inline en out/. ¿Ejecutaste `npm run build` primero?");
  process.exit(1);
}

const firebaseConfig = JSON.parse(readFileSync(FIREBASE_JSON_PATH, "utf8"));
const reglasHeaders = firebaseConfig?.hosting?.headers ?? [];

let actualizado = false;
for (const regla of reglasHeaders) {
  for (const header of regla.headers ?? []) {
    if (header.key.toLowerCase() === "content-security-policy") {
      header.value = header.value.replace(
        /script-src\s+[^;]+/,
        `script-src 'self' ${listaHashes.join(" ")}`,
      );
      actualizado = true;
    }
  }
}

if (!actualizado) {
  console.error("No se encontró el header Content-Security-Policy en firebase.json.");
  process.exit(1);
}

writeFileSync(FIREBASE_JSON_PATH, JSON.stringify(firebaseConfig, null, 2) + "\n", "utf8");
console.log(`✔ CSP actualizada en firebase.json con ${listaHashes.length} hashes SHA-256 (sin 'unsafe-inline').`);
