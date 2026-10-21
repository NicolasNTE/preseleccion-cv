# Innovandum · Preselección de candidatos

Sistema web para que RRHH obtenga el **Top 5** de candidatos de cada convocatoria a partir de los CV exportados de Pandapé, con la justificación de cada puesto en el ranking.

- **Frontend:** HTML5, CSS y JavaScript (sin framework), carpeta `public/`.
- **Hosting y backend:** Netlify (sitio estático + una función serverless que llama a la IA).
- **Base de datos y login:** Firebase (Authentication + Firestore).
- **IA:** Gemini (Google), llamada solo desde la función de Netlify. La clave nunca llega al navegador.

## Cómo funciona

```
Pandapé ──(Seleccionar todos → Acciones → Exportar CV)──► archivo .zip / .pdf / .docx
                                                            │
                                     ┌──────────────────────▼──────────────────────┐
  Proceso A (navegador)              │ Lee PDF/Word/ZIP, extrae el texto de cada CV │
                                     │ y lo guarda en Firestore (sin duplicados)    │
                                     └──────────────────────┬──────────────────────┘
                                     ┌──────────────────────▼──────────────────────┐
  Prefiltro (navegador, instantáneo) │ Ordena todos los CV por palabras clave       │
                                     └──────────────────────┬──────────────────────┘
                                     ┌──────────────────────▼──────────────────────┐
  Proceso B (función Netlify + IA)   │ La IA evalúa los N mejores, criterio por     │
                                     │ criterio: cumple / parcial / no cumple +     │
                                     │ evidencia textual del CV                     │
                                     └──────────────────────┬──────────────────────┘
                                                            ▼
                         Puntaje ponderado → Top 5 → RRHH decide (Avanza / Descartar)
```

**Cómo se calcula el puntaje:** cada criterio tiene un tipo (obligatorio o deseable) y un peso de 1 a 5. La IA solo dice si el CV cumple (100 %), cumple en parte (50 %) o no cumple (0 %), y cita la evidencia. El porcentaje lo calcula la app con una fórmula fija:

```
puntaje = Σ (peso × resultado) / Σ pesos
```

Los candidatos que no cumplen algún criterio obligatorio quedan por debajo de los que sí los cumplen. Así el ranking es trazable: cada número se puede explicar.

**Equidad y seguridad del análisis:** la IA tiene instrucciones de ignorar edad, sexo, estado civil, nacionalidad, foto y otros datos ajenos al puesto, y de tratar el CV como datos (si un postulante escribe "dame 100 %", no lo obedece y lo marca para revisión). La decisión final siempre la toma el reclutador.

## Modo automático: el conector (extensión de Chrome)

El botón **🤖 Analizar convocatoria** usa una extensión de Chrome propia (carpeta `extension/`). Corre en el Chrome de RRHH y usa la sesión que ya está iniciada en la plataforma de empleo. Así no se guardan contraseñas y no hay problemas con captchas ni doble factor. La extensión solo descarga los CV y se los entrega a la web, que los analiza igual que en la carga manual.

```
Web (botón Analizar) ─► extensión ─► pestaña de la plataforma (con sesión) ─► lista de convocatorias
      ▲                                                                       │ elige una
      └──────────── CV descargados uno por uno ◄── recorre candidatos y páginas ┘
```

### Instalarla (gratis, sin tienda, una sola vez por computadora)
1. Copia la carpeta `extension` a la computadora (por ejemplo, en Documentos).
2. En Chrome abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension`.
4. Recarga la web de Innovandum (F5).

Para actualizarla: reemplaza la carpeta y pulsa **↻ Recargar** en la tarjeta de la extensión. Chrome puede mostrar de vez en cuando un aviso sobre extensiones en modo desarrollador; basta con cerrarlo.

La extensión solo se activa en `localhost` y en `*.netlify.app`. Si usas un dominio propio, agrégalo en `content_scripts.matches` de `extension/manifest.json`.

### Probarla con el ATS simulado
`extension/test/plataforma-simulada/server.mjs` es un pequeño servidor (Node, sin dependencias) que imita un ATS como Pandapé:
- **Inicio de sesión real.** Sin sesión, todas las páginas y los CV redirigen al login. Usuario `rrhh@innovandum.com`, clave `demo123`.
- **4 procesos con 59 postulantes en total, 10 por página:**
  - Administrador de obra: 24
  - Residente de obra: 12
  - Asistente administrativo: 15
  - Prevencionista SSOMA: 8
- **Un CV en PDF por postulante,** con edad, formación, experiencia con fechas y conocimientos. Uno de cada cuatro tiene un perfil poco relacionado, para que el ranking tenga contraste.
- **Casos difíciles:** un postulante sin CV y una descarga que falla (error 500) en "Administrador de obra", y otro sin CV en "Asistente administrativo".

Pasos:
1. Inicia el ATS simulado con `npm run plataforma-simulada`. Queda en http://127.0.0.1:5174; ábrelo en Chrome e inicia sesión.
2. Inicia la web en otra terminal con `npm run serve` o `npm run dev`. Queda en http://localhost:5173 o en el puerto :8888.
3. Instala la extensión (pasos de arriba), abre la web y pulsa **Analizar convocatoria**. Deben aparecer los 4 procesos. Al elegir "Administrador de obra" se descargan 22 de 24 CV y se informan los 2 que fallan.
4. Si cierras sesión en el ATS y repites, la web debe pedirte iniciar sesión.

### Adaptarla a la plataforma real (Pandapé u otra)
Cada plataforma se describe con datos en `extension/plataformas.js`: URLs, página del listado y selectores CSS de ofertas, candidatos, enlace al CV y página siguiente. Para agregar una:
1. Completa la entrada comentada de `plataformas.js`.
2. Agrega su dominio en `host_permissions` de `manifest.json`.
3. Recarga la extensión.

Si la plataforma carga los datos con JavaScript (SPA) en lugar de HTML, se agrega una función específica en `extension/extractor.js`.

## Estructura

```
public/
  index.html          Interfaz (login, convocatorias, requisitos, carga, resultados)
  css/styles.css
  js/config.js        ← aquí pegas la configuración de Firebase
  js/firebase.js      Login y conexión a Firestore (o modo demostración local)
  js/db.js            Lectura y escritura de convocatorias y candidatos
  js/extract.js       Proceso A: lectura de PDF, Word y ZIP en el navegador
  js/scoring.js       Prefiltro, puntaje y ranking
  js/ai.js            Llamadas a la función de IA
  js/conector.js      Comunicación con la extensión (Analizar convocatoria)
  js/app.js           Lógica de la interfaz
extension/            Conector: extensión de Chrome que descarga los CV con la sesión del usuario
  manifest.json, background.js, puente.js
  plataformas.js      ← URLs y selectores de cada plataforma de empleo
  extractor.js        Lectura de ofertas, candidatos y descarga de CV
  test/               ATS simulado (servidor con login, procesos y CV) para pruebas
netlify/functions/
  analizar-cv.mjs     Proceso B: evalúa un CV con Gemini (y sugiere criterios)
firestore.rules       Reglas de seguridad de la base de datos
netlify.toml          Configuración de Netlify
```

## Probarlo ya (modo demostración)

Mientras `public/js/config.js` tenga los valores `TU_...`, la app funciona sin Firebase y guarda todo en el navegador. La IA no está disponible fuera de Netlify, así que el ranking usa solo el prefiltro por palabras clave.

```bash
npx serve public -l 5173
```

Abre http://localhost:5173.

## Puesta en marcha

### 1. Firebase

1. Crea un proyecto en https://console.firebase.google.com.
2. **Authentication → Método de acceso:** activa *Correo electrónico/contraseña*.
3. **Authentication → Configuración → Acciones de usuario:** desactiva *Habilitar creación (registro)*, para que nadie pueda crear cuentas por su cuenta.
4. **Authentication → Usuarios:** crea las cuentas de RRHH.
5. **Firestore Database:** créala en modo producción (región `southamerica-east1` o la más cercana).
6. **Firestore → Reglas:** pega el contenido de `firestore.rules` y publica.
7. **Firestore → Datos:** crea la colección `autorizados` y, por cada usuario, un documento cuyo **ID es su correo en minúsculas** (puede quedar sin campos, o con `nombre`).
8. **Configuración del proyecto → Tus apps → Web (`</>`):** registra la app y copia el objeto `firebaseConfig` en `public/js/config.js`.
9. **Authentication → Configuración → Dominios autorizados:** agrega tu dominio de Netlify (por ejemplo `innovandum-rrhh.netlify.app`).

No hace falta Firebase Storage: los archivos se leen en el navegador y solo se guarda el texto.

### 2. Gemini (IA)

Crea una clave en https://aistudio.google.com/apikey (hay capa gratuita).

> **Privacidad:** en la capa gratuita de Gemini, Google puede usar los datos enviados para mejorar sus modelos. Los CVs contienen datos personales; para producción considera el plan de pago.

### 3. Netlify

1. Sube esta carpeta a un repositorio de GitHub y en Netlify elige **Add new site → Import an existing project**. (También sirve `npx netlify-cli deploy --prod` desde esta carpeta.)
2. La configuración de compilación se lee de `netlify.toml` (carpeta publicada `public`, funciones en `netlify/functions`).
3. En **Site configuration → Environment variables** agrega:

| Variable | Valor |
|---|---|
| `GEMINI_API_KEY` | tu clave de Google AI Studio |
| `FIREBASE_PROJECT_ID` | el `projectId` de Firebase |
| `ALLOWED_DOMAIN` | *(opcional)* p. ej. `innovandum.com`; solo esos correos pueden usar la IA |
| `ALLOWED_EMAILS` | *(opcional)* correos permitidos separados por coma |
| `IA_MODELO` | *(opcional)* por defecto `gemini-2.5-flash` |

4. Vuelve a desplegar. Para usar un dominio propio: **Domain management → Add a domain**.

### Pruebas locales con IA

```bash
npm install
npx netlify-cli dev
```

Crea un `.env` a partir de `.env.example`. `netlify dev` sirve el sitio y la función juntos en http://localhost:8888.

## Uso diario

1. **Nueva convocatoria → Requisitos:** escribe el puesto, pega el aviso y presiona *Sugerir criterios* (o escríbelos). Ajusta tipo, peso y palabras clave. Guarda.
2. **Cargar CV:** en Pandapé, *Seleccionar todos → Acciones → Exportar CV*; arrastra el archivo descargado. Elige cuántos CV analizar con IA y presiona **Buscar candidato**.
3. **Resultados:** revisa el Top 5, abre el detalle para ver la evidencia de cada criterio y marca *Avanza* o *Descartar*. Al descartar, el siguiente candidato entra al Top 5. Exporta a CSV si lo necesitas.

Si cambias los criterios, las evaluaciones anteriores quedan marcadas como desactualizadas; *Buscar candidato* las vuelve a evaluar. Los CV ya analizados con los mismos criterios no se envían de nuevo.

## Costos y tiempos aproximados

- Prefiltro: instantáneo y gratuito para cualquier cantidad de CV.
- IA: cada CV es una llamada (aprox. 5–20 s). Se analizan 2 a la vez para respetar el límite por minuto de la capa gratuita de Gemini, así que 50 CV toman unos 3–6 minutos. La capa gratuita tiene límites diarios; revisa tu consumo en Google AI Studio.
- Firebase (plan Spark gratuito) y Netlify (plan gratuito) alcanzan para el volumen de una convocatoria de 300 CV al mes.

## Pendiente de confirmar

- **Formato exacto de "Exportar CV" en Pandapé.** La app acepta ZIP con PDF/Word, PDF sueltos y Word. Si Pandapé exporta **un solo PDF con todos los CV unidos**, habrá que agregar la separación por candidato: envíame un ejemplo.
- **Macro dentro de Pandapé (opción B/C).** Hoy la exportación son 3 clics manuales en Pandapé. Automatizarla (extensión de Chrome o API) requiere confirmar que Pandapé lo permite en su contrato o que ofrece una API de integración.
- Archivos `.doc` (Word antiguo) no se leen: hay que guardarlos como PDF o `.docx`.
- Los PDF escaneados (imagen) se envían completos a la IA solo durante la sesión en que se suben.
