"use client";

import { useEffect } from "react";

export default function SuppressHydrationWarning({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Suprimir errores de hidratación causados por extensiones del navegador
    const originalError = console.error;
    console.error = (...args) => {
      const message = args[0];
      if (
        typeof message === 'string' &&
        (message.includes('bis_skin_checked') ||
         message.includes('bis_register') ||
         message.includes('hydration') ||
         message.includes('server rendered HTML') ||
         message.includes('__processed_') ||
         message.includes('A tree hydrated but some attributes'))
      ) {
        return;
      }
      originalError.apply(console, args);
    };

    // También suprimir warnings de hidratación específicos
    const originalWarn = console.warn;
    console.warn = (...args) => {
      const message = args[0];
      if (
        typeof message === 'string' &&
        (message.includes('bis_skin_checked') ||
         message.includes('bis_register') ||
         message.includes('hydration'))
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  return <div suppressHydrationWarning>{children}</div>;
}
