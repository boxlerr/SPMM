"use client";

import { useEffect, useState } from "react";
import { FileClock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import {
    BorradorPlan,
    BorradorResumen,
    antiguedadTexto,
    borrarBorrador,
    estaViejo,
    listarBorradores,
    obtenerBorrador,
} from "@/lib/borradorPlan";

/**
 * "Retomar borrador": los planes calculados y todavía sin confirmar.
 *
 * Existe porque el cálculo es caro —con 34 OTs son varios minutos— y hasta ahora
 * cerrar la vista previa lo tiraba entero, junto con cada retoque hecho a mano.
 *
 * El botón no aparece si no hay nada guardado: un botón que casi siempre abre una
 * lista vacía enseña a ignorarlo.
 */

/** Cómo arma el backend el `nombre_usuario` al guardar (ver PlanificacionAPI). */
function nombreCompleto(u: { nombre?: string; apellido?: string; username?: string } | null): string {
    if (!u) return "";
    return [u.nombre, u.apellido].filter(Boolean).join(" ") || u.username || "";
}

/**
 * Si el borrador lo dejó otro.
 *
 * Por id cuando se puede, que es lo exacto. El nombre es el plan B para las filas
 * viejas que se guardaron sin `id_usuario`, y ante la duda devuelve `false`: es
 * peor acusar a alguien de dueño de un plan que no es suyo que no avisar.
 */
function esAjeno(
    b: BorradorResumen,
    usuario: { id_usuario?: number; nombre?: string; apellido?: string; username?: string } | null,
): boolean {
    if (!usuario) return false;
    if (b.id_usuario != null && usuario.id_usuario != null) return b.id_usuario !== usuario.id_usuario;
    if (!b.nombre_usuario) return false;
    return b.nombre_usuario.trim().toLowerCase() !== nombreCompleto(usuario).trim().toLowerCase();
}

export function BorradoresPlan({
    onAbrir,
    refrescar = 0,
}: {
    onAbrir: (borrador: BorradorPlan) => void;
    /** Cambiá este número para que vuelva a pedir la lista. */
    refrescar?: number;
}) {
    const { user } = useAuth();
    const [borradores, setBorradores] = useState<BorradorResumen[]>([]);
    const [abierto, setAbierto] = useState(false);
    const [cargando, setCargando] = useState<number | null>(null);
    /** El borrador cuya X se tocó: la fila pasa a mostrar qué se pierde. */
    const [confirmando, setConfirmando] = useState<number | null>(null);
    const [borrando, setBorrando] = useState(false);
    const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

    useEffect(() => {
        let vigente = true;
        listarBorradores().then(bs => { if (vigente) setBorradores(bs); });
        return () => { vigente = false; };
    }, [refrescar, abierto]);

    // Cerrar el popover cancela la pregunta: al volver a abrirlo la lista tiene que
    // estar como siempre, y no con una fila a medio borrar de hace media hora.
    useEffect(() => {
        if (!abierto) {
            setConfirmando(null);
            setErrorBorrar(null);
            setBorrando(false);
        }
    }, [abierto]);

    if (borradores.length === 0) return null;

    const abrir = async (id: number) => {
        setCargando(id);
        const b = await obtenerBorrador(id);
        setCargando(null);
        if (!b) {
            // Se lo llevó otro: sacarlo de la lista en vez de dejar una fila que no
            // hace nada al tocarla.
            setBorradores(bs => bs.filter(x => x.id !== id));
            return;
        }
        setAbierto(false);
        onAbrir(b);
    };

    const preguntar = (id: number) => {
        setConfirmando(id);
        setErrorBorrar(null);
    };

    const eliminar = async (id: number) => {
        setBorrando(true);
        setErrorBorrar(null);
        const ok = await borrarBorrador(id);
        setBorrando(false);
        if (!ok) {
            // Antes esto era un no-op mudo: el click no hacía nada visible y la
            // conclusión razonable era que la lista no se podía limpiar. Si falla,
            // que se vea y se pueda reintentar.
            setErrorBorrar("No se pudo borrar. Fijate la conexión y probá de nuevo.");
            return;
        }
        setConfirmando(null);
        setBorradores(bs => bs.filter(x => x.id !== id));
    };

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 text-xs">
                    <FileClock className="h-4 w-4 text-amber-600" />
                    Retomar borrador
                    <span className="rounded bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-700">
                        {borradores.length}
                    </span>
                </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-[26rem] p-0">
                <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">Planes sin confirmar</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Se abren sin recalcular, con los cambios que hayas hecho a mano.
                    </p>
                </div>

                <div className="max-h-80 overflow-auto">
                    {borradores.map(b => {
                        const viejo = estaViejo(b.actualizado_en);
                        const ajeno = esAjeno(b, user);
                        const ots = `${b.cantidad_ots} ${b.cantidad_ots === 1 ? "orden" : "órdenes"}`;

                        // Preguntando: la fila se convierte en el aviso. Dice qué se
                        // pierde —cuántas OTs, de quién, de cuándo— y deja seguir.
                        // Avisar no es frenar: el botón borra igual.
                        if (confirmando === b.id) {
                            return (
                                <div key={b.id} className="border-b bg-red-50/40 px-4 py-3 last:border-b-0">
                                    <p className="text-sm font-semibold text-slate-800">
                                        ¿Borrar este borrador?
                                    </p>
                                    <p className="mt-1 text-xs leading-snug text-slate-600">
                                        Se pierde el plan de {ots} y {b.cantidad_procesos} procesos, con
                                        los retoques que se le hayan hecho a mano. Se tocó por última vez{" "}
                                        {antiguedadTexto(b.actualizado_en) || "hace un rato"}. No se puede
                                        deshacer, pero se puede volver a calcular.
                                    </p>
                                    {ajeno && (
                                        <p className="mt-1.5 text-xs font-medium leading-snug text-amber-700">
                                            Ojo: este borrador no es tuyo, lo dejó{" "}
                                            {b.nombre_usuario || "otra persona"}.
                                        </p>
                                    )}
                                    {errorBorrar && (
                                        <p className="mt-1.5 text-xs font-medium leading-snug text-red-600">
                                            {errorBorrar}
                                        </p>
                                    )}
                                    <div className="mt-2.5 flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            className="h-7 text-xs"
                                            disabled={borrando}
                                            onClick={() => eliminar(b.id)}
                                        >
                                            {borrando ? "Borrando…" : "Eliminar igual"}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs"
                                            disabled={borrando}
                                            onClick={() => { setConfirmando(null); setErrorBorrar(null); }}
                                        >
                                            Cancelar
                                        </Button>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={b.id} className="flex items-start border-b last:border-b-0 hover:bg-slate-50">
                                {/* Dos botones hermanos y no uno adentro del otro: un
                                    botón anidado es HTML inválido y además la X queda
                                    fuera del tab, que es como no existir para el teclado. */}
                                <button
                                    onClick={() => abrir(b.id)}
                                    disabled={cargando === b.id}
                                    className="min-w-0 flex-1 px-4 py-3 text-left disabled:opacity-60"
                                >
                                    <p className="text-sm font-medium text-slate-800">
                                        {ots}
                                        <span className="font-normal text-slate-500">
                                            {" · "}{b.cantidad_procesos} procesos
                                        </span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {antiguedadTexto(b.actualizado_en)}
                                        {b.nombre_usuario ? ` · ${b.nombre_usuario}` : ""}
                                    </p>
                                    {viejo && (
                                        <p className="mt-1 text-[11px] leading-snug text-amber-700">
                                            Puede haber quedado viejo: desde entonces pudieron cambiar
                                            OTs, rangos o habilidades. Se abre igual y podés recalcular.
                                        </p>
                                    )}
                                </button>
                                {/* Siempre visible: mientras sólo aparecía al pasar el
                                    mouse, la conclusión era que la lista no se podía
                                    limpiar. */}
                                <button
                                    type="button"
                                    onClick={() => preguntar(b.id)}
                                    title="Borrar este borrador"
                                    aria-label={`Borrar el borrador de ${ots}`}
                                    className="mr-2 mt-2.5 rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
