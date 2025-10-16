"use client";

import { useEffect } from "react";

export default function CleanupBrowserExtensions() {
  useEffect(() => {
    // Suprimir completamente los errores de hidratación en la consola
    const originalError = console.error;
    console.error = (...args) => {
      const message = args[0];
      if (
        typeof message === 'string' &&
        (message.includes('bis_skin_checked') ||
         message.includes('bis_register') ||
         message.includes('__processed_') ||
         message.includes('hydration') ||
         message.includes('server rendered HTML') ||
         message.includes('A tree hydrated but some attributes'))
      ) {
        return; // No mostrar estos errores
      }
      originalError.apply(console, args);
    };

    // Función para limpiar atributos de extensiones del navegador
    const cleanupExtensionAttributes = () => {
      const elements = document.querySelectorAll('[bis_skin_checked], [bis_register], [__processed_]');
      elements.forEach(element => {
        element.removeAttribute('bis_skin_checked');
        element.removeAttribute('bis_register');
        element.removeAttribute('__processed_');
      });
    };

    // Limpiar inmediatamente
    cleanupExtensionAttributes();

    // Limpiar más frecuentemente
    const interval = setInterval(cleanupExtensionAttributes, 100);

    // Observer para detectar cambios en el DOM
    const observer = new MutationObserver(() => {
      cleanupExtensionAttributes();
    });

    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['bis_skin_checked', 'bis_register', '__processed_']
    });

    return () => {
      clearInterval(interval);
      observer.disconnect();
      console.error = originalError;
    };
  }, []);

  return null; // Este componente no renderiza nada
}
