"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

/**
 * Para sacar un globito al `body` cuando algún ancestro lo ubicaría mal.
 *
 * `TooltipContent` no va en portal y así se queda en el resto de la app: cambiarlo
 * para todos movería también los globitos del Gantt. Hace falta donde hay un ancestro
 * con `container-type` (26/09/2026, la vista previa del plan desde lg): floating-ui lo
 * toma como bloque contenedor del `position: fixed` y Chrome no, y el globito salía
 * corrido lo que ese ancestro estuviera corrido en la ventana, fuera de la pantalla.
 */
const TooltipPortal = TooltipPrimitive.Portal

const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
            "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className
        )}
        {...props}
    />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipPortal, TooltipProvider }
