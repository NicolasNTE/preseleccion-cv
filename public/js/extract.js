// Proceso A: lee los archivos exportados de Pandapé y extrae el texto de cada CV, todo en el navegador.
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

// El worker de pdf.js vive en otro dominio; se carga a través de un blob del mismo origen.
const WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([`import "${WORKER}";`], { type: "text/javascript" })
);

const EXT_SOPORTADAS = ["pdf", "docx", "txt"];
const MIN_CARACTERES = 200;           // menos que esto suele ser un PDF escaneado (imagen)
const MAX_PDF_IA = 4 * 1024 * 1024;   // límite para enviar el PDF original a la IA

const extension = (nombre) => nombre.split(".").pop().toLowerCase();
const nombreBase = (ruta) => ruta.split("/").pop();

/**
 * Convierte la lista de archivos soltados (zip, pdf, docx, txt) en documentos con texto.
 * @returns {Promise<Array<{archivo, texto, error?, pdf?: ArrayBuffer}>>}
 */
export async function extraerArchivos(archivos, alAvanzar = () => {}) {
  // 1. Expandir los .zip
  const entradas = [];
  for (const f of archivos) {
    if (extension(f.name) === "zip") {
      const zip = await window.JSZip.loadAsync(f);
      for (const entrada of Object.values(zip.files)) {
        if (entrada.dir || entrada.name.startsWith("__MACOSX") || nombreBase(entrada.name).startsWith(".")) continue;
        entradas.push({ archivo: nombreBase(entrada.name), leer: () => entrada.async("arraybuffer") });
      }
    } else {
      entradas.push({ archivo: f.name, leer: () => f.arrayBuffer() });
    }
  }

  // 2. Extraer el texto de cada documento
  const docs = [];
  for (let i = 0; i < entradas.length; i++) {
    const { archivo, leer } = entradas[i];
    alAvanzar(i, entradas.length, archivo);
    const ext = extension(archivo);
    if (!EXT_SOPORTADAS.includes(ext)) {
      docs.push({ archivo, texto: "", error: ext === "doc" ? "Formato .doc antiguo: guárdalo como PDF o .docx" : `Formato .${ext} no soportado` });
      continue;
    }
    try {
      const datos = await leer();
      let texto = "";
      if (ext === "pdf") texto = await textoDePdf(datos.slice(0));
      else if (ext === "docx") texto = (await window.mammoth.extractRawText({ arrayBuffer: datos })).value;
      else texto = new TextDecoder().decode(datos);
      texto = limpiar(texto);

      const doc = { archivo, texto };
      if (texto.length < MIN_CARACTERES) {
        if (ext === "pdf" && datos.byteLength <= MAX_PDF_IA) {
          doc.pdf = datos; // la IA puede leer el PDF escaneado directamente
          doc.aviso = "PDF sin texto (posible escaneo): la IA leerá el documento original";
        } else {
          doc.error = "No se pudo leer texto del archivo";
        }
      }
      docs.push(doc);
    } catch (e) {
      docs.push({ archivo, texto: "", error: `No se pudo abrir: ${e.message}` });
    }
  }
  alAvanzar(entradas.length, entradas.length, "");
  return docs;
}

async function textoDePdf(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const contenido = await (await pdf.getPage(p)).getTextContent();
    paginas.push(contenido.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  await pdf.destroy();
  return paginas.join("\n\n");
}

function limpiar(texto) {
  return texto
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Id estable a partir del contenido: el mismo CV siempre produce el mismo id. */
export async function idDeContenido(texto, archivo) {
  const base = texto ? texto.toLowerCase().replace(/\s+/g, " ") : `archivo:${archivo}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return [...new Uint8Array(hash)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Nombre probable del candidato a partir del nombre del archivo (antes de que lo lea la IA). */
export function nombreDesdeArchivo(archivo) {
  return archivo
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|curriculum|curr[ií]culum vitae|hoja de vida)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || archivo;
}
