'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const router = useRouter();

  // Cargar usuario del localStorage al iniciar
  useEffect(() => {
    const initAuth = () => {
      try {
        const storedToken = localStorage.getItem('access_token');
        const storedUser = localStorage.getItem('user');

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      } catch (error) {
        console.error('Error al cargar sesión:', error);
        // Limpiar localStorage si hay error
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // Control de inactividad (3 horas)
  useEffect(() => {
    if (!token) return;

    // 3 horas en milisegundos
    const INACTIVITY_TIMEOUT = 3 * 60 * 60 * 1000;
    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        // Si hay un token y no ha expirado la sesión ya
        if (token && !sessionExpired) {
          notifySessionExpired();
        }
      }, INACTIVITY_TIMEOUT);
    };

    // Eventos que reinician el contador
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click'];

    // Iniciar timer
    resetTimer();

    // Agregar listeners
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    // Cleanup
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [token, sessionExpired]);

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

        // Guardar en localStorage
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('user', JSON.stringify(userData));

        // Actualizar estado
        setToken(access_token);
        setUser(userData);

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
    // Limpiar localStorage
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');

    // Limpiar estado
    setToken(null);
    setUser(null);
    setSessionExpired(false);

    // Redirigir a login
    router.push('/login');
  };

  const notifySessionExpired = () => {
    setSessionExpired(true);
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
