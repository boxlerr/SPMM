"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { TabsList } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Barra de sub-tabs que scrollea horizontal cuando no entra, pero AVISANDO que
 * hay más opciones: degradado en el borde + flecha para desplazar.
 *
 * Por qué existe: antes el scroll ya estaba, pero el scrollbar se ocultaba a
 * propósito (`[scrollbar-width:none]`), así que con el sidebar abierto los tabs
 * quedaban cortados en "Planificadas | Seman" y no había ninguna señal de que
 * existieran "Diaria", "Finalizadas" y "Carga" — eran invisibles para el usuario.
 */
export function ScrollableTabsBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Tolerancia de 1px: con zoom del browser el scroll es fraccionario y nunca
    // llega al valor exacto, lo que dejaría la flecha derecha prendida siempre.
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    update()
    // ResizeObserver y no un listener de window: el ancho útil cambia al abrir o
    // cerrar el sidebar (y al animar esa transición), no solo al resizear la ventana.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [update])

  const scrollStep = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" })
  }

  return (
    // `lg:shrink-0` = los tabs no ceden ancho ante las acciones (son navegación
    // principal). `max-w-full` es el complemento necesario: si aun así no entran,
    // el wrapper se topea al ancho del contenedor y el scroll interno se activa
    // (con degradado + flecha) en vez de que el card los recorte en silencio.
    <div className={cn("relative min-w-0 w-full max-w-full lg:w-auto lg:shrink-0", className)}>
      <TabsList
        ref={scrollRef}
        onScroll={update}
        className="bg-transparent p-0 h-auto flex flex-nowrap gap-1 sm:gap-2 lg:gap-3 justify-start w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </TabsList>

      {canLeft && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-gray-50 via-gray-50/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollStep(-1)}
            aria-label="Ver opciones anteriores"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:text-gray-900 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}

      {canRight && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-gray-50 via-gray-50/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollStep(1)}
            aria-label="Ver más opciones"
            className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:text-gray-900 hover:bg-gray-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}
