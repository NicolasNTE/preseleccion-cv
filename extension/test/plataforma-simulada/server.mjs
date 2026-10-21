// Plataforma de empleo SIMULADA para probar el conector de Innovandum (sin dependencias).
// Imita un ATS tipo Pandapé: inicio de sesión, procesos de selección, postulantes paginados y CV en PDF.
//
//   Uso:     node extension/test/plataforma-simulada/server.mjs   (o: npm run plataforma-simulada)
//   Abre:    http://127.0.0.1:5174   → usuario rrhh@innovandum.com / clave demo123
//
// Sin sesión, todas las páginas y CV redirigen al login (como la plataforma real).
// Casos de prueba incluidos: paginación (10 por página), un postulante sin CV y una descarga que falla.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, sep } from "node:path";

const PUERTO = Number(process.env.PORT || 5174);
const USUARIO = "rrhh@innovandum.com";
const CLAVE = "demo123";
const POR_PAGINA = 10;
const sesiones = new Set();

// ------------------------------------------------------------------ Datos simulados (deterministas)
let semilla = 20261020;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const muestra = (lista, n) => [...lista].sort(() => azar() - 0.5).slice(0, n);

const NOMBRES = ["Carlos", "Lucía", "Jorge", "Ana", "Miguel", "Rosa", "Pedro", "Elena", "Luis", "María", "José", "Carmen",
  "Diego", "Sofía", "Javier", "Valeria", "Ricardo", "Daniela", "Fernando", "Gabriela", "Andrés", "Patricia", "Raúl", "Milagros",
  "César", "Lorena", "Víctor", "Karina", "Hugo", "Silvia"];
const APELLIDOS = ["Mendoza", "Paredes", "Quispe", "Torres", "Rojas", "Flores", "Salas", "Castro", "Huamán", "Vargas", "Ramos",
  "Chávez", "Gutiérrez", "Sánchez", "Díaz", "Mamani", "Cárdenas", "Espinoza", "Ríos", "Villanueva", "Soto", "Medina", "Aguilar", "Cruz"];
const EMPRESAS = ["Constructora Andina S.A.", "Cosapi", "Graña y Montero", "JJC Contratistas", "Inmobiliaria Sur", "Obras Lima SAC",
  "Edifica", "Besco", "Constructora Pacífico", "Grupo Inca Ingeniería"];
const OTRAS_EMPRESAS = ["Retail Perú SAC", "Estudio Contable Ramírez", "Banco Andino", "Distribuidora Norte", "Call Center Lima"];

const PROCESOS = [
  {
    id: "4815", nombre: "Administrador de obra", sede: "Lima", publicado: "2026-10-01", inscritos: 24,
    titulos: ["Ingeniero Civil", "Arquitecto", "Licenciado en Administración", "Bachiller en Ingeniería Civil", "Técnico en Construcción Civil"],
    cargos: ["Administrador de obra", "Asistente de administración de obra", "Jefe de oficina técnica", "Residente de obra"],
    tareas: ["Control de presupuesto y valorizaciones", "Planillas de obra y control de personal", "Logística y compras de materiales",
      "Contratos con subcontratistas", "Cierre administrativo de obra", "Rendición de caja chica y control de almacén"],
    software: ["S10", "MS Project", "AutoCAD", "Excel avanzado", "SAP", "Power BI"]
  },
  {
    id: "4816", nombre: "Residente de obra", sede: "Arequipa", publicado: "2026-10-05", inscritos: 12,
    titulos: ["Ingeniero Civil colegiado (CIP)", "Ingeniero Civil", "Arquitecto", "Bachiller en Ingeniería Civil"],
    cargos: ["Residente de obra", "Supervisor de obra", "Asistente de residente", "Ingeniero de campo"],
    tareas: ["Dirección técnica de obras de edificación", "Control de calidad y protocolos", "Metrados y cronogramas",
      "Coordinación con supervisión y cliente", "Gestión de cuadrillas y subcontratistas"],
    software: ["MS Project", "AutoCAD", "Revit", "S10", "Civil 3D"]
  },
  {
    id: "4817", nombre: "Asistente administrativo", sede: "Lima", publicado: "2026-10-08", inscritos: 15,
    titulos: ["Bachiller en Administración", "Técnico en Administración", "Técnica en Secretariado Ejecutivo", "Contador Público", "Estudiante de Administración"],
    cargos: ["Asistente administrativo", "Auxiliar contable", "Recepcionista", "Practicante administrativo"],
    tareas: ["Archivo y control documentario", "Órdenes de compra y seguimiento a proveedores", "Conciliaciones bancarias",
      "Atención al cliente", "Agenda de gerencia", "Registro de facturas"],
    software: ["Excel intermedio", "Excel avanzado (tablas dinámicas)", "SAP básico", "Word", "Concar"]
  },
  {
    id: "4818", nombre: "Prevencionista SSOMA", sede: "Trujillo", publicado: "2026-10-12", inscritos: 8,
    titulos: ["Ingeniero de Seguridad Industrial", "Ingeniero Ambiental", "Ingeniero Industrial", "Técnico en Seguridad"],
    cargos: ["Prevencionista de riesgos", "Supervisor SSOMA", "Asistente de seguridad"],
    tareas: ["Elaboración de IPERC y ATS", "Inspecciones de seguridad en obra", "Charlas de 5 minutos", "Investigación de incidentes",
      "Cumplimiento de la Ley 29783 y G.050"],
    software: ["Excel", "ISO 45001", "ISO 14001", "Power BI"]
  }
];

function crearPostulante(proceso, i) {
  const nombre = `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
  const afin = azar() > 0.25; // 1 de cada 4 postulantes tiene un perfil poco relacionado
  const anios = afin ? entre(0, 15) : entre(0, 6);
  const edad = Math.max(21, 22 + anios + entre(0, 8));
  const egreso = 2026 - anios - entre(0, 2);
  const titulo = afin ? elegir(proceso.titulos) : elegir(["Bachiller en Marketing", "Técnico en Computación", "Estudiante de Derecho", "Comunicador"]);
  const experiencia = [];
  let fin = 2026;
  let restante = anios;
  while (restante > 0) {
    const dur = Math.min(restante, entre(1, 5));
    experiencia.push({
      periodo: `${fin - dur}-${fin === 2026 ? "actualidad" : fin}`,
      cargo: afin ? elegir(proceso.cargos) : elegir(["Vendedor", "Asesor comercial", "Operador de call center", "Asistente de marketing"]),
      empresa: afin ? elegir(EMPRESAS) : elegir(OTRAS_EMPRESAS),
      tareas: afin ? muestra(proceso.tareas, entre(2, 3)) : ["Atención al cliente y ventas", "Cumplimiento de metas comerciales"]
    });
    fin -= dur;
    restante -= dur;
  }
  return {
    id: `${proceso.id}-${String(i + 1).padStart(3, "0")}`,
    nombre, edad, titulo, egreso, anios, experiencia,
    software: afin ? muestra(proceso.software, entre(1, 4)) : ["Word", "Excel básico"],
    correo: `${nombre.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${i + 1}@correo.pe`,
    sinCV: false, falla: false,
    postulo: `2026-10-${String(entre(13, 20)).padStart(2, "0")}`
  };
}

const POSTULANTES = new Map(PROCESOS.map((p) => [p.id, Array.from({ length: p.inscritos }, (_, i) => crearPostulante(p, i))]));
// Casos difíciles para probar el manejo de errores
POSTULANTES.get("4815")[6].sinCV = true;
POSTULANTES.get("4815")[13].falla = true;
POSTULANTES.get("4817")[4].sinCV = true;
const PORID = new Map([...POSTULANTES.values()].flat().map((c) => [c.id, c]));

// ------------------------------------------------------------------ CV en PDF (texto real, legible por pdf.js)
function lineasCV(c, proceso) {
  const l = [c.nombre.toUpperCase(), `Correo: ${c.correo}  |  Teléfono: 9${String(c.id.replace(/\D/g, "")).padEnd(8, "7").slice(-8)}`,
    `Edad: ${c.edad} años  |  Lugar de residencia: ${proceso.sede}`, "", "FORMACIÓN ACADÉMICA",
    `${c.titulo} (${c.egreso})`, "", "EXPERIENCIA LABORAL"];
  if (!c.experiencia.length) l.push("Sin experiencia laboral formal. Prácticas preprofesionales en curso.");
  for (const e of c.experiencia) {
    l.push(`${e.periodo}  ${e.cargo} - ${e.empresa}`);
    for (const t of e.tareas) l.push(`   - ${t}.`);
  }
  l.push("", "CONOCIMIENTOS", c.software.join(", "), "", `Postulación al proceso: ${proceso.nombre} (${proceso.sede})`);
  return l;
}

function pdf(lineas) {
  const esc = (t) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const cuerpo = "BT /F1 11 Tf 56 790 Td 15 TL\n" + lineas.map((t) => `(${esc(t)}) '\n`).join("") + "ET";
  const flujo = Buffer.from(cuerpo, "latin1");
  const objetos = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"),
    Buffer.concat([Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`), flujo, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
  ];
  const partes = [Buffer.from("%PDF-1.4\n")];
  let largo = partes[0].length;
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(largo);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    partes.push(b);
    largo += b.length;
  });
  partes.push(Buffer.from(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${largo}\n%%EOF\n`));
  return Buffer.concat(partes);
}

// ------------------------------------------------------------------ Páginas HTML
const html = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const ESTILO = `<style>
*{box-sizing:border-box}body{font-family:Segoe UI,system-ui,sans-serif;margin:0;background:#f3f4f8;color:#1f2233}
header{background:#e8541e;color:#fff;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between}
header b{font-size:18px}header a{color:#fff}main{max-width:980px;margin:24px auto;padding:0 16px}
.aviso{background:#fff7d6;border:1px solid #f0d68a;padding:8px 12px;border-radius:6px;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px #0001}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eceef3;font-size:14px}th{background:#fafbfc;color:#666;font-size:12px;text-transform:uppercase}
a{color:#e8541e}.paginador{display:flex;gap:12px;align-items:center;margin:14px 0}.sin-cv{color:#999}
form.login{max-width:360px;margin:80px auto;background:#fff;padding:28px;border-radius:10px;box-shadow:0 2px 10px #0002;display:grid;gap:12px}
input{padding:10px;border:1px solid #ccc;border-radius:6px;font:inherit}button{background:#e8541e;color:#fff;border:0;padding:10px;border-radius:6px;font:inherit;cursor:pointer}
</style>`;

const pagina = (titulo, cuerpo, conSesion = true) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(titulo)} · ATS simulado</title>${ESTILO}</head><body>
<header><b>ATS simulado</b>${conSesion ? `<span class="usuario-sesion">${USUARIO} · <a href="/salir">Cerrar sesión</a></span>` : ""}</header>
<main>${conSesion ? `<p class="aviso">Plataforma de pruebas del conector de Innovandum. Imita un ATS como Pandapé (procesos → postulantes → CV).</p>` : ""}
${cuerpo}</main></body></html>`;

function vistaLogin(error) {
  return pagina("Iniciar sesión", `<form class="login" method="post" action="/login">
    <h2 style="margin:0">Iniciar sesión</h2>
    <p style="margin:0;color:#666;font-size:13px">Usuario de prueba: <b>${USUARIO}</b> · clave <b>${CLAVE}</b></p>
    ${error ? `<p style="color:#c00;margin:0">${error}</p>` : ""}
    <input name="usuario" type="email" value="${USUARIO}" required>
    <input name="clave" type="password" placeholder="Clave" required>
    <button>Ingresar</button></form>`, false);
}

function vistaProcesos() {
  const filas = PROCESOS.map((p) => `<tr class="proceso">
    <td><a class="proceso-link" href="/procesos/${p.id}/postulantes"><span class="proceso-nombre">${html(p.nombre)}</span></a></td>
    <td>${html(p.sede)}</td><td>${p.publicado}</td><td><span class="proceso-inscritos">${p.inscritos}</span></td></tr>`).join("");
  return pagina("Mis procesos", `<h1>Mis procesos de selección</h1>
    <table><thead><tr><th>Proceso</th><th>Sede</th><th>Publicado</th><th>Inscritos</th></tr></thead><tbody>${filas}</tbody></table>`);
}

function vistaPostulantes(proceso, pag) {
  const todos = POSTULANTES.get(proceso.id);
  const paginas = Math.ceil(todos.length / POR_PAGINA);
  const filas = todos.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA).map((c) => `<tr class="postulante">
    <td class="postulante-nombre">${html(c.nombre)}</td><td>${c.postulo}</td>
    <td>${c.sinCV ? `<span class="sin-cv">Sin CV adjunto</span>` : `<a class="cv-descargar" href="/cv/${c.id}">Descargar CV</a>`}</td></tr>`).join("");
  return pagina(proceso.nombre, `<p><a href="/procesos">← Mis procesos</a></p>
    <h1>${html(proceso.nombre)} <small style="color:#888;font-weight:400">· ${proceso.inscritos} inscritos</small></h1>
    <table><thead><tr><th>Postulante</th><th>Fecha de postulación</th><th>CV</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="paginador">
      ${pag > 1 ? `<a href="?pagina=${pag - 1}">← Anterior</a>` : ""}
      <span>Página ${pag} de ${paginas}</span>
      ${pag < paginas ? `<a class="pagina-siguiente" href="?pagina=${pag + 1}">Siguiente →</a>` : ""}
    </div>`);
}

// ------------------------------------------------------------------ Archivos estáticos (solo para pruebas)
// /_app/* sirve la web (public/) y /_ext/* el código del conector (extension/), en el mismo origen que el ATS.
// Permite probar el flujo completo en un navegador sin instalar la extensión.
const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
async function estatico(res, carpeta, resto) {
  const base = join(RAIZ, carpeta);
  const ruta = normalize(join(base, resto || "index.html"));
  if (ruta !== base && !ruta.startsWith(base + sep)) return responder(res, 403, "text/plain; charset=utf-8", "Prohibido");
  try {
    return responder(res, 200, TIPOS[extname(ruta)] || "application/octet-stream", await readFile(ruta), { "Cache-Control": "no-store" });
  } catch { return responder(res, 404, "text/plain; charset=utf-8", "No encontrado"); }
}

// ------------------------------------------------------------------ Servidor
const cookie = (req) => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => c.split("=")));
const responder = (res, codigo, tipo, cuerpo, extra = {}) => { res.writeHead(codigo, { "Content-Type": tipo, ...extra }); res.end(cuerpo); };
const redirigir = (res, a, extra = {}) => { res.writeHead(302, { Location: a, ...extra }); res.end(); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const conSesion = sesiones.has(cookie(req).sesion);

  if (ruta === "/login" && req.method === "POST") {
    let cuerpo = "";
    for await (const parte of req) cuerpo += parte;
    const datos = new URLSearchParams(cuerpo);
    if (datos.get("usuario") === USUARIO && datos.get("clave") === CLAVE) {
      const token = Math.random().toString(36).slice(2);
      sesiones.add(token);
      return redirigir(res, "/procesos", { "Set-Cookie": `sesion=${token}; HttpOnly; SameSite=Lax; Path=/` });
    }
    return responder(res, 200, "text/html; charset=utf-8", vistaLogin("Usuario o clave incorrectos."));
  }
  if (ruta === "/login") return responder(res, 200, "text/html; charset=utf-8", vistaLogin());
  if (ruta === "/salir") { sesiones.delete(cookie(req).sesion); return redirigir(res, "/login", { "Set-Cookie": "sesion=; Max-Age=0; Path=/" }); }

  const mEst = ruta.match(/^\/_(app|ext)(?:\/(.*))?$/);
  if (mEst) return estatico(res, mEst[1] === "app" ? "public" : "extension", mEst[2]);

  // Todo lo demás exige sesión, como en la plataforma real.
  if (!conSesion) return redirigir(res, "/login");

  if (ruta === "/" || ruta === "/procesos") return responder(res, 200, "text/html; charset=utf-8", vistaProcesos());

  const mProc = ruta.match(/^\/procesos\/(\d+)\/postulantes$/);
  if (mProc) {
    const proceso = PROCESOS.find((p) => p.id === mProc[1]);
    if (!proceso) return responder(res, 404, "text/plain; charset=utf-8", "Proceso no encontrado");
    const total = Math.ceil(proceso.inscritos / POR_PAGINA);
    const pag = Math.min(total, Math.max(1, Number(url.searchParams.get("pagina")) || 1));
    return responder(res, 200, "text/html; charset=utf-8", vistaPostulantes(proceso, pag));
  }

  const mCV = ruta.match(/^\/cv\/([\d-]+)$/);
  if (mCV) {
    const c = PORID.get(mCV[1]);
    if (!c || c.sinCV) return responder(res, 404, "text/plain; charset=utf-8", "CV no encontrado");
    if (c.falla) return responder(res, 500, "text/plain; charset=utf-8", "Error interno al generar el CV");
    const proceso = PROCESOS.find((p) => c.id.startsWith(p.id));
    const archivo = `CV ${c.nombre}.pdf`;
    return responder(res, 200, "application/pdf", pdf(lineasCV(c, proceso)), {
      "Content-Disposition": `attachment; filename="cv-${c.id}.pdf"; filename*=UTF-8''${encodeURIComponent(archivo)}`
    });
  }

  responder(res, 404, "text/plain; charset=utf-8", "No encontrado");
}).listen(PUERTO, "127.0.0.1", () => {
  const total = [...POSTULANTES.values()].reduce((n, l) => n + l.length, 0);
  console.log(`ATS simulado en http://127.0.0.1:${PUERTO}  (${PROCESOS.length} procesos, ${total} postulantes)`);
  console.log(`Usuario: ${USUARIO}  ·  Clave: ${CLAVE}`);
});
