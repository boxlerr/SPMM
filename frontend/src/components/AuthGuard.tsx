'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import PrimerIngreso from '@/components/usuarios/PrimerIngreso';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, loading, user, refreshUser } = useAuth();
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

  // Primera vez que entra: no ve el sistema hasta poner una contraseña suya.
  //
  // La inicial se la pasó otra persona por chat, así que hasta que la cambie está
  // escrita en algún lado. Va acá y no en una página aparte a propósito: desde una
  // ruta se puede volver atrás o escribir otra en la barra; desde acá, no hay sistema
  // hasta que la cambie.
  if (isAuthenticated && user?.debe_cambiar_password) {
    return <PrimerIngreso onListo={refreshUser} />;
  }

  return <>{children}</>;
}
