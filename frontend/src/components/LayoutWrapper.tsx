"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import AuthGuard from "./AuthGuard";
import AvisoAlEntrar from "./AvisoAlEntrar";
import { GuardiaDeRuta } from "./permisos/SinAcceso";
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
        {/* `dvh` y no `vh` donde el navegador lo entiende (RF-27, teléfonos). En Safari de
            iPhone 100vh es el alto con la barra de direcciones ESCONDIDA: con la barra a
            la vista, el último pedazo de <main> —justo donde se pegan los pies fijos, con
            Confirmar y Volver— quedaba debajo de la barra y no se podía tocar. `dvh` sigue
            a la barra. El `h-screen` queda de base para el navegador que no lo conoce. */}
        <div className="flex h-screen supports-[height:100dvh]:h-dvh bg-gray-50">
          <Sidebar />
          <main className="flex-1 overflow-auto flex flex-col">
            {/* Mostrar Topbar en todas las páginas excepto configuración */}
            {pathname !== "/configuracion" && <Topbar />}
            {/* El margen de todas las pantallas, y cuánto mide queda en `--pad-app`.
                Era un `p-6` fijo: en un teléfono de 375px se llevaba 48 de ancho antes
                de que empezara nada, y varias pantallas suman el suyo encima. Ahora es
                12px en teléfono, 16 en tableta y los 24 de siempre desde `lg`, así que
                en la computadora del taller no cambia nada.
                La variable existe porque hay pantallas que ocupan exactamente el alto
                de la ventana (el planificador, Operaciones) y descuentan este margen:
                antes lo tenían escrito a mano como `3rem` y, con el margen variable,
                ese número habría quedado mal en el teléfono.
                Abajo, 72px de más hasta `lg`: ahí el menú es el botón redondo que flota
                abajo a la izquierda (Sidebar) y tapaba para siempre la punta del último
                renglón de cada pantalla. Con ese aire, lo último se puede subir por
                encima del botón. */}
            <div className="[--pad-app:0.75rem] sm:[--pad-app:1rem] lg:[--pad-app:1.5rem] p-[var(--pad-app)] pb-[calc(var(--pad-app)+4.5rem)] lg:pb-[var(--pad-app)]">
              {/* RF-24: una pantalla que el rol no puede ver muestra el cartel de «no
                  tenés acceso» en vez de dibujarse rota (cada pedido volvería 403). */}
              <GuardiaDeRuta>{children}</GuardiaDeRuta>
            </div>
            {/* El cartel de novedades al entrar. Va acá adentro y no en el layout raíz
                a propósito: así no puede salir en el login, que es la única pantalla
                donde todavía no se sabe quién es el que entra. */}
            <AvisoAlEntrar />
          </main>
        </div>
      </PanelProvider>
    </AuthGuard>
  );
}
