"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

export default function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();
  
  // No mostrar sidebar ni topbar en la página de login
  if (pathname === "/login") {
    return <>{children}</>;
  }
  
  // Mostrar sidebar en todas las demás páginas
  return (
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
  );
}
