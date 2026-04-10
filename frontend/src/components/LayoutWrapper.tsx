"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import AuthGuard from "./AuthGuard";
import { PanelProvider } from "@/contexts/PanelContext";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

export default function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Si la tecla Ctrl está presionada
      if (e.ctrlKey) {
        // Buscar el contenedor scrollable más cercano con nuestra clase específica
        const target = e.target as HTMLElement;
        const scrollContainer = target.closest('.scrollbar-horizontal-visible');
        
        if (scrollContainer) {
          // Prevenir el zoom del navegador
          e.preventDefault();
          // Desplazar horizontalmente (deltaY suele ser el scroll vertical de la rueda)
          scrollContainer.scrollLeft += e.deltaY;
        }
      }
    };

    // Registrar el evento con { passive: false } para poder usar e.preventDefault()
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // No mostrar sidebar ni topbar en la página de login
  if (pathname === "/login") {
    return <AuthGuard>{children}</AuthGuard>;
  }

  // Mostrar sidebar en todas las demás páginas con protección de autenticación
  return (
    <AuthGuard>
      <PanelProvider>
        <div className="flex h-screen bg-gray-50">
          <Sidebar />
          <main className="flex-1 overflow-auto flex flex-col">
            {/* Mostrar Topbar en todas las páginas excepto configuración */}
            {pathname !== "/configuracion" && <Topbar />}
            <div className="p-6">
              {children}
            </div>
          </main>
        </div>
      </PanelProvider>
    </AuthGuard>
  );
}
