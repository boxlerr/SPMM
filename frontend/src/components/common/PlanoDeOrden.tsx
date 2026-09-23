import React from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { API_URL } from "@/config";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileViewerModal, type ArchivoVisible } from "@/components/common/FileViewerModal";
import {
    estadoPlano,
    useOrdenesConPlano,
    usePlanosDisponibles,
    type EstadoPlano,
} from "@/hooks/useOrdenesConPlano";

/**
 * La celda "Plano" de cualquier lista de OTs: dice qué hay y, si hay algo, lo abre.
 *
 * Antes esta columna decía "Sin archivo" o "No" en TODAS las filas. No era un error de
 * pintura: se calculaba con el conjunto de OT que tienen un plano pegado a la orden, y
 * en producción no hay ninguna —los más de mil planos cargados cuelgan del artículo—.
 * O sea que la pantalla negaba un plano que estaba ahí, a un click de distancia, y el
 * que planifica lo iba a buscar por otro lado.
 *
 * Ahora se muestra el plano venga de donde venga, y se puede abrir sin salir de la
 * tabla: se planifica mirando la lista, y tener que entrar a la ficha de la OT por cada
 * plano era el ida y vuelta que hacía que nadie lo mirara.
 */

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Cómo se ve y qué explica cada estado. */
const PINTA: Record<EstadoPlano, { texto: string; corto: string; clase: string; title: string }> = {
    adjunto: {
        texto: "Sí",
        corto: "Sí",
        clase: "bg-green-50 text-green-700 border-green-200",
        title: "Esta OT tiene su propio plano cargado. Tocá para verlo.",
    },
    del_producto: {
        texto: "Del producto",
        corto: "Producto",
        clase: "bg-indigo-50 text-indigo-700 border-indigo-200",
        title:
            "El plano no está cargado en la OT: es el del producto que fabrica, y sirve igual para trabajar. Tocá para verlo.",
    },
    // Se ve IGUAL que `sin_plano` a propósito: la diferencia era una marca del sistema
    // viejo y en pantalla se leían como dos cosas distintas ("Sin archivo" y "No") sin
    // que nadie supiera por qué. Para el que trabaja las dos significan lo mismo.
    marcado_sin_archivo: {
        texto: "Sin plano",
        corto: "Sin plano",
        clase: "bg-gray-100 text-gray-500 border-gray-300",
        // Ojo: este texto se completa abajo según si se pudo preguntar por el plano del
        // producto o no. Afirmar "ni del producto" cuando no se preguntó es justo la
        // mentira que este cambio vino a sacar.
        title: "No hay ningún plano ni foto para mirar en esta orden.",
    },
    sin_plano: {
        texto: "Sin plano",
        corto: "Sin plano",
        clase: "bg-gray-100 text-gray-500 border-gray-300",
        title: "No hay ningún plano ni foto para mirar en esta orden.",
    },
};

interface PlanoDeOrdenProps {
    ordenId: number;
    /** La bandera `tiene_plano` del legacy, tal como viene en la fila. */
    tienePlano?: unknown;
    className?: string;
    /** En las tablas apretadas el rótulo largo no entra. */
    compacto?: boolean;
}

export const PlanoDeOrden = ({ ordenId, tienePlano, className, compacto }: PlanoDeOrdenProps) => {
    // Las dos preguntas por separado, a propósito. `usePlanosDisponibles` es lo que se
    // muestra; `useOrdenesConPlano` es lo que el planificador usa para restringir, y acá
    // entra solo como red: mientras el backend nuevo no esté deployado (sale a mano,
    // contra un front que sale por Vercel) devuelve `null`, y sin esta segunda respuesta
    // la columna volvería a inventar "Sí" a partir de la bandera del legacy.
    const disponibles = usePlanosDisponibles();
    const conPlano = useOrdenesConPlano();
    const estado = estadoPlano(ordenId, tienePlano, conPlano, disponibles);

    const [planos, setPlanos] = React.useState<ArchivoVisible[] | null>(null);
    const [cargando, setCargando] = React.useState(false);
    const [abierto, setAbierto] = React.useState(false);
    const [indice, setIndice] = React.useState(0);

    const pinta = PINTA[estado];
    const seAbre = estado === "adjunto" || estado === "del_producto";

    // QUÉ hay y CUÁNTO, no solo de dónde viene.
    //
    // Julián: "sigo viendo producto solamente en la columna de plano (…) que muestre la
    // cantidad de fotos que hay". "Del producto" dice de dónde sale el archivo pero no si
    // es el DIBUJO o una foto de la pieza, y sin el número no se sabe si vale la pena
    // abrir. De las 198 órdenes que muestran algo: 130 tienen solo dibujo, 46 solo fotos
    // y 22 las dos cosas.
    const cuenta = disponibles?.porOrden.get(ordenId) ?? null;

    /** "Plano", "2 planos", "15 fotos", "Plano + 3 fotos". */
    const rotularCuenta = (c: { planos: number; fotos: number }, corto: boolean): string => {
        const p = c.planos === 1 ? "Plano" : `${c.planos} planos`;
        const f = c.fotos === 1 ? "1 foto" : `${c.fotos} fotos`;
        if (c.planos && c.fotos) return corto ? `${c.planos}P · ${c.fotos}F` : `${p} + ${f}`;
        if (c.planos) return p;
        if (c.fotos) return f;
        return "";
    };

    const rotulo = seAbre && cuenta ? rotularCuenta(cuenta, false) : pinta.texto;
    const rotuloCorto = seAbre && cuenta ? rotularCuenta(cuenta, true) : pinta.corto;

    const deDonde =
        cuenta && cuenta.deLaOrden > 0 && cuenta.deLaOrden === cuenta.planos + cuenta.fotos
            ? "cargado en esta orden"
            : cuenta && cuenta.deLaOrden > 0
              ? "entre esta orden y el producto"
              : "del producto que fabrica";

    // El dibujo se destaca; las fotos solas van en gris apagado, que es lo que son: una
    // ayuda, no el plano.
    const claseSegunQueEs =
        !seAbre || !cuenta
            ? pinta.clase
            : cuenta.planos > 0
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "bg-slate-100 text-slate-600 border-slate-300";

    // Mientras el servidor no tenga la consulta nueva —pasa de verdad: el servidor se
    // actualiza a mano y la pantalla sale sola por Vercel— no se sabe nada de los planos
    // del producto, así que el cartel no puede decir que tampoco hay. Se dice lo que sí
    // se sabe, y se avisa que puede haber uno del producto.
    const explicacion =
        seAbre && cuenta
            ? cuenta.planos > 0
                ? `${rotulo}, ${deDonde}. Tocá para verlo.`
                : `No hay plano: lo que hay son ${rotulo.toLowerCase()} de la pieza, ${deDonde}. Tocá para verlas.`
        : estado === "marcado_sin_archivo"
            ? disponibles
                ? "La OT figura con plano pero no hay ningún archivo, ni suyo ni del producto. No hay nada para abrir."
                : "La OT figura con plano pero no tiene ningún archivo cargado en la orden. Todavía no se pudo averiguar si el producto tiene el suyo."
            : pinta.title;

    // La lista de archivos NO se pide al dibujar la fila: son cientos de filas en la
    // misma pantalla y serían cientos de pedidos para algo que casi nunca se abre. Se
    // pide recién cuando la tocan, y queda guardada por si la vuelven a abrir.
    const abrir = async (e: React.MouseEvent) => {
        // Estas filas ya tienen su propio onClick, que abre la ficha de la OT. Sin esto,
        // tocar el plano abriría las dos cosas y el visor quedaría tapado.
        e.stopPropagation();
        if (!seAbre || cargando) return;

        if (planos) {
            setIndice(0);
            setAbierto(true);
            return;
        }

        setCargando(true);
        try {
            const res = await fetch(`${API_URL}/planos/orden/${ordenId}`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`error ${res.status}`);

            const json = await res.json();
            const lista: ArchivoVisible[] = Array.isArray(json?.data) ? json.data : [];

            if (lista.length === 0) {
                // Puede pasar: el cartelito se dibujó con una respuesta de hace un rato y
                // mientras tanto borraron el archivo (los conjuntos de OT quedan
                // cacheados a nivel de módulo y no se vuelven a pedir solos). Se avisa en
                // vez de abrir un visor vacío, que parece que se rompió.
                //
                // Y NO se guarda la lista vacía: guardarla dejaba el botón muerto para
                // siempre —el próximo click entraba por el atajo de "ya la tengo", no
                // dibujaba nada y no avisaba nada—. Dejándola en null, el que vuelve a
                // tocar al menos vuelve a preguntar.
                toast.info("Esta OT no tiene ningún plano para mostrar.");
                return;
            }

            setPlanos(lista);
            setIndice(0);
            setAbierto(true);
        } catch (err) {
            console.error("No se pudieron traer los planos de la OT", err);
            toast.error("No se pudieron cargar los planos de esta OT.");
        } finally {
            setCargando(false);
        }
    };

    const clases = cn(
        claseSegunQueEs,
        "font-semibold",
        seAbre && "cursor-pointer hover:brightness-95 transition",
        className
    );

    const etiqueta = compacto ? rotuloCorto : rotulo;

    if (!seAbre) {
        return (
            <Badge variant="outline" className={cn(clases, "cursor-help")} title={explicacion}>
                {etiqueta}
            </Badge>
        );
    }

    return (
        <>
            <Badge variant="outline" className={clases} asChild>
                <button
                    type="button"
                    onClick={abrir}
                    disabled={cargando}
                    aria-busy={cargando}
                    title={cargando ? "Buscando los planos de la OT…" : explicacion}
                >
                    {cargando ? (
                        <Loader2 className="animate-spin" />
                    ) : (
                        <Eye />
                    )}
                    {etiqueta}
                </button>
            </Badge>

            {/* El visor se dibuja acá adentro, y eso tiene una trampa: Radix lo manda al
                body con un portal, pero React propaga los eventos por el ÁRBOL DE
                COMPONENTES, no por el DOM. O sea que un click en las flechas, en el zoom,
                en Imprimir o en el fondo para cerrar seguía subiendo hasta el onClick de
                la fila de atrás —que abre la ficha de la OT— y hasta su onDoubleClick, que
                abre la edición. Cerrar el visor terminaba abriendo el modal de editar la
                orden. Se corta acá, en el borde del portal. */}
            {planos && planos.length > 0 && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                <FileViewerModal
                    file={planos[indice] ?? planos[0]}
                    isOpen={abierto}
                    onClose={() => setAbierto(false)}
                    // Se le pasa la lista entera y la posición: con las flechas se pasa
                    // de un plano al otro sin cerrar, que es como se mira una OT que
                    // tiene el plano del producto más un croquis del taller.
                    planos={planos}
                    indice={indice}
                    onIndiceChange={setIndice}
                />
                </div>
            )}
        </>
    );
};
