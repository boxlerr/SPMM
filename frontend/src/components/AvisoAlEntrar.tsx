"use client";

/**
 * El cartel que sale al entrar después de un cambio grande.
 *
 * Por qué existe: la semana del 11 al 15/09/2026 el taller frenó el uso del sistema
 * porque los procesos se le veían desordenados. Avisar eso por WhatsApp no alcanza —
 * el que abre el sistema el lunes a la mañana no leyó el grupo, y encima el que más
 * lo necesita (el que carga órdenes todo el día) es el que menos mira el teléfono.
 *
 * Reglas del cartel, para que no se vuelva un estorbo:
 *  · Sale SOLO una vez por persona y por aviso. Se cierra y no vuelve a saltar; el que
 *    lo quiere ver de nuevo lo abre con el megáfono del menú (BotonAviso), que tiene un
 *    puntito mientras no se haya leído. Qué cuenta como leído y dónde se guarda:
 *    hooks/useAvisoAlEntrar.ts, que es el estado que comparten los dos.
 *  · Lo que decide si ya se vio es el `id` del aviso, no la fecha: cambiar el texto
 *    sin cambiar el id no se lo muestra a nadie que ya lo haya cerrado.
 *  · No sale en el login, ni antes de que la sesión esté cargada.
 *  · Si el navegador no deja guardar (modo privado, permisos), el cartel NO se
 *    muestra: es preferible que alguien se pierda un aviso a que le salga todos los
 *    días y termine cerrándolo sin leer.
 *  · Se cierra con Escape o clickeando afuera, como cualquier ventana del sistema.
 *
 * El texto vive en lib/novedades.ts, al lado de las novedades, para que no haya dos
 * lugares donde contar lo mismo.
 */

import { useEffect } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AVISO_AL_ENTRAR, formatFechaNovedad } from "@/lib/novedades";
import { abrirAviso, cerrarAviso, tocaAbrirseSolo, useAvisoAlEntrar } from "@/hooks/useAvisoAlEntrar";

/** **negrita** -> <strong>. Lo único que se acepta: el texto lo escribe el equipo. */
function conNegritas(texto: string) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) =>
        trozo.startsWith("**") && trozo.endsWith("**")
            ? <strong key={i} className="font-semibold text-gray-900">{trozo.slice(2, -2)}</strong>
            : <span key={i}>{trozo}</span>
    );
}

export default function AvisoAlEntrar() {
    const { abierto } = useAvisoAlEntrar();
    const aviso = AVISO_AL_ENTRAR;

    useEffect(() => {
        // Si el navegador no deja leer, no se abre solo: ver la cabecera.
        if (!tocaAbrirseSolo()) return;
        // Un respiro antes de abrirlo: el sidebar tarda en montar y corre la página,
        // y un cartel que aparece encima de algo que se está acomodando se cierra
        // sin leer.
        const t = setTimeout(abrirAviso, 600);
        return () => clearTimeout(t);
    }, []);

    /*
     * Se marca como visto al CERRARLO, no al mostrarlo (lo hace `cerrarAviso`).
     *
     * Al revés parece más simple y está mal: si se anota antes, cualquier cosa que
     * desmonte el componente entre el "anotado" y el "mostrado" se come el aviso para
     * siempre. Pasa de verdad — en desarrollo React monta, desmonta y vuelve a montar,
     * y el cartel no salía nunca. Y aun sin eso, si alguien cierra la pestaña mientras
     * carga, el aviso se perdía sin haberse visto. Anotarlo al cerrar hace que el peor
     * caso sea verlo dos veces, que no le arruina el día a nadie.
     *
     * Cómo se cierra importa para el puntito del megáfono: los dos botones de abajo
     * cuentan como leído; la cruz, Escape o el click afuera, sólo si estuvo abierto un
     * rato (ver hooks/useAvisoAlEntrar.ts).
     */

    if (!aviso) return null;

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) cerrarAviso("afuera"); }}>
            <DialogContent className="max-w-[min(680px,94vw)] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-5 pb-4 border-b border-gray-100">
                    <DialogTitle className="flex items-center gap-3 text-xl font-bold text-gray-900">
                        <span className="p-2 bg-red-100 rounded-lg shrink-0">
                            <Sparkles className="w-5 h-5 text-red-600" />
                        </span>
                        <span className="min-w-0">
                            {aviso.titulo}
                            <span className="block text-xs font-medium text-gray-400 mt-0.5">
                                {formatFechaNovedad(aviso.fecha)}
                            </span>
                        </span>
                    </DialogTitle>
                    <p className="text-sm text-gray-500 mt-2">{aviso.bajada}</p>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {aviso.bloques.map((b) => (
                        <section key={b.titulo}>
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
                                {b.titulo}
                            </h3>
                            <ul className="space-y-2.5">
                                {b.puntos.map((p, i) => (
                                    <li key={i} className="flex gap-2.5 text-sm text-gray-600 leading-relaxed">
                                        <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
                                        <span>{conNegritas(p)}</span>
                                    </li>
                                ))}
                            </ul>
                            {b.nota && (
                                <p className="mt-3 text-[13px] text-gray-500 bg-gray-50 border-l-2 border-gray-300 pl-3 py-2 rounded-r">
                                    {conNegritas(b.nota)}
                                </p>
                            )}
                        </section>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/60">
                    <Link
                        href="/novedades"
                        onClick={() => cerrarAviso("novedades")}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1.5"
                    >
                        Ver todas las novedades
                        <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Button onClick={() => cerrarAviso("entendido")} className="bg-red-600 hover:bg-red-700">
                        {aviso.cerrar}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
