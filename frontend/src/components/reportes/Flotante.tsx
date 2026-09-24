"use client";

/**
 * El contenido de un Popover del armador de reportes, portaleado ADENTRO del diálogo.
 *
 * El PopoverContent de components/ui se portalea al <body>, y el armador es un Dialog de
 * Radix: todo lo que queda afuera del diálogo sale del focus-trap y se marca aria-hidden.
 * El click llega, pero el cursor no entra al campo: en «Guardar» no se podía escribir el
 * nombre ni buscar un cliente en un filtro. Es el mismo problema que ya resolvió
 * components/ui/searchable-select.tsx, resuelto igual: el menú va dentro del diálogo.
 */

import { createContext, forwardRef, useContext } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const ContenedorDeFlotantes = createContext<HTMLElement | null>(null);

export const Flotante = forwardRef<
    React.ElementRef<typeof PopoverPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => {
    const contenedor = useContext(ContenedorDeFlotantes);
    return (
        <PopoverPrimitive.Portal container={contenedor ?? undefined}>
            <PopoverPrimitive.Content
                ref={ref}
                align={align}
                sideOffset={sideOffset}
                collisionPadding={8}
                className={cn(
                    "z-50 w-72 rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});
Flotante.displayName = "Flotante";
