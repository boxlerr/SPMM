import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "../components/LayoutWrapper";
import CleanupBrowserExtensions from "../components/CleanupBrowserExtensions";
import { NotificationProvider } from "../contexts/NotificationContext";
import { AuthProvider } from "../contexts/AuthContext";
import { ToastProvider } from "../components/ui/toast";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next"


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
        <script src="/hydration-fix.js" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
