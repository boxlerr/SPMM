// Script para prevenir errores de hidratación causados por extensiones del navegador
(function() {
  'use strict';
  
  // Suprimir errores de hidratación antes de que React los muestre
  const originalError = console.error;
  console.error = function(...args) {
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

  // Función para limpiar atributos de extensiones
  function cleanupExtensionAttributes() {
    const elements = document.querySelectorAll('[bis_skin_checked], [bis_register], [__processed_]');
    elements.forEach(element => {
      element.removeAttribute('bis_skin_checked');
      element.removeAttribute('bis_register');
      element.removeAttribute('__processed_');
    });
  }

  // Limpiar inmediatamente si el DOM está listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanupExtensionAttributes);
  } else {
    cleanupExtensionAttributes();
  }

  // Limpiar periódicamente
  setInterval(cleanupExtensionAttributes, 50);

  // Observer para cambios en el DOM
  if (document.body) {
    const observer = new MutationObserver(cleanupExtensionAttributes);
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['bis_skin_checked', 'bis_register', '__processed_']
    });
  } else {
    // Si el body no está listo, esperar
    const bodyObserver = new MutationObserver(() => {
      if (document.body) {
        const observer = new MutationObserver(cleanupExtensionAttributes);
        observer.observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: ['bis_skin_checked', 'bis_register', '__processed_']
        });
        bodyObserver.disconnect();
      }
    });
    bodyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
