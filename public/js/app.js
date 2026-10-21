import { modoLocal, alCambiarSesion, ingresar, salir, restablecerClave, estaAutorizado } from "./firebase.js";
import * as datos from "./db.js";
import { extraerArchivos, idDeContenido, nombreDesdeArchivo, aBase64 } from "./extract.js";
import { preScore, rankear, versionDeCriterios } from "./scoring.js";
import { evaluarCV, sugerirCriterios, enParalelo, IANoDisponible } from "./ai.js";
import { CONCURRENCIA_IA } from "./config.js";
import { conectorInstalado, listarOfertas, importarOferta } from "./conector.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nuevoIdCriterio = () => "c" + crypto.randomUUID().slice(0, 6);
const MAX_TEXTO = 100_000;

const estado = {
  usuario: null,
  convocatorias: [],
  conv: null,
  candidatos: [],
  archivos: [],
  pdfs: new Map(),     // PDFs escaneados en memoria (solo durante la sesión)
  procesando: false,
  detener: false,
  avisoIA: ""
};

// =============================== Utilidades UI ===============================
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3800);
}

function fecha(iso) {
  return iso ? new Date(iso).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function mostrarVista(nombre) {
  $("#view-login").hidden = nombre !== "login";
  $("#view-app").hidden = nombre !== "app";
}

// =============================== Sesión ===============================
$("#banner-local").hidden = !modoLocal;
$("#btn-logout").hidden = modoLocal;

alCambiarSesion(async (usuario) => {
  if (!usuario) { estado.usuario = null; mostrarVista("login"); return; }
  if (!(await estaAutorizado(usuario))) {
    await salir();
    mostrarError(`La cuenta ${usuario.email} no está autorizada. Pide al administrador que la agregue.`);
    return;
  }
  estado.usuario = usuario;
  $("#user-email").textContent = usuario.email;
  mostrarVista("app");
  await cargarConvocatorias();
});

function mostrarError(msg) {
  const el = $("#login-error");
  el.textContent = msg;
  el.hidden = !msg;
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  mostrarError("");
  try {
    await ingresar($("#login-email").value, $("#login-password").value);
  } catch {
    mostrarError("Correo o contraseña incorrectos.");
  }
});

$("#btn-reset").addEventListener("click", async () => {
  const email = $("#login-email").value;
  if (!email) { mostrarError("Escribe tu correo para enviarte el enlace."); return; }
  try { await restablecerClave(email); toast("Te enviamos un correo para restablecer la contraseña."); }
  catch { mostrarError("No se pudo enviar el correo."); }
});

$("#btn-logout").addEventListener("click", () => salir());
$("#btn-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

// =============================== Convocatorias ===============================
async function cargarConvocatorias(seleccionar) {
  try {
    estado.convocatorias = await datos.listarConvocatorias();
  } catch (e) {
    toast("No se pudieron cargar las convocatorias: " + e.message);
    estado.convocatorias = [];
  }
  renderLista();
  const id = seleccionar ?? estado.conv?.id;
  if (id && estado.convocatorias.some((c) => c.id === id)) await abrirConvocatoria(id);
  else if (!estado.conv) { $("#empty-state").hidden = false; $("#convocatoria").hidden = true; }
}

function renderLista() {
  $("#lista-convocatorias").innerHTML = estado.convocatorias.map((c) => `
    <li><button data-id="${esc(c.id)}" class="${c.id === estado.conv?.id ? "active" : ""}">
      <span>${esc(c.titulo)}</span>
      <span class="sub">${esc(c.area || "Sin área")} · ${c.totalCVs ?? 0} CV</span>
    </button></li>`).join("") || `<li class="muted small" style="padding:.5rem">Aún no hay convocatorias.</li>`;
}

$("#lista-convocatorias").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) { abrirConvocatoria(b.dataset.id); $("#sidebar").classList.remove("open"); }
});

async function abrirConvocatoria(id) {
  if (estado.procesando) { toast("Espera a que termine el análisis en curso."); return; }
  estado.conv = structuredClone(estado.convocatorias.find((c) => c.id === id));
  estado.archivos = [];
  estado.pdfs.clear();
  estado.avisoIA = "";
  estado.candidatos = await datos.listarCandidatos(id).catch(() => []);
  renderLista();
  renderConvocatoria();
  cambiarTab(estado.candidatos.some((c) => c.ia) ? "resultados" : estado.candidatos.length ? "cargar" : "requisitos");
}

function nuevaConvocatoria() {
  if (estado.procesando) return;
  estado.conv = {
    titulo: "", area: "", descripcion: "",
    criterios: [
      { id: nuevoIdCriterio(), descripcion: "", tipo: "obligatorio", peso: 3, claves: "" }
    ]
  };
  estado.candidatos = [];
  estado.archivos = [];
  renderLista();
  renderConvocatoria();
  cambiarTab("requisitos");
  $("#req-titulo").focus();
  $("#sidebar").classList.remove("open");
}
$("#btn-nueva").addEventListener("click", nuevaConvocatoria);
$("[data-action=nueva]").addEventListener("click", nuevaConvocatoria);

function renderConvocatoria() {
  const c = estado.conv;
  $("#empty-state").hidden = true;
  $("#convocatoria").hidden = false;
  $("#conv-titulo").textContent = c.titulo || "Nueva convocatoria";
  $("#conv-meta").textContent = c.id
    ? [c.area, `${estado.candidatos.length} CV cargados`, c.ultimoAnalisis && `último análisis ${fecha(c.ultimoAnalisis)}`, c.creadoPor && `creada por ${c.creadoPor}`].filter(Boolean).join(" · ")
    : "Completa los requisitos y guárdalos para empezar.";
  $("#btn-eliminar-conv").hidden = !c.id;
  renderRequisitos();
  renderArchivos();
  renderResultados();
}

$("#btn-eliminar-conv").addEventListener("click", async () => {
  const c = estado.conv;
  if (!confirm(`¿Eliminar la convocatoria "${c.titulo}" y los ${estado.candidatos.length} CV analizados? No se puede deshacer.`)) return;
  await datos.eliminarConvocatoria(c.id);
  estado.conv = null;
  toast("Convocatoria eliminada.");
  await cargarConvocatorias();
});

// =============================== Analizar convocatoria (conector) ===============================
// El conector (extensión de Chrome) descarga los CV desde la plataforma de empleo con la sesión
// del usuario. Aquí se reciben como archivos y siguen el mismo camino que la carga manual.
const dlgCon = $("#dlg-conector");
const cuerpoCon = (html) => ($("#con-cuerpo").innerHTML = html);
let ofertasCon = null;
let importando = false;

dlgCon.addEventListener("click", (e) => {
  if ((e.target.closest("[data-close]") || e.target === e.currentTarget) && !importando) dlgCon.close();
});
dlgCon.addEventListener("cancel", (e) => { if (importando) e.preventDefault(); });

async function analizarConvocatoria() {
  if (estado.procesando) { toast("Espera a que termine el análisis en curso."); return; }
  $("#sidebar").classList.remove("open");
  if (!dlgCon.open) dlgCon.showModal();

  if (!conectorInstalado()) {
    cuerpoCon(`
      <p>Para traer los CV automáticamente necesitas el <strong>conector de Innovandum</strong> en Chrome (gratis, se instala una sola vez):</p>
      <ol class="steps">
        <li>Abre <code>chrome://extensions</code> y activa <strong>Modo de desarrollador</strong> (arriba a la derecha).</li>
        <li>Pulsa <strong>Cargar descomprimida</strong> y elige la carpeta <code>extension</code> del proyecto.</li>
        <li>Recarga esta página (F5).</li>
      </ol>
      <p class="muted small">Mientras tanto, puedes usar la carga manual con los CV exportados.</p>
      <div class="cand-actions"><button class="btn btn-ghost btn-sm" data-con="manual">Usar carga manual</button></div>`);
    return;
  }

  cuerpoCon(`<p class="muted">Buscando convocatorias en la plataforma de empleo…</p>`);
  try {
    ofertasCon = await listarOfertas();
  } catch (e) {
    cuerpoCon(`<p class="error">${esc(e.message)}</p>
      <div class="cand-actions"><button class="btn btn-primary btn-sm" data-con="reintentar">Reintentar</button></div>`);
    return;
  }
  const { plataforma, ofertas } = ofertasCon;
  cuerpoCon(ofertas.length ? `
    <p class="muted small">Plataforma: <strong>${esc(plataforma.nombre)}</strong>. Elige la convocatoria a analizar:</p>
    <ul class="conv-list">${ofertas.map((o, i) => `
      <li><button data-oferta="${i}">
        <span>${esc(o.nombre)}</span>
        <span class="sub">${o.inscritos != null ? `${o.inscritos} postulantes` : "Postulantes sin contar"}${estado.convocatorias.some((c) => c.origen?.url === o.url) ? " · ya importada antes" : ""}</span>
      </button></li>`).join("")}</ul>` :
    `<p>No se encontraron convocatorias en ${esc(plataforma.nombre)}.</p>`);
}

$("#con-cuerpo").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.con === "manual") { dlgCon.close(); nuevaConvocatoria(); }
  if (b.dataset.con === "reintentar") analizarConvocatoria();
  if (b.dataset.oferta) importarDesdePlataforma(ofertasCon.ofertas[Number(b.dataset.oferta)]);
});

async function importarDesdePlataforma(oferta) {
  importando = true;
  cuerpoCon(`
    <h3 style="margin:0">${esc(oferta.nombre)}</h3>
    <div class="progress-box">
      <div class="progress-label"><span id="con-texto">Conectando…</span><span id="con-num"></span></div>
      <div class="progress"><div id="con-barra" class="progress-bar"></div></div>
    </div>`);
  try {
    const { archivos, total, fallidos } = await importarOferta(ofertasCon.plataforma.id, oferta, (texto, actual, tot) => {
      $("#con-texto").textContent = texto;
      $("#con-num").textContent = tot ? `${actual} / ${tot}` : "";
      $("#con-barra").style.width = tot ? `${Math.round((actual / tot) * 100)}%` : "0%";
    });
    importando = false;
    dlgCon.close();
    if (!archivos.length) { toast(`No se pudo descargar ningún CV de "${oferta.nombre}".`); return; }

    // Reutiliza la convocatoria si ya se importó antes; si no, crea una con el nombre de la plataforma.
    const origen = { plataforma: ofertasCon.plataforma.id, url: oferta.url, importadoEn: new Date().toISOString() };
    const existente = estado.convocatorias.find((c) => c.origen?.url === oferta.url);
    if (existente) {
      await abrirConvocatoria(existente.id);
      estado.conv.origen = origen;
    } else {
      nuevaConvocatoria();
      Object.assign(estado.conv, { titulo: oferta.nombre, origen });
      renderConvocatoria();
    }
    estado.archivos = archivos;
    renderArchivos();

    const resumen = `${archivos.length} de ${total} CV descargados${fallidos.length ? ` (${fallidos.length} sin CV o con error)` : ""}.`;
    const listos = estado.conv.id && estado.conv.criterios.some((c) => c.descripcion);
    if (listos) {
      toast(`${resumen} Analizando con los criterios guardados…`);
      cambiarTab("cargar");
      await buscarCandidatos(false);
    } else {
      cambiarTab("requisitos");
      toast(`${resumen} Define los criterios y presiona Guardar; luego Buscar candidato.`);
    }
  } catch (e) {
    importando = false;
    cuerpoCon(`<p class="error">${esc(e.message)}</p>
      <div class="cand-actions"><button class="btn btn-primary btn-sm" data-con="reintentar">Volver a la lista</button></div>`);
  }
}

$("#btn-analizar").addEventListener("click", analizarConvocatoria);
$("[data-action=analizar]").addEventListener("click", analizarConvocatoria);

// =============================== Pestañas ===============================
function cambiarTab(tab) {
  if (tab !== "requisitos" && !estado.conv?.id) { toast("Primero guarda los requisitos."); tab = "requisitos"; }
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
}
$$(".tab").forEach((b) => b.addEventListener("click", () => cambiarTab(b.dataset.tab)));

// =============================== Requisitos ===============================
function renderRequisitos() {
  const c = estado.conv;
  $("#req-titulo").value = c.titulo ?? "";
  $("#req-area").value = c.area ?? "";
  $("#req-descripcion").value = c.descripcion ?? "";
  $("#tbody-criterios").innerHTML = "";
  c.criterios.forEach(agregarFilaCriterio);
  $("#req-estado").textContent = c.actualizadoEn ? `Guardado ${fecha(c.actualizadoEn)}` : "";
}

function agregarFilaCriterio(cr = {}) {
  const fila = $("#tpl-criterio").content.firstElementChild.cloneNode(true);
  fila.dataset.id = cr.id ?? nuevoIdCriterio();
  $(".c-desc", fila).value = cr.descripcion ?? "";
  $(".c-tipo", fila).value = cr.tipo ?? "obligatorio";
  $(".c-peso", fila).value = String(cr.peso ?? 3);
  $(".c-claves", fila).value = cr.claves ?? "";
  $("#tbody-criterios").append(fila);
  return fila;
}

$("#btn-add-criterio").addEventListener("click", () => {
  $(".c-desc", agregarFilaCriterio({ tipo: "deseable", peso: 1 })).focus();
});
$("#tbody-criterios").addEventListener("click", (e) => {
  if (e.target.closest(".c-quitar")) e.target.closest("tr").remove();
});
// Al cambiar el tipo, propone un peso por defecto.
$("#tbody-criterios").addEventListener("change", (e) => {
  if (e.target.classList.contains("c-tipo")) {
    $(".c-peso", e.target.closest("tr")).value = e.target.value === "obligatorio" ? "3" : "1";
  }
});

function leerRequisitos() {
  return {
    ...estado.conv,
    titulo: $("#req-titulo").value.trim(),
    area: $("#req-area").value.trim(),
    descripcion: $("#req-descripcion").value.trim(),
    criterios: $$("#tbody-criterios tr")
      .map((tr) => ({
        id: tr.dataset.id,
        descripcion: $(".c-desc", tr).value.trim(),
        tipo: $(".c-tipo", tr).value,
        peso: Number($(".c-peso", tr).value),
        claves: $(".c-claves", tr).value.trim()
      }))
      .filter((c) => c.descripcion)
  };
}

async function guardarRequisitos() {
  const conv = leerRequisitos();
  if (!conv.titulo) throw new Error("Escribe el nombre del puesto.");
  if (!conv.criterios.length) throw new Error("Agrega al menos un criterio de evaluación.");
  conv.versionCriterios = await versionDeCriterios(conv);
  const guardada = await datos.guardarConvocatoria(conv, estado.usuario);
  estado.conv = guardada;
  const i = estado.convocatorias.findIndex((c) => c.id === guardada.id);
  if (i >= 0) estado.convocatorias[i] = guardada; else estado.convocatorias.unshift(guardada);
  renderLista();
  $("#conv-titulo").textContent = guardada.titulo;
  $("#btn-eliminar-conv").hidden = false;
  $("#req-estado").textContent = `Guardado ${fecha(guardada.actualizadoEn)}`;
  return guardada;
}

$("#form-requisitos").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const antes = estado.conv.versionCriterios;
    await guardarRequisitos();
    renderConvocatoria();
    const cambiaron = antes && antes !== estado.conv.versionCriterios && estado.candidatos.some((c) => c.ia);
    toast(cambiaron ? "Requisitos guardados. Los criterios cambiaron: presiona Buscar candidato para reevaluar." : "Requisitos guardados.");
    cambiarTab(cambiaron ? "cargar" : estado.candidatos.length ? "resultados" : "cargar");
  } catch (err) {
    toast(err.message);
  }
});

$("#btn-sugerir").addEventListener("click", async (e) => {
  const conv = leerRequisitos();
  if (conv.descripcion.length < 40) { toast("Pega primero la descripción del puesto."); return; }
  if (conv.criterios.length && !confirm("Se reemplazarán los criterios actuales por los sugeridos. ¿Continuar?")) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Generando…";
  try {
    const { criterios } = await sugerirCriterios(conv);
    estado.conv = { ...conv, criterios: criterios.map((c) => ({ ...c, id: nuevoIdCriterio() })) };
    renderRequisitos();
    toast("Revisa y ajusta los criterios sugeridos antes de guardar.");
  } catch (err) {
    toast(err instanceof IANoDisponible ? err.message : "No se pudieron sugerir criterios: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Sugerir criterios desde la descripción";
  }
});

// =============================== Carga de archivos ===============================
const dz = $("#dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("over")));
dz.addEventListener("drop", (e) => { e.preventDefault(); agregarArchivos(e.dataTransfer.files); });
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#input-archivos").click(); } });
$("#input-archivos").addEventListener("change", (e) => { agregarArchivos(e.target.files); e.target.value = ""; });

function agregarArchivos(lista) {
  for (const f of lista) {
    if (!estado.archivos.some((a) => a.name === f.name && a.size === f.size)) estado.archivos.push(f);
  }
  renderArchivos();
}

function renderArchivos() {
  const ul = $("#lista-archivos");
  ul.innerHTML = estado.archivos.map((f, i) => `
    <li><span>📄 ${esc(f.name)}</span>
      <span class="row-gap"><span class="muted">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="icon-btn" data-quitar="${i}" aria-label="Quitar">✕</button></span></li>`).join("");
  if (!estado.archivos.length && estado.candidatos.length) {
    ul.innerHTML = `<li><span class="muted">Ya hay ${estado.candidatos.length} CV guardados en esta convocatoria. Puedes agregar más o presionar Buscar candidato para analizarlos.</span></li>`;
  }
}
$("#lista-archivos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar]");
  if (b) { estado.archivos.splice(Number(b.dataset.quitar), 1); renderArchivos(); }
});

// =============================== Buscar candidato ===============================
function progreso(texto, actual, total) {
  $("#progreso").hidden = false;
  $("#progreso-texto").textContent = texto;
  $("#progreso-num").textContent = total ? `${actual} / ${total}` : "";
  $("#progreso-barra").style.width = total ? `${Math.round((actual / total) * 100)}%` : "0%";
}

function bloquear(si) {
  estado.procesando = si;
  $("#btn-buscar").disabled = si;
  $("#btn-reanalizar").disabled = si;
  $("#btn-buscar").textContent = si ? "Analizando…" : "🔎 Buscar candidato";
  if (!si) setTimeout(() => ($("#progreso").hidden = true), 1500);
}

$("#btn-cancelar").addEventListener("click", () => { estado.detener = true; progreso("Deteniendo…", 0, 0); });
$("#btn-buscar").addEventListener("click", () => buscarCandidatos(false));
$("#btn-reanalizar").addEventListener("click", () => {
  if (confirm("Se volverán a enviar a la IA los CV con mejor prefiltro, aunque ya estén analizados. ¿Continuar?")) {
    cambiarTab("cargar");
    buscarCandidatos(true);
  }
});

async function buscarCandidatos(forzar) {
  if (estado.procesando) return;
  estado.detener = false;
  estado.avisoIA = "";
  bloquear(true);
  try {
    // Guarda los requisitos tal como están en pantalla.
    const conv = await guardarRequisitos();

    // ---- Proceso A: extracción ----
    if (estado.archivos.length) {
      progreso("Leyendo archivos…", 0, 0);
      const docs = await extraerArchivos(estado.archivos, (i, total, archivo) =>
        progreso(archivo ? `Leyendo ${archivo}` : "Archivos leídos", i, total));
      const nuevos = [];
      for (const d of docs) {
        const id = await idDeContenido(d.texto, d.archivo);
        if (d.pdf) estado.pdfs.set(id, d.pdf);
        nuevos.push({
          id,
          archivo: d.archivo,
          nombre: nombreDesdeArchivo(d.archivo),
          texto: d.texto.slice(0, MAX_TEXTO),
          error: d.error ?? null,
          aviso: d.aviso ?? null,
          cargadoEn: new Date().toISOString(),
          cargadoPor: estado.usuario.email
        });
      }
      progreso("Guardando en la base de datos…", 0, 0);
      await datos.guardarCandidatos(conv.id, nuevos);
      const conError = nuevos.filter((n) => n.error).length;
      toast(`${nuevos.length} CV leídos${conError ? `, ${conError} con problemas` : ""}.`);
      estado.archivos = [];
      renderArchivos();
    }
    estado.candidatos = await datos.listarCandidatos(conv.id);
    if (!estado.candidatos.length) { toast("Primero trae los CV con Analizar convocatoria o súbelos a mano."); return; }

    // ---- Proceso B: análisis con IA ----
    const limite = Number($("#sel-limite-ia").value) || Infinity;
    const legibles = (c) => !c.error && ((c.texto?.length ?? 0) >= 200 || estado.pdfs.has(c.id));
    const seleccion = estado.candidatos
      .filter(legibles)
      .map((c) => ({ c, pre: preScore(c.texto ?? "", conv.criterios) }))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, limite)
      .map((x) => x.c)
      .filter((c) => forzar || c.ia?.versionCriterios !== conv.versionCriterios);

    let hechos = 0;
    progreso("Analizando CV con IA…", 0, seleccion.length);
    await enParalelo(seleccion, CONCURRENCIA_IA, async (c) => {
      try {
        const pdf = estado.pdfs.get(c.id);
        const r = await evaluarCV(conv, { archivo: c.archivo, texto: pdf ? "" : c.texto, pdfBase64: pdf ? aBase64(pdf) : undefined });
        const ia = { ...r.evaluacion, versionCriterios: conv.versionCriterios, modelo: r.modelo, truncado: r.truncado ?? false, analizadoEn: new Date().toISOString() };
        await datos.actualizarCandidato(conv.id, c.id, { ia, iaError: null });
        Object.assign(c, { ia, iaError: null });
      } catch (e) {
        if (e instanceof IANoDisponible) {
          estado.avisoIA = e.message;
          estado.detener = true;
          return;
        }
        await datos.actualizarCandidato(conv.id, c.id, { iaError: e.message }).catch(() => {});
        c.iaError = e.message;
      }
      progreso("Analizando CV con IA…", ++hechos, seleccion.length);
    }, () => estado.detener);

    estado.conv = await datos.guardarConvocatoria(
      { ...estado.conv, totalCVs: estado.candidatos.length, ultimoAnalisis: new Date().toISOString() }, estado.usuario);
    const i = estado.convocatorias.findIndex((x) => x.id === conv.id);
    if (i >= 0) estado.convocatorias[i] = estado.conv;

    renderLista();
    renderConvocatoria();
    cambiarTab("resultados");
    if (!estado.avisoIA) toast(seleccion.length ? `Listo: ${hechos} CV analizados con IA.` : "Ranking actualizado.");
  } catch (e) {
    console.error(e);
    toast(e.message);
  } finally {
    bloquear(false);
  }
}

// =============================== Resultados ===============================
const NIVEL = {
  cumple: ["ok", "✓", "Cumple"],
  parcial: ["mid", "≈", "Parcial"],
  no_cumple: ["no", "✗", "No cumple"]
};

const anios = (n) => `${n} ${Number(n) === 1 ? "año" : "años"}`;
const nombreDe = (c) => c.ia?.nombre?.trim() || c.nombre || c.archivo;

function etiquetaObligatorios(c) {
  if (c.fuente !== "ia") return `<span class="tag">Sin evaluar</span>`;
  return c.obligatoriosOK ? `<span class="tag ok">Cumple</span>` : `<span class="tag no">Falta ${c.faltantesObligatorios.length}</span>`;
}

function etiquetaDecision(c) {
  if (c.decision === "avanza") return `<span class="tag ok">Avanza</span>`;
  if (c.decision === "descartado") return `<span class="tag no">Descartado</span>`;
  return `<span class="tag">Pendiente</span>`;
}

function renderResultados() {
  const conv = estado.conv;
  if (!conv?.id) return;
  const ranking = rankear(estado.candidatos, conv);
  estado.ranking = ranking;
  const conIA = ranking.filter((c) => c.fuente === "ia");
  const cumplen = conIA.filter((c) => c.obligatoriosOK);
  const errores = estado.candidatos.filter((c) => c.error).length;

  const badge = $("#badge-resultados");
  badge.hidden = !ranking.length;
  badge.textContent = ranking.length;

  $("#resumen").innerHTML = `
    <div class="stat"><b>${estado.candidatos.length}</b><span>CV cargados${errores ? ` · ${errores} ilegibles` : ""}</span></div>
    <div class="stat"><b>${conIA.length}</b><span>analizados con IA</span></div>
    <div class="stat"><b>${cumplen.length}</b><span>cumplen los obligatorios</span></div>
    <div class="stat"><b>${ranking.filter((c) => c.decision === "avanza").length}</b><span>marcados para avanzar</span></div>`;

  const avisos = [];
  if (estado.avisoIA) avisos.push(`${esc(estado.avisoIA)} El ranking se muestra con el prefiltro por palabras clave.`);
  const desactualizados = estado.candidatos.filter((c) => c.ia && c.ia.versionCriterios !== conv.versionCriterios).length;
  if (desactualizados) avisos.push(`${desactualizados} evaluaciones se hicieron con criterios anteriores. Presiona Buscar candidato para actualizarlas.`);
  const fallidos = estado.candidatos.filter((c) => c.iaError && c.ia?.versionCriterios !== conv.versionCriterios).length;
  if (fallidos) avisos.push(`${fallidos} CV no se pudieron analizar con IA; puedes reintentar con Buscar candidato.`);
  $("#aviso-resultados").hidden = !avisos.length;
  $("#aviso-resultados").innerHTML = avisos.join("<br>");

  const top = ranking.filter((c) => c.decision !== "descartado").slice(0, 5);
  $("#top5").innerHTML = top.length ? top.map(tarjetaTop).join("") :
    `<p class="muted">Todavía no hay resultados. Sube los CV en la pestaña <strong>Cargar CV</strong>.</p>`;

  renderTabla();
}

function tarjetaTop(c, i) {
  const ia = c.ia;
  const evaluados = c.fuente === "ia";
  const porId = new Map((ia?.criterios ?? []).map((e) => [e.id, e]));
  const chips = evaluados ? estado.conv.criterios.map((cr) => {
    const [cls, icono] = NIVEL[porId.get(cr.id)?.nivel ?? "no_cumple"];
    return `<span class="chip ${cls}" title="${esc(porId.get(cr.id)?.evidencia)}">${icono} ${esc(cr.descripcion)}</span>`;
  }).join("") : "";
  return `
  <article class="cand">
    <div class="cand-rank">${i + 1}</div>
    <div>
      <div class="cand-head">
        <h3>${esc(nombreDe(c))}</h3>
        ${evaluados ? `<span class="tag ia">Evaluado con IA</span>` : `<span class="tag">Solo prefiltro</span>`}
        ${evaluados ? etiquetaObligatorios(c) : ""}
        ${c.decision ? etiquetaDecision(c) : ""}
      </div>
      <p class="cand-sub">${[
        ia?.puestoActual,
        ia && `${anios(ia.aniosExperiencia)} de experiencia relevante`,
        ia?.formacion
      ].filter(Boolean).map(esc).join(" · ") || esc(c.archivo)}</p>
      ${ia?.resumen ? `<p class="cand-resumen">${esc(ia.resumen)}</p>` : ""}
      <div class="chips">${chips}</div>
      ${ia?.aVerificar?.length ? `<ul class="verificar">${ia.aVerificar.map((v) => `<li>Verificar: ${esc(v)}</li>`).join("")}</ul>` : ""}
      <div class="cand-actions">
        <button class="btn btn-ghost btn-sm" data-ver="${esc(c.id)}">Ver detalle</button>
        <button class="btn btn-ok btn-sm" data-decision="avanza" data-id="${esc(c.id)}">✓ Avanza</button>
        <button class="btn btn-bad btn-sm" data-decision="descartado" data-id="${esc(c.id)}">✗ Descartar</button>
      </div>
    </div>
    <div class="cand-score"><b>${c.puntaje}%</b><span>${evaluados ? "coincidencia" : "estimado"}</span></div>
  </article>`;
}

function renderTabla() {
  const texto = $("#filtro-texto").value.trim().toLowerCase();
  const soloOblig = $("#filtro-obligatorios").checked;
  const filas = (estado.ranking ?? [])
    .map((c, i) => ({ c, pos: i + 1 }))
    .filter(({ c }) => !soloOblig || c.obligatoriosOK)
    .filter(({ c }) => !texto || `${nombreDe(c)} ${c.archivo}`.toLowerCase().includes(texto));
  const ilegibles = estado.candidatos.filter((c) => c.error && !c.ia);

  $("#tbody-candidatos").innerHTML = filas.map(({ c, pos }) => `
    <tr>
      <td>${pos}</td>
      <td><strong>${esc(nombreDe(c))}</strong><br><span class="muted small">${esc(c.archivo)}</span></td>
      <td><span class="score-bar"><i style="--w:${c.puntaje}%"></i>${c.puntaje}%</span></td>
      <td>${etiquetaObligatorios(c)}</td>
      <td>${c.ia ? esc(anios(c.ia.aniosExperiencia)) : "—"}</td>
      <td>${c.fuente === "ia" ? `<span class="tag ia">IA</span>` : `<span class="tag" title="${esc(c.iaError ?? "No enviado a la IA")}">Prefiltro</span>`}</td>
      <td>${etiquetaDecision(c)}</td>
      <td><button class="btn btn-ghost btn-sm" data-ver="${esc(c.id)}">Ver</button></td>
    </tr>`).join("") +
    ilegibles.map((c) => `
    <tr>
      <td>—</td>
      <td><strong>${esc(c.archivo)}</strong></td>
      <td colspan="6"><span class="tag no">${esc(c.error)}</span> <span class="muted small">Revísalo manualmente en Pandapé.</span></td>
    </tr>`).join("") ||
    `<tr><td colspan="8" class="muted">Sin candidatos que mostrar.</td></tr>`;
}
$("#filtro-texto").addEventListener("input", renderTabla);
$("#filtro-obligatorios").addEventListener("change", renderTabla);

// Acciones sobre candidatos (Top 5, tabla)
document.addEventListener("click", async (e) => {
  const ver = e.target.closest("[data-ver]");
  if (ver) { abrirDetalle(ver.dataset.ver); return; }
  const dec = e.target.closest("[data-decision]");
  if (dec) await decidir(dec.dataset.id, dec.dataset.decision);
});

async function decidir(id, decision) {
  const c = estado.candidatos.find((x) => x.id === id);
  if (!c) return;
  const nueva = c.decision === decision ? null : decision; // segundo clic deshace
  const cambios = { decision: nueva, decisionPor: estado.usuario.email, decisionEn: new Date().toISOString() };
  await datos.actualizarCandidato(estado.conv.id, id, cambios);
  Object.assign(c, cambios);
  renderResultados();
  if ($("#dlg-detalle").open) abrirDetalle(id);
  toast(nueva === "avanza" ? `${nombreDe(c)} avanza a la siguiente etapa.` : nueva === "descartado" ? `${nombreDe(c)} descartado.` : "Decisión revertida.");
}

// =============================== Detalle ===============================
function abrirDetalle(id) {
  const c = (estado.ranking ?? []).find((x) => x.id === id) ?? estado.candidatos.find((x) => x.id === id);
  if (!c) return;
  const ia = c.ia;
  const porId = new Map((ia?.criterios ?? []).map((e) => [e.id, e]));
  $("#det-nombre").textContent = nombreDe(c);
  $("#det-cuerpo").innerHTML = `
    <div class="row-gap">
      <span class="tag ia">${c.puntaje ?? 0}% ${c.fuente === "ia" ? "coincidencia" : "estimado (prefiltro)"}</span>
      ${etiquetaObligatorios(c)} ${etiquetaDecision(c)}
      ${c.decisionPor ? `<span class="muted small">por ${esc(c.decisionPor)} · ${fecha(c.decisionEn)}</span>` : ""}
    </div>
    ${ia ? `
      <p class="muted small" style="margin:0">${[ia.puestoActual, `${anios(ia.aniosExperiencia)} de experiencia relevante`, ia.formacion].filter(Boolean).map(esc).join(" · ")}</p>
      <p style="margin:0">${esc(ia.resumen)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Criterio</th><th>Resultado</th><th>Evidencia en el CV</th></tr></thead>
        <tbody>${estado.conv.criterios.map((cr) => {
          const ev = porId.get(cr.id);
          const [cls, icono, texto] = NIVEL[ev?.nivel ?? "no_cumple"];
          return `<tr><td>${esc(cr.descripcion)}<br><span class="muted small">${cr.tipo} · peso ${cr.peso}</span></td>
            <td><span class="tag ${cls}">${icono} ${texto}</span></td><td>${esc(ev?.evidencia ?? "Sin evaluar con estos criterios")}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
      ${ia.fortalezas?.length ? `<div><h3>Fortalezas</h3><ul>${ia.fortalezas.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
      ${ia.aVerificar?.length ? `<div><h3>Para verificar en entrevista</h3><ul>${ia.aVerificar.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
      <p class="muted small" style="margin:0">Analizado ${fecha(ia.analizadoEn)} · ${esc(ia.modelo ?? "")}${ia.truncado ? " · CV muy largo: se analizó solo la primera parte" : ""}</p>
    ` : `<p class="muted">Este CV aún no fue evaluado con IA${c.iaError ? ` (error: ${esc(c.iaError)})` : ""}. Su posición se basa en el prefiltro por palabras clave.</p>`}
    <div class="cand-actions">
      <button class="btn btn-ok btn-sm" data-decision="avanza" data-id="${esc(c.id)}">✓ Avanza</button>
      <button class="btn btn-bad btn-sm" data-decision="descartado" data-id="${esc(c.id)}">✗ Descartar</button>
    </div>
    <details><summary>Texto extraído del CV (${esc(c.archivo)})</summary>
      <div class="cv-texto">${esc(c.texto || "(sin texto: PDF escaneado)")}</div>
    </details>`;
  if (!$("#dlg-detalle").open) $("#dlg-detalle").showModal();
}
$("#dlg-detalle").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target === e.currentTarget) $("#dlg-detalle").close();
});

// =============================== Exportar CSV ===============================
$("#btn-exportar").addEventListener("click", () => {
  const conv = estado.conv;
  const ranking = estado.ranking ?? [];
  if (!ranking.length) { toast("No hay resultados para exportar."); return; }
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["Posición", "Candidato", "Archivo", "Puntaje %", "Fuente", "Cumple obligatorios", "Años experiencia", "Formación", "Puesto actual",
    ...conv.criterios.map((c) => c.descripcion), "A verificar", "Decisión", "Decidido por"];
  const filas = ranking.map((c, i) => {
    const porId = new Map((c.ia?.criterios ?? []).map((e) => [e.id, e]));
    return [i + 1, nombreDe(c), c.archivo, c.puntaje, c.fuente === "ia" ? "IA" : "Prefiltro",
      c.fuente === "ia" ? (c.obligatoriosOK ? "Sí" : "No") : "", c.ia?.aniosExperiencia, c.ia?.formacion, c.ia?.puestoActual,
      ...conv.criterios.map((cr) => NIVEL[porId.get(cr.id)?.nivel]?.[2] ?? ""),
      (c.ia?.aVerificar ?? []).join(" | "), c.decision ?? "pendiente", c.decisionPor];
  });
  const csv = "﻿" + [cab, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `preseleccion-${conv.titulo.replace(/[^\w]+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});
