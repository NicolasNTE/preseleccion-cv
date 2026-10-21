// Proceso B: envía cada CV a la función de Netlify, que consulta a la IA.
import { ENDPOINT_IA } from "./config.js";
import { tokenSesion } from "./firebase.js";

export class IANoDisponible extends Error {}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamar(cuerpo, intentos = 3) {
  for (let intento = 1; ; intento++) {
    let resp;
    try {
      resp = await fetch(ENDPOINT_IA, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenSesion()}` },
        body: JSON.stringify(cuerpo)
      });
    } catch {
      throw new IANoDisponible("No se pudo conectar con el servicio de IA.");
    }
    if (resp.status === 404 || resp.status === 405) {
      throw new IANoDisponible("El servicio de IA no está publicado (¿estás fuera de Netlify?).");
    }
    const datos = await resp.json().catch(() => ({}));
    if (resp.ok) return datos;
    const reintentable = resp.status === 429 || resp.status >= 500;
    if (reintentable && intento < intentos) { await esperar(2000 * intento); continue; }
    if (resp.status === 401 || resp.status === 403) throw new IANoDisponible(datos.error ?? "Sesión no autorizada para usar la IA.");
    throw new Error(datos.error ?? `Error ${resp.status}`);
  }
}

/** Evalúa un CV contra los criterios de la convocatoria. */
export function evaluarCV(conv, { archivo, texto, pdfBase64 }) {
  return llamar({
    accion: "evaluar",
    convocatoria: {
      titulo: conv.titulo,
      area: conv.area,
      descripcion: conv.descripcion,
      criterios: conv.criterios.map(({ id, descripcion, tipo }) => ({ id, descripcion, tipo }))
    },
    cv: { archivo, texto, pdfBase64 }
  });
}

/** Propone criterios a partir de la descripción del puesto. */
export function sugerirCriterios(conv) {
  return llamar({ accion: "sugerir", convocatoria: { titulo: conv.titulo, area: conv.area, descripcion: conv.descripcion } });
}

/** Ejecuta tareas con un máximo de N en paralelo. */
export async function enParalelo(items, n, tarea, debeParar = () => false) {
  let i = 0;
  const trabajador = async () => {
    while (i < items.length && !debeParar()) {
      const actual = i++;
      await tarea(items[actual], actual);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
}
