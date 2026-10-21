// Service worker del conector. Recibe órdenes de la web de Innovandum (a través de puente.js),
// trabaja en la pestaña de la plataforma de empleo con la sesión del usuario y devuelve los CV.
import { PLATAFORMAS } from "./plataformas.js";
import { listarOfertas, listarCandidatos, buscarCV, descargarCV } from "./extractor.js";

const MAX_PAGINAS = 100;
const PAUSA_ENTRE_DESCARGAS_MS = 400; // no saturar la plataforma

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME_POR_EXTENSION = { pdf: "application/pdf", doc: "application/msword", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

/**
 * Descarga un CV desde el service worker. Sirve cuando la plataforma redirige a otro dominio
 * (p. ej. almacenamiento en la nube) y la página no puede leerlo por CORS: la extensión sí,
 * porque tiene permiso de host sobre ese dominio (ver host_permissions en manifest.json).
 */
async function descargarEnWorker(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`Descarga fallida (${r.status})`);
  let mime = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (mime === "text/html") throw new Error("La plataforma devolvió una página en lugar del CV (¿sesión expirada?)");
  const nombreArchivo = decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "");
  const bytes = new Uint8Array(await r.arrayBuffer());
  const ext = nombreArchivo.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if ((!mime || mime === "binary/octet-stream" || mime === "application/octet-stream") && MIME_POR_EXTENSION[ext]) mime = MIME_POR_EXTENSION[ext];
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binario), mime, nombreArchivo, bytes: bytes.length };
}

async function ejecutarEnPestana(tabId, func, args) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!result) throw new Error("No se pudo ejecutar el conector en la pestaña de la plataforma. Recárgala y vuelve a intentar.");
  if (result.error) throw new Error(result.error);
  return result;
}

function esperarCarga(tabId) {
  return new Promise((ok) => {
    const alActualizar = (id, info) => {
      if (id === tabId && info.status === "complete") { chrome.tabs.onUpdated.removeListener(alActualizar); ok(); }
    };
    chrome.tabs.onUpdated.addListener(alActualizar);
  });
}

/** Busca una pestaña abierta de alguna plataforma configurada; si no hay, abre la primera. */
async function pestanaDePlataforma(plataformaId) {
  const candidatas = plataformaId ? PLATAFORMAS.filter((p) => p.id === plataformaId) : PLATAFORMAS;
  for (const p of candidatas) {
    const [tab] = await chrome.tabs.query({ url: p.urls });
    if (tab) return { plataforma: p, tabId: tab.id };
  }
  const p = candidatas[0];
  if (!p?.abrir) throw new Error("Abre la plataforma de empleo en otra pestaña, inicia sesión y vuelve a intentar.");
  const tab = await chrome.tabs.create({ url: p.abrir, active: false });
  await esperarCarga(tab.id);
  return { plataforma: p, tabId: tab.id };
}

const ACCIONES = {
  async ping() {
    return { version: chrome.runtime.getManifest().version, plataformas: PLATAFORMAS.map((p) => p.nombre) };
  },

  async listarOfertas() {
    const { plataforma, tabId } = await pestanaDePlataforma();
    const { ofertas } = await ejecutarEnPestana(tabId, listarOfertas, [plataforma]);
    return { plataforma: { id: plataforma.id, nombre: plataforma.nombre }, ofertas };
  },

  async importar({ plataformaId, oferta }, enviar) {
    const { plataforma, tabId } = await pestanaDePlataforma(plataformaId);
    enviar({ tipo: "progreso", texto: `Leyendo candidatos de "${oferta.nombre}"…` });
    const { candidatos } = await ejecutarEnPestana(tabId, listarCandidatos, [plataforma, oferta.url, MAX_PAGINAS]);

    let descargados = 0;
    const fallidos = [];
    for (let i = 0; i < candidatos.length; i++) {
      const c = candidatos[i];
      enviar({ tipo: "progreso", texto: `Descargando CV de ${c.nombre || "candidato"}`, actual: i, total: candidatos.length });
      try {
        // En algunas plataformas el CV no está en la lista: hay que abrir la ficha del candidato para encontrarlo.
        if (!c.cvUrl && c.fichaUrl) c.cvUrl = (await ejecutarEnPestana(tabId, buscarCV, [plataforma, c.fichaUrl])).cvUrl;
        if (!c.cvUrl) { fallidos.push({ nombre: c.nombre, error: "Sin CV adjunto" }); continue; }
        let cv;
        try {
          cv = await ejecutarEnPestana(tabId, descargarCV, [c.cvUrl]);
        } catch (e) {
          if (!/failed to fetch/i.test(e.message)) throw e;
          cv = await descargarEnWorker(c.cvUrl); // la página no pudo (CORS): lo descarga la extensión
        }
        enviar({ tipo: "archivo", candidato: c.nombre, ...cv });
        descargados++;
      } catch (e) {
        fallidos.push({ nombre: c.nombre, error: e.message });
      }
      await esperar(PAUSA_ENTRE_DESCARGAS_MS);
    }
    enviar({ tipo: "progreso", texto: "Descarga terminada", actual: candidatos.length, total: candidatos.length });
    return { total: candidatos.length, descargados, fallidos };
  }
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "innovandum") return;
  let abierto = true;
  port.onDisconnect.addListener(() => (abierto = false));
  const enviar = (m) => { if (abierto) port.postMessage(m); };

  port.onMessage.addListener(async ({ accion, datos }) => {
    const fn = ACCIONES[accion];
    try {
      if (!fn) throw new Error(`Acción desconocida: ${accion}`);
      enviar({ tipo: "fin", resultado: await fn(datos ?? {}, enviar) });
    } catch (e) {
      enviar({ tipo: "error", mensaje: e.message });
    }
  });
});
