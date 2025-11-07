'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Si no está cargando y no está autenticado, redirigir al login
    if (!loading && !isAuthenticated && pathname !== '/login') {
      router.push('/login');
    }
    // Si está en login y ya está autenticado, redirigir al dashboard
    if (!loading && isAuthenticated && pathname === '/login') {
      router.push('/dashboard');
    }
  }, [isAuthenticated, loading, pathname, router]);

  // Mostrar loading mientras se verifica la autenticación
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#DC143C] mx-auto mb-4"></div>
          <p className="text-gray-600">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  // Si no está autenticado y no es la página de login, no mostrar nada
  // (se redirigirá en el useEffect)
  if (!isAuthenticated && pathname !== '/login') {
    return null;
  }

  // Si está en login y ya está autenticado, no mostrar nada
  // (se redirigirá en el useEffect)
  if (isAuthenticated && pathname === '/login') {
    return null;
  }

  return <>{children}</>;
}
