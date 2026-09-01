"use client";

import { useState, useEffect } from "react";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    
    // 1024 y no 768: el Sidebar se vuelve `lg:relative` recién en lg (Sidebar.tsx),
    // y su overlay es `lg:hidden`. Con el corte en 768, entre 768 y 1023 —la tablet
    // del taller y cualquier ventana angosta del notebook— quedaba `fixed w-64` con
    // fondo blanco opaco ENCIMA del contenido, sin overlay para cerrarlo y sin ser
    // off-canvas: tapaba 256px de pantalla y no había manera de sacarlo.
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return { isMobile, isMounted };
}
