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

    // Atributos que les ponen a los elementos algunas extensiones del navegador (por
    // ejemplo `bis_skin_checked`, de Bitdefender, muy común en las PC con Windows).
    const ATRIBUTOS = ['bis_skin_checked', 'bis_register', '__processed_'];

    // Una pasada completa al arrancar, para lo que ya estaba marcado.
    document
      .querySelectorAll('[bis_skin_checked], [bis_register], [__processed_]')
      .forEach(el => ATRIBUTOS.forEach(a => el.removeAttribute(a)));

    // Después, sólo el elemento que la extensión acaba de marcar.
    //
    // Antes esto barría TODO el DOM cada 100 ms y, además, otra vez por cada atributo
    // que ponía la extensión. Con el Historial abierto eran 80.000 nodos: diez barridos
    // por segundo más uno por cada div marcado, en la PC del taller y en todas las
    // pantallas (esto vive en el layout). El observador ya dice qué elemento cambió; no
    // hace falta buscarlo en toda la página. Al sacar el atributo llega otro aviso con el
    // atributo ya ausente, que no hace nada: no hay rebote.
    const observer = new MutationObserver(mutaciones => {
      for (const m of mutaciones) {
        const el = m.target;
        if (m.attributeName && el instanceof Element && el.hasAttribute(m.attributeName)) {
          el.removeAttribute(m.attributeName);
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ATRIBUTOS,
    });

    return () => {
      observer.disconnect();
      console.error = originalError;
    };
  }, []);

  return null; // Este componente no renderiza nada
}
