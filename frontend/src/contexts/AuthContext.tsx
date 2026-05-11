'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_URL } from '../config';
import { isTokenExpired, msUntilExpiry } from '@/lib/jwt';

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
  notifySessionExpired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Endpoints públicos: aunque devuelvan 401, no significa "sesión expirada".
// Por ejemplo /auth/login devuelve 401 con credenciales inválidas y no debe disparar el popup.
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/forgot-password', '/auth/reset-password'];

function isApiUrl(url: string): boolean {
  if (!url) return false;
  // API_URL puede ser absoluta (https://...) o relativa (/api). Cubrimos ambos.
  if (API_URL.startsWith('/')) {
    return url.startsWith(API_URL) || url.includes(API_URL + '/') || url.startsWith(`${window.location.origin}${API_URL}`);
  }
  return url.startsWith(API_URL);
}

function isPublicAuthPath(url: string): boolean {
  return PUBLIC_AUTH_PATHS.some((p) => url.includes(p));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const router = useRouter();

  // `tokenRef` mantiene siempre el token actual para que el interceptor de fetch
  // (instalado una sola vez) lo lea sin recrearse cada vez que cambia.
  const tokenRef = useRef<string | null>(null);

  const notifySessionExpired = useCallback(() => {
    setSessionExpired(true);
  }, []);

  // ---- 1) Carga inicial: validar exp del token guardado ---------------------
  useEffect(() => {
    const initAuth = () => {
      try {
        const storedToken = localStorage.getItem('access_token');
        const storedUser = localStorage.getItem('user');

        if (storedToken && storedUser) {
          if (isTokenExpired(storedToken)) {
            // Token vencido o corrupto: lo borramos antes de montar nada
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

  // ---- 2) Interceptor global de fetch: dispara popup en 401 a la API --------
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url;

      const response = await originalFetch(input, init);

      try {
        if (
          response.status === 401 &&
          isApiUrl(url) &&
          !isPublicAuthPath(url) &&
          tokenRef.current  // sólo notificamos si creíamos estar autenticados
        ) {
          notifySessionExpired();
        }
      } catch (e) {
        // Nunca rompemos el response por culpa del interceptor
        console.warn('Error en interceptor de fetch:', e);
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [notifySessionExpired]);

  // ---- 3) Timer atado al `exp` real del JWT ---------------------------------
  // Cuando el token vence (según su claim `exp`), disparamos el popup, sin esperar
  // a que el usuario haga un fetch que vuelva 401.
  useEffect(() => {
    if (!token) return;
    const remainingMs = msUntilExpiry(token);
    if (remainingMs == null) return;

    if (remainingMs <= 0) {
      notifySessionExpired();
      return;
    }

    const id = setTimeout(() => {
      notifySessionExpired();
    }, remainingMs);

    return () => clearTimeout(id);
  }, [token, notifySessionExpired]);

  // ---- 4) Inactividad: DESHABILITADO ----------------------------------------
  // Antes había un timer que disparaba "Sesión Expirada" tras 8h sin mover el mouse.
  // En el taller la gente puede pasar horas sin tocar la PC y la sesión no debería
  // caerse por eso. La caducidad real está controlada por:
  //   - el `exp` del JWT (30 días por default, ver backend/core/config.py)
  //   - el interceptor global de 401 (si el server rechaza el token por cualquier motivo)
  //   - el botón "Cerrar sesión" del usuario
  // Si en el futuro se quiere reactivar inactividad, restaurar este bloque
  // desde el historial de git y ajustar INACTIVITY_TIMEOUT al valor deseado.

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
        setSessionExpired(false);

        return { success: true };
      } else {
        return {
          success: false,
          error: data.errorDescription || 'Credenciales inválidas'
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
    setSessionExpired(false);

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

      <AlertDialog open={sessionExpired}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sesión Expirada</AlertDialogTitle>
            <AlertDialogDescription>
              Tu sesión ha caducado. Por favor, inicia sesión nuevamente para continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={logout}>
              Iniciar Sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
