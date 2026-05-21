'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '../config';
import { isTokenExpired } from '@/lib/jwt';

interface User {
  id_usuario: number;
  username: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
  /** Mantenida por compatibilidad pero ya no abre popup — sólo limpia y redirige. */
  notifySessionExpired: () => void;
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
  }, [performSilentLogout]);

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

  const login = async (username: string, password: string) => {
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

        return { success: true };
      } else {
        // El backend devuelve { status:false, errors:[{message, campo}] }.
        // Para 5xx (ej. 503 cuando la BD está caída) usamos un mensaje genérico
        // de servicio no disponible en vez del fallback de credenciales.
        const backendMessage = data?.errors?.[0]?.message;
        const fallback = response.status >= 500
          ? 'Servicio no disponible. Intenta nuevamente en unos segundos.'
          : 'Credenciales inválidas';
        return {
          success: false,
          error: backendMessage || fallback,
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

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');

    setToken(null);
    tokenRef.current = null;
    setUser(null);
    auth401CountRef.current = 0;

    router.push('/login');
  };

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
