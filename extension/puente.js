// Content script que corre en la web de Innovandum. Hace de puente entre la página
// (window.postMessage) y el service worker de la extensión (chrome.runtime).
const WEB = "innovandum-web";
const CONECTOR = "innovandum-conector";

const responder = (id, m) => window.postMessage({ fuente: CONECTOR, id, ...m }, location.origin);

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.fuente !== WEB) return;
  const { id, accion, datos } = e.data;
  let port;
  try {
    port = chrome.runtime.connect({ name: "innovandum" });
  } catch {
    responder(id, { tipo: "error", mensaje: "El conector se actualizó. Recarga esta página (F5) y vuelve a intentar." });
    return;
  }
  let terminado = false;
  port.onMessage.addListener((m) => {
    responder(id, m);
    if (m.tipo === "fin" || m.tipo === "error") { terminado = true; port.disconnect(); }
  });
  port.onDisconnect.addListener(() => {
    if (!terminado) responder(id, { tipo: "error", mensaje: "Se perdió la conexión con el conector. Recarga la página y vuelve a intentar." });
  });
  port.postMessage({ accion, datos });
});

// Avisa a la página que el conector está instalado.
document.documentElement.dataset.conectorInnovandum = chrome.runtime.getManifest().version;
