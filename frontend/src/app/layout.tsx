import type { Metadata, Viewport } from "next";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";
import CleanupBrowserExtensions from "../components/CleanupBrowserExtensions";
import { NotificationProvider } from "../contexts/NotificationContext";
import { AuthProvider } from "../contexts/AuthContext";
import { ToastProvider } from "../components/ui/toast";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next"


// Sin next/font a propósito (20/10/2026): acá se cargaban Geist y Geist Mono, que se
// PRECARGABAN en cada pantalla (52 KB) y ningún estilo usaba: `font-sans` es «DM Sans»
// (globals.css) y `font-mono`, la monoespaciada del sistema.

// Atributos que les ponen algunas extensiones (bis_skin_checked es de Bitdefender) y
// que React marcaría como diferencia al hidratar.
const LIMPIAR_EXTENSIONES = `(function(){var A=['bis_skin_checked','bis_register','__processed_'];
var oe=console.error;console.error=function(){var m=arguments[0];if(typeof m==='string'&&(m.indexOf('bis_skin_checked')>-1||m.indexOf('bis_register')>-1||m.indexOf('__processed_')>-1||m.indexOf('hydration')>-1||m.indexOf('server rendered HTML')>-1||m.indexOf('A tree hydrated but some attributes')>-1))return;oe.apply(console,arguments);};
function todo(){document.querySelectorAll('[bis_skin_checked],[bis_register],[__processed_]').forEach(function(e){A.forEach(function(a){e.removeAttribute(a);});});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',todo);else todo();
new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i],e=m.target;if(m.attributeName&&e.hasAttribute&&e.hasAttribute(m.attributeName))e.removeAttribute(m.attributeName);}}).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:A});})();`;

export const metadata: Metadata = {
  title: "SPMM",
  description: "Sistema de Planificacion Metalurgica Metlo",
};

// RF-27 (interfaz responsive, de teléfono a escritorio). Next ya inyecta este mismo
// viewport por defecto, pero dejarlo escrito acá es lo que evita que alguien lo pise
// sin darse cuenta: sin `width=device-width` el teléfono dibuja la página a 980px y
// la achica, y todos los `sm:`/`lg:` de la app dejan de valer.
//
// Sin `maximumScale` ni `userScalable: false`, a propósito: el riel de cifras del plan
// y las tablas con zoom usan letra de 10-11px, y en el taller hay quien necesita
// agrandar con dos dedos. Bloquear el zoom sería esconderle eso.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `es` y no `en`: la app entera está en castellano. Con `en`, Chrome en el teléfono
    // ofrecía «traducir esta página» cada vez que se abría, y el lector de pantalla
    // leía los textos con pronunciación inglesa.
    <html lang="es">
      <head>
        {/* Antes era <script src="/hydration-fix.js">: un pedido que frenaba la página y un
            setInterval que barría TODO el DOM 20 veces por segundo, en todas las pantallas
            y para siempre. Ahora va escrito acá y sólo mira el elemento que la extensión
            del navegador marca (lo mismo que CleanupBrowserExtensions, pero desde antes
            de que React hidrate). */}
        <script dangerouslySetInnerHTML={{ __html: LIMPIAR_EXTENSIONES }} />
      </head>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <CleanupBrowserExtensions />
        <AuthProvider>
          <NotificationProvider>
            <ToastProvider>
              <LayoutWrapper>
                {children}
                {/* Arriba al centro. A la derecha tapaba los botones de Guardar y Planificar
                    —Lucas, 10/09: "y esto ponémelo para allá, molesta"— y abajo al centro
                    se pisa con las barras flotantes de acciones en lote.
                    Con una X para cerrarlo: arriba al centro queda encima de la
                    cabecera del planificador, y como sonner no se va mientras el mouse
                    está encima, el click a «Agregar OTs» caía en el cartel y el botón
                    parecía muerto (25/09/2026). */}
                <Toaster position="top-center" closeButton />
              </LayoutWrapper>
            </ToastProvider>
          </NotificationProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
