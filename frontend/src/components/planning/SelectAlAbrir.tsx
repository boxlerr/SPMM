"use client";

/**
 * Un desplegable que arma sus opciones recién cuando se abre por primera vez.
 *
 * El Select de Radix dibuja TODAS sus opciones aunque esté cerrado (las necesita para
 * mostrar el nombre de la elegida en el cuadro). En Planificadas cada paso desplegado
 * tiene uno de personas (25) y uno de máquinas (32), y cada opción calcula si esa
 * persona o máquina está ocupada a esa hora: al elegir a Gustavo en el filtro se abrían
 * 22 OT y eran miles de opciones invisibles. La pantalla se congelaba casi dos segundos
 * (Lucas, 28/10/2026: «se re trabó al elegir el recurso humano en el filtro»).
 *
 * Acá el cuadro muestra el nombre que se le pasa en `texto`, y las opciones se arman
 * al abrir. Quedan armadas después de cerrar: si se sacaran, el desplegable se vaciaría
 * en medio de la animación de cierre.
 */

import * as React from "react";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SelectAlAbrirProps {
    value: string | undefined;
    onValueChange: (valor: string) => void;
    /** Lo que se lee en el cuadro con un valor elegido. */
    texto: React.ReactNode;
    /** Lo que se lee sin valor elegido. */
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    /** Las opciones (`SelectItem`). Se llama recién al abrir. */
    opciones: () => React.ReactNode;
}

export function SelectAlAbrir({ value, onValueChange, texto, placeholder, className, disabled, opciones }: SelectAlAbrirProps) {
    const [abierto, setAbierto] = React.useState(false);
    const [yaSeAbrio, setYaSeAbrio] = React.useState(false);
    return (
        <Select
            value={value}
            onValueChange={onValueChange}
            open={abierto}
            onOpenChange={(a) => {
                if (a) setYaSeAbrio(true);
                setAbierto(a);
            }}
            disabled={disabled}
        >
            <SelectTrigger className={className}>
                <SelectValue placeholder={placeholder}>{value !== undefined ? texto : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>{abierto || yaSeAbrio ? opciones() : null}</SelectContent>
        </Select>
    );
}
