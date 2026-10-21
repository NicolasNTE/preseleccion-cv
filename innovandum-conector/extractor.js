// Funciones que se ejecutan DENTRO de la pestaña de la plataforma (chrome.scripting.executeScript).
// Corren con la sesión del usuario, así que pueden leer páginas y descargar CV como él.
// Cada función debe ser autocontenida (sin variables externas) y devolver datos serializables.
// No lanzan errores: devuelven { error } para que el mensaje llegue intacto a la web.

/** Lista las ofertas publicadas. */
export async function listarOfertas(cfg) {
  const leer = async (url) => {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`La plataforma respondió ${r.status} al abrir ${url}`);
    return new DOMParser().parseFromString(await r.text(), "text/html");
  };
  const texto = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  // Si el elemento mezcla el número con otro texto (p. ej. una insignia "10"), se usa solo su propio texto.
  const numero = (el) => {
    if (!el) return NaN;
    const propio = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
    return parseInt((propio.trim() ? propio : el.textContent).replace(/\D/g, ""), 10);
  };
  const s = cfg.ofertas;
  const extraer = (doc, base) => [...doc.querySelectorAll(s.item)].map((el) => {
    const a = el.querySelector(s.enlace) ?? el.closest("a");
    const href = a?.getAttribute("href");
    if (!href) return null;
    const inscritos = numero(s.inscritos && el.querySelector(s.inscritos));
    return {
      nombre: texto(el.querySelector(s.nombre) ?? a),
      url: new URL(href, base).href,
      inscritos: Number.isFinite(inscritos) ? inscritos : null
    };
  }).filter(Boolean);
  try {
    const url = cfg.inicio ? new URL(cfg.inicio, location.origin).href : location.href;
    const doc = url === location.href ? document : await leer(url);
    if (cfg.sesion && !doc.querySelector(cfg.sesion)) {
      return { error: "No hay sesión iniciada en la plataforma. Inicia sesión en su pestaña y vuelve a intentar." };
    }
    const api = cfg.api?.ofertas;
    if (!api) return { ofertas: extraer(doc, url) };

    // Listado por POST: se pide página a página hasta que la plataforma indique la última.
    const ofertas = [];
    const vistas = new Set();
    for (let pagina = 1; pagina <= 100; pagina++) {
      const r = await fetch(new URL(api.url, location.origin).href, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        body: api.cuerpo.replace("{pagina}", pagina)
      });
      if (!r.ok) return { error: `La plataforma respondió ${r.status} al listar las ofertas.` };
      const json = await r.json();
      const nuevas = extraer(new DOMParser().parseFromString(json[api.vista] ?? "", "text/html"), location.origin)
        .filter((o) => !vistas.has(o.url));
      for (const o of nuevas) vistas.add(o.url);
      ofertas.push(...nuevas);
      if (json[api.ultima] || !nuevas.length) break;
    }
    return { ofertas };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Recorre todas las páginas de candidatos de una oferta.
 * Devuelve nombre y, según la plataforma, el enlace directo al CV (cvUrl) o a la ficha del candidato (fichaUrl).
 */
export async function listarCandidatos(cfg, ofertaUrl, maxPaginas) {
  const texto = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const s = cfg.candidatos;
  const candidatos = [];
  try {
    const api = cfg.api?.candidatos;
    if (api) {
      // Listado por POST (carga "ver más"): se piden páginas hasta que no queden candidatos.
      const f = (n) => String(n).padStart(2, "0");
      const d = new Date();
      const ahora = `${f(d.getDate())}/${f(d.getMonth() + 1)}/${d.getFullYear()} ${f(d.getHours())}:${f(d.getMinutes())}:${f(d.getSeconds())}`;
      const valores = { ahora: encodeURIComponent(ahora) };
      for (const [nombre, patron] of Object.entries(api.variables ?? {})) {
        valores[nombre] = ofertaUrl.match(new RegExp(patron))?.[1];
        if (!valores[nombre]) return { error: `No se pudo identificar la oferta en la URL (${nombre}).` };
      }
      const vistos = new Set();
      let pagina = 0;
      while (pagina < maxPaginas) {
        pagina++;
        const cuerpo = api.cuerpo.replace(/\{(\w+)\}/g, (_, k) => (k === "pagina" ? pagina : valores[k] ?? ""));
        const r = await fetch(new URL(api.url, location.origin).href, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
          body: cuerpo
        });
        if (!r.ok) return { error: `La plataforma respondió ${r.status} al listar los candidatos.` };
        const json = await r.json();
        const doc = new DOMParser().parseFromString(json[api.vista] ?? "", "text/html");
        let nuevos = 0;
        for (const el of doc.querySelectorAll(s.item)) {
          const href = el.querySelector(s.ficha)?.getAttribute("href");
          if (!href) continue;
          // La ficha conserva los parámetros de la oferta (p. ej. la carpeta del proceso).
          const ficha = new URL(href, ofertaUrl);
          for (const [k, v] of new URL(ofertaUrl).searchParams) if (!ficha.searchParams.has(k)) ficha.searchParams.set(k, v);
          if (vistos.has(ficha.href)) continue;
          vistos.add(ficha.href);
          nuevos++;
          candidatos.push({ nombre: texto(el.querySelector(s.nombre)), fichaUrl: ficha.href });
        }
        if (json[api.ultima] || !nuevos) break;
      }
      return { candidatos, paginas: pagina };
    }

    const visitadas = new Set();
    let url = ofertaUrl;
    while (url && !visitadas.has(url) && visitadas.size < maxPaginas) {
      visitadas.add(url);
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return { error: `La plataforma respondió ${r.status} al abrir la página de candidatos.` };
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      if (cfg.sesion && !doc.querySelector(cfg.sesion)) {
        return { error: "La sesión de la plataforma expiró. Inicia sesión de nuevo y vuelve a intentar." };
      }
      for (const el of doc.querySelectorAll(s.item)) {
        const href = el.querySelector(s.cv)?.getAttribute("href");
        candidatos.push({ nombre: texto(el.querySelector(s.nombre)), cvUrl: href ? new URL(href, url).href : null });
      }
      const sig = s.siguiente && doc.querySelector(s.siguiente)?.getAttribute("href");
      url = sig ? new URL(sig, url).href : null;
    }
    return { candidatos, paginas: visitadas.size };
  } catch (e) {
    return { error: e.message };
  }
}

/** Abre la ficha de un candidato y devuelve el enlace a su CV adjunto (o null si no subió ninguno). */
export async function buscarCV(cfg, fichaUrl) {
  try {
    const r = await fetch(fichaUrl, { credentials: "include" });
    if (!r.ok) return { error: `La plataforma respondió ${r.status} al abrir la ficha del candidato.` };
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    if (cfg.sesion && !doc.querySelector(cfg.sesion)) {
      return { error: "La sesión de la plataforma expiró. Inicia sesión de nuevo y vuelve a intentar." };
    }
    const href = doc.querySelector(cfg.candidatos.cvEnFicha)?.getAttribute("href");
    return { cvUrl: href ? new URL(href, fichaUrl).href : null };
  } catch (e) {
    return { error: e.message };
  }
}

/** Descarga un CV y lo devuelve en base64. */
export async function descargarCV(url) {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return { error: `Descarga fallida (${r.status})` };
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (mime === "text/html") return { error: "La plataforma devolvió una página en lugar del CV (¿sesión expirada?)" };
    const disp = r.headers.get("content-disposition") || "";
    const m = disp.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    const nombreArchivo = m ? decodeURIComponent(m[1] || m[2]) : decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "");
    const blob = await r.blob();
    const base64 = await new Promise((ok, mal) => {
      const lector = new FileReader();
      lector.onload = () => ok(String(lector.result).split(",")[1] ?? "");
      lector.onerror = () => mal(lector.error);
      lector.readAsDataURL(blob);
    });
    return { base64, mime, nombreArchivo, bytes: blob.size };
  } catch (e) {
    return { error: e.message };
  }
}
