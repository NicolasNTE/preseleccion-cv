// Inicializa Firebase (Auth + Firestore) o activa el modo demostración local.
import { firebaseConfig } from "./config.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1";

export const modoLocal = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("TU_");

export let auth = null;
export let db = null;
export let fs = null;   // funciones de Firestore
export let fa = null;   // funciones de Auth

if (!modoLocal) {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`)
  ]);
  const app = initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  db = fsMod.getFirestore(app);
  fa = authMod;
  fs = fsMod;
}

const USUARIO_LOCAL = { email: "demo@local", uid: "local", getIdToken: async () => "" };

/** Llama a cb(usuario|null) cada vez que cambia la sesión. */
export function alCambiarSesion(cb) {
  if (modoLocal) { cb(USUARIO_LOCAL); return; }
  fa.onAuthStateChanged(auth, cb);
}

export async function ingresar(email, password) {
  return fa.signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

export async function salir() {
  if (!modoLocal) await fa.signOut(auth);
}

export async function restablecerClave(email) {
  return fa.sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

/** Token de sesión para la función de Netlify. */
export async function tokenSesion() {
  if (modoLocal) return "";
  return auth.currentUser ? auth.currentUser.getIdToken() : "";
}

/** Comprueba que el correo esté en la colección "autorizados". */
export async function estaAutorizado(usuario) {
  if (modoLocal) return true;
  try {
    const snap = await fs.getDoc(fs.doc(db, "autorizados", usuario.email.toLowerCase()));
    return snap.exists();
  } catch {
    return false;
  }
}
