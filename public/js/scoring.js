// Cálculo de puntajes y ranking. Todo es determinista y trazable:
// la IA solo dice "cumple / parcial / no cumple" por criterio; el puntaje lo calcula esta fórmula.

export const FACTOR = { cumple: 1, parcial: 0.5, no_cumple: 0 };

const STOP = new Set(("de la el los las un una unos unas y o en con por para del al que se su sus como " +
  "mas más menos años año experiencia conocimiento conocimientos manejo nivel minimo mínimo minima mínima " +
  "deseable obligatorio otros otras sobre entre desde hasta tener contar buen buena preferentemente").split(" "));

export const normalizar = (s = "") =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function palabrasClave(criterio) {
  if (criterio.claves?.trim()) {
    return { lista: criterio.claves.split(",").map((k) => normalizar(k.trim())).filter(Boolean), explicitas: true };
  }
  const lista = normalizar(criterio.descripcion)
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  return { lista: [...new Set(lista)], explicitas: false };
}

/**
 * Prefiltro rápido por palabras clave (sin IA). Sirve para ordenar cientos de CV al instante
 * y decidir cuáles se envían a la IA.
 */
export function preScore(texto, criterios) {
  const t = normalizar(texto);
  let suma = 0, pesos = 0;
  for (const c of criterios) {
    const { lista, explicitas } = palabrasClave(c);
    let factor = 0;
    if (lista.length) {
      const encontradas = lista.filter((k) => t.includes(k)).length;
      if (explicitas) factor = encontradas > 0 ? 1 : 0;
      else factor = encontradas / lista.length >= 0.5 ? 1 : encontradas / lista.length >= 0.25 ? 0.5 : 0;
    }
    suma += factor * c.peso;
    pesos += c.peso;
  }
  return pesos ? Math.round((suma / pesos) * 100) : 0;
}

/** Puntaje final a partir de la evaluación de la IA. */
export function puntajeIA(evaluacion, criterios) {
  const porId = new Map((evaluacion?.criterios ?? []).map((e) => [e.id, e]));
  let suma = 0, pesos = 0;
  const faltantesObligatorios = [];
  for (const c of criterios) {
    const nivel = porId.get(c.id)?.nivel ?? "no_cumple";
    suma += FACTOR[nivel] * c.peso;
    pesos += c.peso;
    if (c.tipo === "obligatorio" && nivel === "no_cumple") faltantesObligatorios.push(c.descripcion);
  }
  return {
    puntaje: pesos ? Math.round((suma / pesos) * 100) : 0,
    obligatoriosOK: faltantesObligatorios.length === 0,
    faltantesObligatorios
  };
}

/**
 * Ordena candidatos: primero los evaluados por IA, luego los que cumplen todos los obligatorios,
 * luego por puntaje. Agrega a cada candidato: puntaje, fuente, obligatoriosOK.
 */
export function rankear(candidatos, conv) {
  const vigente = conv.versionCriterios;
  return candidatos
    .filter((c) => !c.error || c.ia)
    .map((c) => {
      const iaVigente = c.ia && c.ia.versionCriterios === vigente;
      if (iaVigente) {
        const r = puntajeIA(c.ia, conv.criterios);
        return { ...c, ...r, fuente: "ia" };
      }
      return {
        ...c,
        puntaje: preScore(c.texto ?? "", conv.criterios),
        obligatoriosOK: null,
        faltantesObligatorios: [],
        fuente: "prefiltro"
      };
    })
    .sort((a, b) =>
      (b.fuente === "ia") - (a.fuente === "ia") ||
      (b.obligatoriosOK === true) - (a.obligatoriosOK === true) ||
      b.puntaje - a.puntaje ||
      (b.ia?.aniosExperiencia ?? 0) - (a.ia?.aniosExperiencia ?? 0)
    );
}

/** Huella de los criterios: si cambian, las evaluaciones anteriores dejan de estar vigentes. */
export async function versionDeCriterios(conv) {
  const base = JSON.stringify([conv.titulo, conv.descripcion, conv.criterios.map((c) => [c.id, c.descripcion, c.tipo])]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return [...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}
