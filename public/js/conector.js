// Cliente del conector (extensión de Chrome "Innovandum RRHH · Conector").
// La extensión descarga los CV desde la plataforma de empleo con la sesión del usuario
// y los entrega aquí; el análisis sigue siendo el mismo que con la carga manual.
const WEB = "innovandum-web";
const CONECTOR = "innovandum-conector";

let secuencia = 0;
const pendientes = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.fuente !== CONECTOR) return;
  const p = pendientes.get(e.data.id);
  if (!p) return;
  if (e.data.tipo === "fin") { pendientes.delete(e.data.id); p.ok(e.data.resultado); }
  else if (e.data.tipo === "error") { pendientes.delete(e.data.id); p.mal(new Error(e.data.mensaje)); }
  else p.alEvento(e.data);
});

function llamar(accion, datos = {}, alEvento = () => {}) {
  const id = `${Date.now()}-${++secuencia}`;
  return new Promise((ok, mal) => {
    pendientes.set(id, { ok, mal, alEvento });
    window.postMessage({ fuente: WEB, id, accion, datos }, location.origin);
  });
}

/** El puente de la extensión marca el documento al cargar la página. */
export const conectorInstalado = () => Boolean(document.documentElement.dataset.conectorInnovandum);

/** Devuelve { plataforma: {id, nombre}, ofertas: [{nombre, url, inscritos}] }. */
export const listarOfertas = () => llamar("listarOfertas");

/**
 * Descarga todos los CV de una oferta. Llama a alProgreso(texto, actual, total) mientras avanza.
 * @returns {Promise<{archivos: File[], total: number, fallidos: Array<{nombre, error}>}>}
 */
export async function importarOferta(plataformaId, oferta, alProgreso = () => {}) {
  const archivos = [];
  const resumen = await llamar("importar", { plataformaId, oferta }, (m) => {
    if (m.tipo === "progreso") alProgreso(m.texto, m.actual, m.total);
    if (m.tipo === "archivo") archivos.push(aArchivo(m));
  });
  return { archivos, total: resumen.total, fallidos: resumen.fallidos };
}

const EXT_POR_MIME = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt"
};

// El nombre del archivo lleva el nombre del candidato, así la tabla lo muestra antes de que lo lea la IA.
function aArchivo({ base64, mime, nombreArchivo, candidato }) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (nombreArchivo?.match(/\.([a-z0-9]+)$/i)?.[1] ?? EXT_POR_MIME[mime] ?? "pdf").toLowerCase();
  const base = (candidato || nombreArchivo?.replace(/\.[^.]+$/, "") || "candidato").replace(/[\\/:*?"<>|]+/g, " ").trim();
  return new File([bytes], `${base}.${ext}`, { type: mime || "application/octet-stream" });
}
