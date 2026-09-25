"use client";

/**
 * «+ Nuevo insumo» desde la solapa Materias primas de la OT: el MISMO formulario de la
 * ficha del catálogo (FormularioInsumo), dentro de un diálogo.
 *
 * Existe para que no encontrar un insumo mientras se carga una OT no sea un callejón:
 * sin esto había que dejar la OT a medias, ir al catálogo, darlo de alta y volver. Se da
 * de alta acá, con las mismas reglas (código y descripción del backend, aviso de
 * duplicado con «Crear igual») y queda elegido en la barra de carga.
 *
 * Contrato:
 *  · `open` / `onClose`: controlado por quien lo abre.
 *  · `onCreado(insumo)`: con la ficha que devolvió el alta. Después de avisar, el
 *    diálogo llama a `onClose` él solo: quien lo abre no tiene que cerrarlo (si lo
 *    cierra igual en `onCreado`, no pasa nada).
 *  · `tipoInicial`, `descripcionInicial`: lo que ya se sabe (lo que se tipeó en el
 *    buscador y no apareció), para no escribirlo dos veces. Con descripción y sin tipo,
 *    arranca como «Insumo c/ descripción».
 *  · Va adentro del modal de la OT: su Escape cierra este diálogo y nada más (Radix
 *    atiende sólo la capa de arriba), y los desplegables del formulario se abren dentro
 *    de él (van al `[role=dialog]` más cercano).
 *
 * El formulario se monta cada vez que se abre: un alta a medio hacer que se cerró no
 * aparece la próxima vez.
 */

import type { ReactNode } from "react";
import type { InsumoFicha, TipoInsumo } from "@/lib/materiaPrima";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormularioInsumo } from "./FormularioInsumo";

export interface NuevoInsumoDialogProps {
    open: boolean;
    onClose: () => void;
    onCreado: (insumo: InsumoFicha) => void;
    tipoInicial?: TipoInsumo;
    descripcionInicial?: string;
    /**
     * El texto de debajo del título. Por defecto el de la OT («…y elegido para esta
     * OT»); el botón «Nuevo» de la sección lo abre sin OT y trae el suyo.
     */
    descripcion?: ReactNode;
}

export function NuevoInsumoDialog({ open, onClose, onCreado, tipoInicial, descripcionInicial, descripcion }: NuevoInsumoDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
                // Que un Escape o un Enter de acá adentro no le lleguen al modal de la OT
                // por el árbol de React (los portales burbujean por ahí): el Escape de este
                // diálogo lo atiende Radix y cierra sólo esta capa.
                onKeyDown={(e) => e.stopPropagation()}
            >
                <DialogHeader className="shrink-0 border-b border-gray-100 px-5 py-3 text-left">
                    <DialogTitle className="text-base">Nuevo insumo</DialogTitle>
                    <DialogDescription className="text-xs">
                        {descripcion ?? (
                            <>
                                Queda en el catálogo de materia prima y elegido para esta OT. El código y la
                                descripción se arman solos con la regla del sistema viejo.
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {open && (
                        <FormularioInsumo
                            ficha={null}
                            edita
                            autoFocus
                            tipoInicial={tipoInicial}
                            descripcionInicial={descripcionInicial}
                            permitirOtro={false}
                            onCancelar={onClose}
                            onGuardado={(insumo) => {
                                onCreado(insumo);
                                onClose();
                            }}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default NuevoInsumoDialog;
