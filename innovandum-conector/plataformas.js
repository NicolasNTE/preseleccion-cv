// Plataformas de empleo que el conector sabe leer.
// Cada plataforma se describe con datos (URLs y selectores CSS), no con código:
// para adaptar una plataforma nueva normalmente basta con agregar una entrada aquí
// y su dominio en "host_permissions" de manifest.json.
//
//   urls        patrones de pestañas donde está abierta la plataforma (con la sesión iniciada)
//   inicio      página con el listado de ofertas/convocatorias (relativa al dominio de la pestaña)
//   sesion      selector que solo existe con la sesión iniciada (si falta, se pide iniciar sesión)
//   ofertas     selectores del listado de ofertas
//   candidatos  selectores dentro de una oferta; "siguiente" es el enlace a la página siguiente.
//               "cv" es el enlace al CV dentro de la fila; si el CV está en la ficha del candidato, se usan
//               "ficha" (enlace a la ficha, dentro de la fila) y "cvEnFicha" (enlace al CV dentro de la ficha)
//   api         opcional, para plataformas que cargan los listados por POST (JSON con un fragmento HTML):
//               { ofertas | candidatos: { url, cuerpo con {pagina}, vista, ultima, variables? } }
export const PLATAFORMAS = [
  {
    // ATS simulado para pruebas: npm run plataforma-simulada → http://127.0.0.1:5174
    id: "simulada",
    nombre: "ATS simulado (pruebas)",
    urls: ["http://127.0.0.1/*"],
    abrir: "http://127.0.0.1:5174/procesos",
    inicio: "/procesos",
    sesion: ".usuario-sesion",
    ofertas: { item: "tr.proceso", nombre: ".proceso-nombre", enlace: "a.proceso-link", inscritos: ".proceso-inscritos" },
    candidatos: { item: "tr.postulante", nombre: ".postulante-nombre", cv: "a.cv-descargar", siguiente: "a.pagina-siguiente" }
  },
  {
    // Pandapé (ATS de Computrabajo). Los listados no son páginas con enlace "siguiente": se cargan con
    // POST y devuelven JSON con un fragmento HTML, por eso se describen en "api" (ver extractor.js).
    // El CV no está en la lista: hay que abrir la ficha del candidato y leer "CV adjunto" (en "ficha").
    id: "pandape",
    nombre: "Pandapé",
    urls: ["https://ats.pandape.com/*"],
    abrir: "https://ats.pandape.com/Company/Vacancy",
    inicio: "/Company/Vacancy",
    sesion: ".user-name",
    ofertas: { item: ".js_rowvacancy", nombre: "a.fw-900", enlace: "a.fw-900", inscritos: "a.total .counter-num" },
    candidatos: { item: ".match-item", nombre: ".js_MatchUserName", ficha: "a.js_lnkMatchDetail", cvEnFicha: "#ResumeProfile a[href*='OpenCandidateDocument']" },
    api: {
      ofertas: {
        url: "/Company/Vacancy/ListVacancies",
        cuerpo: "Pagination[PageNumber]={pagina}&Pagination[PageSize]=10&Order=1&IdsFilter=0&BeginDate=&EndDate=&Geo=false",
        // "isLast" de este listado siempre vale true y la última página se repite: se corta al no haber procesos nuevos.
        vista: "view"
      },
      candidatos: {
        url: "/Company/Match/ListMatches",
        cuerpo: "matchesFilter.PageNumber={pagina}&matchesFilter.PageSize=10&matchesFilter.Order=0&matchesFilter.IsLast=False" +
          "&matchesFilter.IdVacancy={idVacante}&matchesFilter.IdVacancyFolder={idCarpeta}&MaxDatetimeToLoad={ahora}",
        // Se sacan de la URL de la oferta, p. ej. /Company/Match/Matches/13893948?idvacancyfolder=93316855
        variables: { idVacante: "/Matches/(\\d+)", idCarpeta: "idvacancyfolder=(\\d+)" },
        vista: "viewList",
        ultima: "isLast"
      }
    }
  }
];
