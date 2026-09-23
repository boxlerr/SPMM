"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, loading, rutaDeInicio } = useAuth();

  useEffect(() => {
    if (!loading) {
      // Si está autenticado, a su primera pantalla (RF-24: la primera que puede ver;
      // sin permisos, el Dashboard de siempre), sino al login
      if (isAuthenticated) {
        router.push(rutaDeInicio);
      } else {
        router.push('/login');
      }
    }
  }, [isAuthenticated, loading, router, rutaDeInicio]);


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-[#DC143C] mx-auto"></div>
        <p className="mt-4 text-gray-600">Cargando...</p>
      </div>
    </div>
  );
}
