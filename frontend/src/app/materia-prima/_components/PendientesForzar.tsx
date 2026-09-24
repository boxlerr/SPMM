"use client";

/**
 * «Avisar, no bloquear» para las pantallas de compras: el diálogo del 409.
 *
 * La regla de la casa (ver CatalogoSimple) es que el backend no se niega a lo que se
 * puede deshacer: contesta 409 con el motivo («Hay 2,5 libres; la reserva deja el stock
 * en negativo», «E4 tiene la OT 15692») y la persona decide si lo hace igual. Acá eso
 * pasa con el guardado AUTOMÁTICO: Maxi tilda una casilla, el cambio ya se ve, y recién
 * cuando el backend contesta 409 aparece la pregunta. Por eso el diálogo es una
 * promesa: el que guarda la espera en medio de su guardado y, según la respuesta,
 * repite con `?forzar=true` o deshace lo que se había mostrado.
 *
 * Es una COLA y no un diálogo solo: si se tildan dos reservas seguidas y las dos
 * vuelven con 409, se preguntan de a una, en orden, y ninguna respuesta se pierde.
 *
 * Lo usan Pendientes y la Cañera (las dos pantallas de Maxi); vive en un archivo
 * aparte para que las dos pregunten igual.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface PedidoConfirmacion {
    /** Qué se estaba haciendo («Reservar ABR117 para la OT 15692»). */
    titulo: string;
    /** El motivo que dio el backend: qué pasa si se hace igual. */
    motivo: string;
    /** El botón que sigue adelante. Por defecto, «Hacerlo igual». */
    boton?: string;
    /** El que se arrepiente. Por defecto, «Cancelar». */
    cancelar?: string;
}

/** Pregunta y espera: `true` = hacerlo igual. */
export type Confirmar = (pedido: PedidoConfirmacion) => Promise<boolean>;

type EnCola = PedidoConfirmacion & { resolver: (si: boolean) => void };

/**
 * `const { confirmar, dialogo } = useConfirmarForzar();` y dibujar `{dialogo}` en la
 * pantalla. `confirmar` es estable: se puede pasar a hooks y a filas memorizadas.
 */
export function useConfirmarForzar(): { confirmar: Confirmar; dialogo: ReactNode } {
    const [cola, setCola] = useState<EnCola[]>([]);
    const colaRef = useRef<EnCola[]>([]);
    colaRef.current = cola;

    const confirmar = useCallback<Confirmar>(
        (pedido) => new Promise<boolean>((resolver) => setCola((c) => [...c, { ...pedido, resolver }])),
        [],
    );

    // Si la pantalla se va con preguntas abiertas (se cambió de sección), se contestan
    // que no: el guardado que esperaba deshace lo suyo en vez de quedar colgado.
    useEffect(() => () => colaRef.current.forEach((p) => p.resolver(false)), []);

    // El diálogo se va con una animación: durante esos 200 ms la cola ya está vacía y,
    // leyendo `cola[0]`, el título quedaba en blanco y el texto cambiaba al de relleno
    // justo mientras se desvanecía. Se sigue mostrando el último pedido hasta que se va.
    const ultimoMostrado = useRef<EnCola | null>(null);
    if (cola[0]) ultimoMostrado.current = cola[0];
    const abierto = cola.length > 0;
    const actual = cola[0] ?? ultimoMostrado.current;
    const responder = (si: boolean) => {
        const primero = colaRef.current[0];
        if (!primero) return;
        primero.resolver(si);
        setCola((c) => (c[0] === primero ? c.slice(1) : c));
    };

    const dialogo = (
        <Dialog open={abierto} onOpenChange={(sigue) => { if (!sigue) responder(false); }}>
            <DialogContent className="sm:max-w-[460px]">
                <DialogHeader className="gap-2">
                    <div className="flex items-center gap-2">
                        <div className="rounded-full bg-amber-100 p-2 text-amber-700">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <DialogTitle className="text-base">{actual?.titulo}</DialogTitle>
                    </div>
                    <DialogDescription className="whitespace-pre-line pt-1 text-left text-sm text-gray-700">
                        {actual?.motivo || "El servidor pidió confirmación antes de seguir."}
                    </DialogDescription>
                </DialogHeader>
                {cola.length > 1 && (
                    <p className="text-xs text-gray-500">Hay {cola.length - 1} aviso{cola.length > 2 ? "s" : ""} más esperando.</p>
                )}
                <DialogFooter className="mt-2 gap-2 sm:gap-0">
                    <Button variant="outline" type="button" onClick={() => responder(false)}>
                        {actual?.cancelar ?? "Cancelar"}
                    </Button>
                    <Button
                        type="button"
                        className="bg-amber-600 text-white hover:bg-amber-700"
                        onClick={() => responder(true)}
                    >
                        {actual?.boton ?? "Hacerlo igual"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    return { confirmar, dialogo };
}
