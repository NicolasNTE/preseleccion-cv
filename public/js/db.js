// Acceso a datos. Usa Firestore o, en modo demostración, localStorage.
//
// Modelo:
//   convocatorias/{convId}                       → puesto, descripción, criterios, versión de criterios
//   convocatorias/{convId}/candidatos/{candId}   → texto del CV, prefiltro, evaluación de la IA, decisión
// candId es un hash del texto del CV, así un mismo CV subido dos veces no se duplica.
import { modoLocal, db, fs } from "./firebase.js";

const ahora = () => new Date().toISOString();
// Firestore rechaza campos con valor undefined.
const sinUndefined = (obj) => JSON.parse(JSON.stringify(obj));
const nuevoId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

// ---------------- Modo local ----------------
const LS_CONV = "inv_convocatorias";
const lsCand = (convId) => `inv_cand_${convId}`;

function leerLS(clave, porDefecto) {
  try { return JSON.parse(localStorage.getItem(clave)) ?? porDefecto; } catch { return porDefecto; }
}
function escribirLS(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); }
  catch { throw new Error("El almacenamiento local está lleno. Configura Firebase para trabajar con muchos CV."); }
}

// ---------------- Convocatorias ----------------
export async function listarConvocatorias() {
  if (modoLocal) {
    return leerLS(LS_CONV, []).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  }
  const q = fs.query(fs.collection(db, "convocatorias"), fs.orderBy("creadoEn", "desc"));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Crea o actualiza. Devuelve la convocatoria con id. */
export async function guardarConvocatoria(conv, usuario) {
  const datos = { ...conv, actualizadoEn: ahora() };
  if (!datos.id) {
    datos.id = nuevoId();
    datos.creadoEn = ahora();
    datos.creadoPor = usuario?.email ?? "";
  }
  if (modoLocal) {
    const lista = leerLS(LS_CONV, []);
    const i = lista.findIndex((c) => c.id === datos.id);
    if (i >= 0) lista[i] = datos; else lista.push(datos);
    escribirLS(LS_CONV, lista);
    return datos;
  }
  const { id, ...resto } = datos;
  await fs.setDoc(fs.doc(db, "convocatorias", id), sinUndefined(resto), { merge: true });
  return datos;
}

export async function eliminarConvocatoria(convId) {
  await eliminarCandidatos(convId);
  if (modoLocal) {
    escribirLS(LS_CONV, leerLS(LS_CONV, []).filter((c) => c.id !== convId));
    return;
  }
  await fs.deleteDoc(fs.doc(db, "convocatorias", convId));
}

// ---------------- Candidatos ----------------
export async function listarCandidatos(convId) {
  if (modoLocal) return Object.values(leerLS(lsCand(convId), {}));
  const snap = await fs.getDocs(fs.collection(db, "convocatorias", convId, "candidatos"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Guarda varios candidatos (crea o fusiona por id). */
export async function guardarCandidatos(convId, candidatos) {
  if (modoLocal) {
    const mapa = leerLS(lsCand(convId), {});
    for (const c of candidatos) mapa[c.id] = { ...(mapa[c.id] ?? {}), ...c };
    escribirLS(lsCand(convId), mapa);
    return;
  }
  for (let i = 0; i < candidatos.length; i += 400) {
    const lote = fs.writeBatch(db);
    for (const { id, ...resto } of candidatos.slice(i, i + 400)) {
      lote.set(fs.doc(db, "convocatorias", convId, "candidatos", id), sinUndefined(resto), { merge: true });
    }
    await lote.commit();
  }
}

export async function actualizarCandidato(convId, candId, cambios) {
  if (modoLocal) {
    const mapa = leerLS(lsCand(convId), {});
    mapa[candId] = { ...(mapa[candId] ?? { id: candId }), ...cambios };
    escribirLS(lsCand(convId), mapa);
    return;
  }
  await fs.setDoc(fs.doc(db, "convocatorias", convId, "candidatos", candId), sinUndefined(cambios), { merge: true });
}

export async function eliminarCandidatos(convId) {
  if (modoLocal) { localStorage.removeItem(lsCand(convId)); return; }
  const snap = await fs.getDocs(fs.collection(db, "convocatorias", convId, "candidatos"));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = fs.writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
    await lote.commit();
  }
}
