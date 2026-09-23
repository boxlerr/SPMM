'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '../config';
import { isTokenExpired } from '@/lib/jwt';
import {
  leerPermisos,
  puede as puedeArea,
  puedeSeccion as puedeLaSeccion,
  rutaInicio,
  type AreaCodigo,
  type Nivel,
  type Permisos,
  type SeccionCodigo,
} from '@/lib/permisos';
import { avisarSinPermiso, marcarSinPermiso } from '@/lib/sinPermiso';

interface User {
  id_usuario: number;
  username: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
  /** Entró con una contraseña que le pasaron: no ve el sistema hasta cambiarla. */
  debe_cambiar_password?: boolean;
  /**
   * RF-24: los permisos YA RESUELTOS por el backend, tal cual vinieron (login o
   * /auth/me). Se guardan crudos y se leen con `leerPermisos`: si no vinieron —backend
   * de antes de RF-24— no hay campo y la pantalla da acceso total, como siempre.
   * Es el ÚNICO campo que /auth/me pisa además de `rol`: el resto del usuario (nombre,
   * apellido…) queda como vino del login, porque sin `apellido` el Sidebar se cae.
   */
  permisos?: unknown;
}

/**
 * Lo que devuelve un intento de login.
 *
 * `bloqueado` e `intentosRestantes` son del RF-26 (bloqueo tras 5 contraseñas malas
 * seguidas). Con un backend que todavía no lo tiene vienen en false/null y la pantalla
 * queda exactamente como antes: el mensaje del servidor en el cartel rojo.
 */
export interface ResultadoLogin {
  success: boolean;
  error?: string;
  /** La cuenta está bloqueada (el servidor contestó 423). */
  bloqueado?: boolean;
  /** Cuántas contraseñas malas más aguanta antes del bloqueo; null si no se sabe. */
  intentosRestantes?: number | null;
  /** RF-24: a qué pantalla ir después de entrar (la primera que puede ver). */
  inicio?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<ResultadoLogin>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
  /** Mantenida por compatibilidad pero ya no abre popup — sólo limpia y redirige. */
  notifySessionExpired: () => void;
  /** Vuelve a leer el usuario guardado. Se usa al salir del primer ingreso. */
  refreshUser: () => void;
  /**
   * RF-24. Los permisos resueltos por el backend, o null = acceso total (el backend
   * todavía no los manda). Para preguntar, mejor `puede` / `puedeSeccion` (o el hook
   * usePermisos), que ya saben qué hacer con el null.
   */
  permisos: Permisos | null;
  /** ¿Llega a `nivel` (por defecto, leer) en el área? Sin permisos, sí. */
  puede: (area: AreaCodigo, nivel?: Nivel) => boolean;
  /** ¿Llega a `nivel` (por defecto, leer) en la sección? Sin permisos, sí. */
  puedeSeccion: (seccion: SeccionCodigo, nivel?: Nivel) => boolean;
  /** La primera pantalla que puede ver: a donde va al entrar o si cae donde no puede. */
  rutaDeInicio: string;
  /** Vuelve a pedir los permisos a /auth/me (un cambio de rol se ve sin volver a entrar). */
  refrescarPermisos: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Endpoints públicos: aunque devuelvan 401, no significa "sesión expirada".
// Por ejemplo /auth/login devuelve 401 con credenciales inválidas.
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/forgot-password', '/auth/reset-password'];
// Endpoint usado para mantener vivo el backend (Render free tier duerme el server
// tras ~15 min sin tráfico). Si lo incluyéramos en el interceptor de 401, podría
// disparar logout por un mal cold-start, así que lo excluimos.
const KEEPALIVE_PATHS = ['/health'];

function isApiUrl(url: string): boolean {
  if (!url) return false;
  if (API_URL.startsWith('/')) {
    return url.startsWith(API_URL) || url.includes(API_URL + '/') || url.startsWith(`${window.location.origin}${API_URL}`);
  }
  return url.startsWith(API_URL);
}

function isPublicAuthPath(url: string): boolean {
  return PUBLIC_AUTH_PATHS.some((p) => url.includes(p));
}

function isKeepalivePath(url: string): boolean {
  return KEEPALIVE_PATHS.some((p) => url.includes(p));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // `tokenRef` mantiene siempre el token actual para que el interceptor de fetch
  // (instalado una sola vez) lo lea sin recrearse cada vez que cambia.
  const tokenRef = useRef<string | null>(null);
  // Flag para evitar disparar el redirect a /login varias veces en paralelo
  // cuando llegan muchos 401 juntos (típico al cargar la app y caen varios
  // fetches simultáneamente).
  const redirectingRef = useRef(false);
  // Contador consecutivo de 401: el primero podría ser un cold-start mal manejado
  // en Render; sólo logueamos al usuario si vemos 2+ seguidos.
  const auth401CountRef = useRef(0);

  /**
   * "Sesión expirada" silencioso: limpia credenciales y manda a /login SIN popup.
   * Antes había un AlertDialog modal que aparecía en cualquier 401 y obligaba al
   * usuario a hacer clic. Como en producción Render duerme el backend y un primer
   * fetch a veces devuelve 401 por cold-start, el popup aparecía sin motivo real.
   * Ahora simplemente redirige y el usuario re-loguea (con token de 30 días).
   */
  const performSilentLogout = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
    } catch {}
    setToken(null);
    tokenRef.current = null;
    setUser(null);
    // Pequeño delay para que la app no muestre flashes raros antes de navegar.
    setTimeout(() => {
      router.push('/login');
      redirectingRef.current = false;
    }, 50);
  }, [router]);

  // Mantenido por compatibilidad con código viejo que lo importa.
  const notifySessionExpired = useCallback(() => {
    performSilentLogout();
  }, [performSilentLogout]);

  // ---- RF-24: los permisos, al día con la base -------------------------------
  // El backend los resuelve contra la base en CADA pedido, así que un cambio de rol o
  // un permiso que se da o que vence vale desde el pedido siguiente. La pantalla, en
  // cambio, los tiene desde el login. Para que el menú y los botones no queden
  // mintiendo hasta volver a entrar, se vuelven a pedir a /auth/me: al abrir la app,
  // al volver a la pestaña (como mucho una vez por minuto) y después de un 403, que
  // es la señal más clara de que algo cambió.
  //
  // Sólo se toman `permisos` y `rol`. Nada más del usuario se pisa: /auth/me de un
  // backend viejo devuelve lo que dice el token, y el Sidebar se cae sin `apellido`.
  const ultimoRefrescoRef = useRef(0);
  const refrescarPermisosCon = useCallback(async (esperaMinimaMs: number) => {
    const tokenDelPedido = tokenRef.current;
    if (!tokenDelPedido) return;
    const ahora = Date.now();
    if (ahora - ultimoRefrescoRef.current < esperaMinimaMs) return;
    ultimoRefrescoRef.current = ahora;
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${tokenDelPedido}` },
        cache: 'no-store',
      });
      // 401 lo maneja el interceptor. 503 (no se pudieron leer), 404 o 500: queda lo
      // que había. Nunca se cierra nada porque un pedido falló.
      if (!res.ok) return;
      const cuerpo = await res.json().catch(() => null);
      const datos = cuerpo?.status ? cuerpo.data : null;
      if (!datos || typeof datos !== 'object') return;
      // Si en el medio cerró la sesión o entró otra persona, esto ya no es de nadie.
      if (tokenRef.current !== tokenDelPedido) return;
      setUser((previo) => {
        if (!previo) return previo;
        const siguiente: User = { ...previo };
        if (leerPermisos(datos.permisos)) {
          siguiente.permisos = datos.permisos;
        } else {
          // Contestó bien pero sin permisos: es un backend de antes de RF-24 (o se
          // volvió a uno). Acceso total, como él.
          delete siguiente.permisos;
        }
        if (typeof datos.rol === 'string' && datos.rol) siguiente.rol = datos.rol;
        try { localStorage.setItem('user', JSON.stringify(siguiente)); } catch { /* sin storage: queda en memoria */ }
        return siguiente;
      });
    } catch {
      // Red caída: queda lo que había.
    }
  }, []);

  const refrescarPermisos = useCallback(() => {
    void refrescarPermisosCon(60_000);
  }, [refrescarPermisosCon]);

  // Al abrir la app con una sesión guardada, y cada vez que se vuelve a la pestaña.
  useEffect(() => {
    if (!token) return;
    void refrescarPermisosCon(0);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void refrescarPermisosCon(60_000);
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [token, refrescarPermisosCon]);

  // ---- 1) Carga inicial: validar exp del token guardado ---------------------
  useEffect(() => {
    const initAuth = () => {
      try {
        const storedToken = localStorage.getItem('access_token');
        const storedUser = localStorage.getItem('user');

        if (storedToken && storedUser) {
          if (isTokenExpired(storedToken)) {
            // Token vencido o corrupto: lo borramos. NO mostramos popup — el
            // usuario va a aterrizar en /login automáticamente por el guard
            // de cada página (ProtectedRoute / similar).
            localStorage.removeItem('access_token');
            localStorage.removeItem('user');
          } else {
            setToken(storedToken);
            tokenRef.current = storedToken;
            setUser(JSON.parse(storedUser));
          }
        }
      } catch (error) {
        console.error('Error al cargar sesión:', error);
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // ---- 2) Interceptor global de fetch: maneja 401 sin popup -----------------
  // Antes: cualquier 401 abría un AlertDialog modal que bloqueaba la app.
  // Ahora: tras 2+ 401 consecutivos en endpoints de API (no public, no /health,
  // y sólo si creíamos tener sesión), hacemos logout silencioso a /login.
  // El "2+" es importante porque el cold-start de Render puede devolver 401 una
  // vez y al siguiente request ya va a andar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url;

      const response = await originalFetch(input, init);

      try {
        const isAuthFailure = response.status === 401
          && isApiUrl(url)
          && !isPublicAuthPath(url)
          && !isKeepalivePath(url)
          && tokenRef.current;

        // RF-24: cualquier 403 de la API es «no tenés permiso para esto». El backend
        // bloquea lo que el rol no permite aunque la pantalla haya dejado el botón (un
        // permiso que cambió recién, un botón que se escapó): en vez del error genérico
        // de cada pantalla sale un aviso claro, y se vuelven a pedir los permisos para
        // que lo que ya no se puede deje de ofrecerse.
        const esRechazo = response.status === 403
          && isApiUrl(url)
          && !isPublicAuthPath(url)
          && !!tokenRef.current;
        if (esRechazo) {
          // Antes de devolver la respuesta: así la pantalla ya encuentra el silencio
          // puesto cuando vaya a mostrar su error (ver lib/sinPermiso.ts).
          marcarSinPermiso();
          response.clone().json()
            .then((cuerpo) => {
              const detalle = cuerpo?.errors?.[0]?.message
                ?? cuerpo?.detail?.message
                ?? (typeof cuerpo?.detail === 'string' ? cuerpo.detail : null);
              // FastAPI contesta 403 «Not authenticated» a un pedido SIN token: eso es
              // un pedido mal armado, no un permiso que falta.
              if (detalle === 'Not authenticated') return;
              avisarSinPermiso(detalle);
            })
            .catch(() => avisarSinPermiso(null));
          if (!url.includes('/auth/me')) void refrescarPermisosCon(5_000);
        }

        if (isAuthFailure) {
          auth401CountRef.current += 1;
          if (auth401CountRef.current >= 2) {
            performSilentLogout();
          }
        } else if (response.ok && isApiUrl(url) && !isPublicAuthPath(url)) {
          // Reset si un request a la API anduvo bien — descarta falsos positivos
          // por cold-start.
          auth401CountRef.current = 0;
        }
      } catch (e) {
        console.warn('Error en interceptor de fetch:', e);
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [performSilentLogout, refrescarPermisosCon]);

  // ---- 3) Keep-alive: ping a /health cada 10 minutos ------------------------
  // Render free tier duerme el servicio tras ~15 minutos sin tráfico. Eso causa
  // que al volver a la app, el primer fetch tarde 30-60s o falle con 401/502.
  // Para evitarlo, mientras la sesión esté activa pingueamos /health cada 10 min,
  // suficiente para no llegar nunca al umbral de sueño. El ping NO incluye token
  // y el endpoint /health no requiere auth.
  useEffect(() => {
    if (!token) return; // sin sesión, no tiene sentido mantener vivo el backend
    const ping = () => {
      // No usamos await: es fire-and-forget. Tampoco queremos que un error
      // (red caída, etc.) escale al usuario.
      try {
        fetch(`${API_URL}/health`, { method: 'GET', cache: 'no-store' }).catch(() => { });
      } catch { /* noop */ }
    };
    // Primer ping inmediato para despertar el backend cuando el usuario entra.
    ping();
    const id = setInterval(ping, 10 * 60 * 1000); // 10 min
    return () => clearInterval(id);
  }, [token]);

  // ---- 4) Timer atado al `exp` del JWT: DESHABILITADO -----------------------
  // Antes corría un setTimeout que disparaba el popup cuando llegaba el `exp`
  // del JWT. Eso era molesto porque:
  //   - Si el usuario tenía un token viejo (cuando el TTL era 30 min) el popup
  //     saltaba al instante.
  //   - El usuario terminaba viendo "Sesión expirada" sin haber hecho nada.
  // Ahora sólo confiamos en el 401 real del backend (que ya tiene TTL=30 días).

  // ---- 5) Inactividad: DESHABILITADO ----------------------------------------
  // En el taller la gente puede pasar horas sin tocar la PC y la sesión no
  // debería caerse por eso.

  const login = async (username: string, password: string): Promise<ResultadoLogin> => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.status && data.data) {
        const { access_token, ...userData } = data.data;

        localStorage.setItem('access_token', access_token);
        localStorage.setItem('user', JSON.stringify(userData));

        setToken(access_token);
        tokenRef.current = access_token;
        setUser(userData);
        // Reseteamos contadores al re-loguear.
        auth401CountRef.current = 0;
        redirectingRef.current = false;

        // RF-24: la primera pantalla que puede ver. Sin permisos (backend viejo), el
        // Dashboard de siempre.
        return { success: true, inicio: rutaInicio(leerPermisos(userData.permisos)) };
      } else {
        // El backend devuelve { status:false, errors:[{message, campo}] }.
        // Para 5xx (ej. 503 cuando la BD está caída) usamos un mensaje genérico
        // de servicio no disponible en vez del fallback de credenciales.
        const backendMessage = data?.errors?.[0]?.message;
        const fallback = response.status >= 500
          ? 'Servicio no disponible. Intenta nuevamente en unos segundos.'
          : 'Credenciales inválidas';
        // RF-26: el backend nuevo manda en `data` si la cuenta quedó bloqueada y
        // cuántos intentos le quedan. El mensaje ya viene armado (con la hora del
        // bloqueo en hora del taller), así que acá sólo se lee para pintarlo distinto;
        // si no viene nada —backend viejo, usuario que no existe— es el cartel de siempre.
        const extra = data?.data && typeof data.data === 'object' ? data.data : null;
        return {
          success: false,
          error: backendMessage || fallback,
          bloqueado: extra?.bloqueado === true,
          intentosRestantes: typeof extra?.intentos_restantes === 'number' ? extra.intentos_restantes : null,
        };
      }
    } catch (error) {
      console.error('Error en login:', error);
      return {
        success: false,
        error: 'Error de conexión con el servidor'
      };
    }
  };

  /**

   * Relee el usuario de localStorage.

   *

   * Lo usa la pantalla de primer ingreso: cambia la contraseña, se apaga el flag en

   * el guardado y con esto el guard deja pasar sin tener que volver a loguearse.

   */

  const refreshUser = () => {

    try {

      const guardado = localStorage.getItem('user');

      if (guardado) setUser(JSON.parse(guardado));

    } catch { /* si no se puede leer, queda como estaba */ }

  };


  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');

    setToken(null);
    tokenRef.current = null;
    setUser(null);
    auth401CountRef.current = 0;

    router.push('/login');
  };

  // RF-24. null = acceso total: el backend no mandó permisos (todavía no tiene RF-24)
  // o vinieron con una forma que no se entiende. Nunca se cierra todo por un campo.
  const permisos = useMemo(() => leerPermisos(user?.permisos), [user?.permisos]);
  const puede = useCallback(
    (area: AreaCodigo, nivel: Nivel = 'read') => puedeArea(permisos, area, nivel),
    [permisos],
  );
  const puedeSeccion = useCallback(
    (seccion: SeccionCodigo, nivel: Nivel = 'read') => puedeLaSeccion(permisos, seccion, nivel),
    [permisos],
  );
  const rutaDeInicio = useMemo(() => rutaInicio(permisos), [permisos]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token && !!user,
        loading,
        notifySessionExpired,
        refreshUser,
        permisos,
        puede,
        puedeSeccion,
        rutaDeInicio,
        refrescarPermisos,
      }}
    >
      {children}
      {/* Popup "Sesión Expirada" removido a propósito. Antes era un AlertDialog
          modal que aparecía al instante por cualquier 401 (incluido cold-start de
          Render) y obligaba a hacer click. Ahora cualquier expiración real hace
          logout silencioso a /login. */}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}
