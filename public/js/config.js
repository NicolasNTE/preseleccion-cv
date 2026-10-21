// Configuración del proyecto Firebase.
// Cópiala desde Firebase Console → Configuración del proyecto → Tus apps → App web.
// Estos valores NO son secretos: la seguridad la dan las reglas de Firestore (firestore.rules).
// Mientras apiKey empiece por "TU_", la app funciona en modo demostración local (sin Firebase).
export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "",
  appId: ""
};

// Endpoint de la función de Netlify que llama a la IA.
export const ENDPOINT_IA = "/api/analizar-cv";

// Cuántos CV se envían a la IA a la vez (la capa gratuita de Gemini limita las solicitudes por minuto).
export const CONCURRENCIA_IA = 2;
