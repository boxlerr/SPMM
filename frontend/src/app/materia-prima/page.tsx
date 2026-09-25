"use client";

/**
 * Materia prima: el catálogo de insumos, las compras de la semana y la cañera.
 *
 * Nace de la reunión del 23/09/2026 con Lucas: la gestión de materias primas pasa del
 * sistema viejo a SPMM (el viejo queda sólo para facturas y remitos). Hasta ese día
 * todo esto se hacía allá y SPMM sólo miraba lo que traía el sync: la solapa de la OT
 * era de sólo lectura con un cartel de «se cargan en el sistema viejo», y la única
 * pantalla de piezas era una solapa de Operaciones para el stock mínimo.
 *
 * Tres solapas, una por persona y por pregunta:
 *
 *   · Pendientes — la pantalla de Maxi: qué material falta para las OT de la semana
 *     (las que el planificador pone a trabajar), qué ya está pedido, qué llegó. Es la
 *     que se abre por defecto: es la que se usa todos los días.
 *   · Insumos    — el catálogo: la ficha de cada insumo con su stock (la suma de sus
 *     movimientos), recortes, en qué OT se usó y sus precios. Acá quedó también el
 *     punto crítico (stock mínimo, RF-14) que antes estaba en Operaciones.
 *   · Cañera     — los estantes A..O × 1..9 donde se deja el material cortado de cada OT.
 *
 * Las solapas se montan la primera vez que se abren y después quedan montadas (ocultas):
 * ir a la cañera y volver no hace perder la semana elegida ni los filtros de Pendientes,
 * y hasta que alguien abre una no pide nada (el patrón de Auditoría).
 *
 * Se llega también por enlace (ver `EnlaceMateriaPrima`): la campanita de stock bajo
 * abre la ficha del insumo, la OT abre Pendientes filtrado por ella y la vieja dirección
 * de la solapa de Operaciones redirige acá.
 *
 * Edita quien puede escribir la sección «Materia prima» de Operaciones; el resto la ve
 * entera en sólo lectura. Es la MISMA sección que protegía la solapa vieja, a propósito:
 * no hizo falta tocar roles ni permisos para mudarla.
 *
 * PRUEBA PILOTO (24/09): mientras el dueño de las materias primas sea el Sistema
 * Integral (`dueno = "integral"` en los catálogos), NADA se guarda, tenga el permiso que
 * tenga: todo se ve con las marcas que trae el sync, hay un cartel arriba que lo dice y
 * lo que se ve se refresca solo. Ver ModoEspejo.tsx. Desde el 25/09 quien PUEDE escribir
 * la sección la usa en MODO PRÁCTICA (Julián: «que lo habilites para ver cómo está
 * adentro… pero al final no me deje guardarlo con un cartelito»): las solapas le llegan
 * editables, el chip de la cabecera dice «Modo práctica» y cada guardado lo frena el
 * candado de `mpFetch` con su cartelito. El resto sigue en «Solo lectura».
 *
 * EL BOTÓN «NUEVO» (25/09)
 *
 * A la izquierda del chip, para quien puede escribir (también en modo práctica): las
 * cargas del sistema viejo a un clic —materia prima de una OT, pedido a proveedor,
 * insumo, movimiento de stock, recorte—, cada una en un diálogo sobre la solapa que se
 * esté mirando. Ver NuevoMenu.tsx.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Boxes } from "lucide-react";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ScrollableTabsBar } from "@/components/planning/ScrollableTabsBar";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";
import { usePermisos } from "@/hooks/usePermisos";
import { CartelEspejo, MarcaEspejo, useDuenoMP, useModoMP } from "./_components/ModoEspejo";
import { BotonNuevo } from "./_components/NuevoMenu";
import { MarcaPractica } from "./_components/NuevoComun";
import { PendientesTab } from "./_components/PendientesTab";
import { InsumosTab } from "./_components/InsumosTab";
import { CaneraTab } from "./_components/CaneraTab";

type Solapa = "pendientes" | "insumos" | "canera";

const SOLAPAS: { valor: Solapa; rotulo: string }[] = [
    { valor: "pendientes", rotulo: "Pendientes" },
    { valor: "insumos", rotulo: "Insumos" },
    { valor: "canera", rotulo: "Cañera" },
];

const esSolapa = (v: string | null): v is Solapa => v === "pendientes" || v === "insumos" || v === "canera";

/** Cada solapa: una píldora, como las de Auditoría (misma barra deslizable). */
const SOLAPA =
    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 " +
    "data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm " +
    "data-[state=active]:ring-1 data-[state=active]:ring-black/5";

/** Lo que pidió un enlace. Cada uno lleva su número: dos enlaces iguales seguidos son dos pedidos. */
type Pedido = {
    solapa: Solapa | null;
    pieza: number | null;
    ot: number | null;
    nuevo: boolean;
};

const numeroPositivo = (v: string | null): number | null => {
    const n = Number(v);
    return v !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Lee `?tab=pendientes|insumos|canera`, `?pieza=ID`, `?ot=N` y `?nuevo=1`, se los pasa
 * a la página y los borra de la dirección.
 *
 * Componente aparte y dentro de <Suspense> por lo mismo que `EnlaceMateriaPrima` de
 * Operaciones: `useSearchParams` fuera de un Suspense rompe el build estático de
 * Next 15, y leyéndolo una sola vez al montar el enlace no andaría estando ya acá (la
 * campanita cambia la dirección sin volver a montar la página). Se borran después de
 * leerlos para que un refresh no vuelva a saltar a la pieza.
 *
 * Avisa SIEMPRE la primera vez, aunque no haya parámetros: la página espera ese primer
 * aviso para montar la solapa que corresponde, así un enlace a Insumos no pide primero
 * los pendientes de la semana para nada.
 */
function EnlaceMateriaPrima({ onPedido }: { onPedido: (p: Pedido | null) => void }) {
    const params = useSearchParams();
    const tab = params.get("tab");
    const pieza = params.get("pieza");
    const ot = params.get("ot");
    const nuevo = params.get("nuevo");
    useEffect(() => {
        if (!tab && !pieza && !ot && !nuevo) {
            onPedido(null);
            return;
        }
        onPedido({
            solapa: esSolapa(tab) ? tab : null,
            pieza: numeroPositivo(pieza),
            ot: numeroPositivo(ot),
            nuevo: nuevo === "1" || nuevo === "true",
        });
        const url = new URL(window.location.href);
        for (const p of ["tab", "pieza", "ot", "nuevo"]) url.searchParams.delete(p);
        window.history.replaceState({}, "", url.toString());
        // `onPedido` es estable (useCallback), pero lo que dispara es el parámetro.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, pieza, ot, nuevo]);
    return null;
}

export default function MateriaPrimaPage() {
    const { puedeSeccion } = usePermisos();
    const puedeEscribir = puedeSeccion("operaciones_materia_prima", "write");
    // Con el Integral como dueño (prueba piloto) nada se guarda, pero quien puede escribir
    // la sección la recorre entera en MODO PRÁCTICA: le llega editable y el candado de
    // `mpFetch` frena cada guardado con su cartelito. Mientras no se sabe quién es el
    // dueño, nadie edita (es un instante: ver ModoEspejo.tsx).
    const { espejo, aviso } = useDuenoMP();
    const modo = useModoMP(puedeEscribir);
    const edita = modo !== "lectura";
    const practica = modo === "practica";

    const [solapa, setSolapa] = useState<Solapa>("pendientes");
    /** Hasta que el enlace no se leyó una vez no se monta ninguna solapa (ver EnlaceMateriaPrima). */
    const [leido, setLeido] = useState(false);
    const [montadas, setMontadas] = useState<Solapa[]>([]);

    // Lo que le llega a cada solapa desde un enlace. `n*` cambia con cada enlace y es la
    // llave de la solapa: la vuelve a montar con el pedido nuevo, aunque sea la misma
    // pieza de recién (tocar dos veces el mismo aviso de la campanita tiene que abrirla
    // las dos veces). Sin enlaces, la llave no cambia y la solapa conserva lo suyo.
    const [piezaInicial, setPiezaInicial] = useState<number | null>(null);
    const [nuevoInicial, setNuevoInicial] = useState(false);
    const [nInsumos, setNInsumos] = useState(0);
    const [otInicial, setOtInicial] = useState<number | null>(null);
    const [nPendientes, setNPendientes] = useState(0);
    /** Cuántos enlaces se siguieron: cierra el diálogo de «Nuevo» que esté abierto (ver BotonNuevo). */
    const [nEnlaces, setNEnlaces] = useState(0);

    const alPedido = useCallback((p: Pedido | null) => {
        setLeido(true);
        if (!p) return;
        setNEnlaces((n) => n + 1);
        // La solapa: la que dice el enlace o, si no dice, la que se deduce de lo que pide.
        const destino: Solapa | null =
            p.solapa ?? (p.pieza !== null || p.nuevo ? "insumos" : p.ot !== null ? "pendientes" : null);
        if (!destino) return;
        setSolapa(destino);
        if (destino === "insumos" && (p.pieza !== null || p.nuevo)) {
            setPiezaInicial(p.pieza);
            setNuevoInicial(p.nuevo);
            setNInsumos((n) => n + 1);
        }
        if (destino === "pendientes" && p.ot !== null) {
            setOtInicial(p.ot);
            setNPendientes((n) => n + 1);
        }
    }, []);

    useEffect(() => {
        if (leido && !montadas.includes(solapa)) setMontadas((m) => [...m, solapa]);
    }, [leido, solapa, montadas]);
    const montar = (s: Solapa) => leido && (solapa === s || montadas.includes(s));

    return (
        // El marco es el de Operaciones: `min-h` y no `h`, así la página scrollea de una
        // sola manera y lo que tiene que quedar a la vista se resuelve con `sticky`.
        <div className="min-h-[calc(100svh-2*var(--pad-app,1.5rem))] w-full flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm">
            <Suspense fallback={null}>
                <EnlaceMateriaPrima onPedido={alPedido} />
            </Suspense>

            <Tabs value={solapa} onValueChange={(v) => esSolapa(v) && setSolapa(v)} className="flex flex-1 flex-col">
                {/* Cabecera fija, como la de Operaciones. z-30 para pasarle por encima a
                    los encabezados de las tablas (z-10/z-20). */}
                <div className="sticky top-0 z-30 bg-white rounded-t-xl border-b border-gray-200">
                    {/* `pr-16`: la campana de avisos es `fixed` arriba a la derecha. */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pl-3 sm:pl-4 pr-16 pt-3 pb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1.5 bg-gradient-to-br from-[#DC143C] to-[#B8112E] rounded-lg shadow-md shrink-0">
                                <Boxes className="h-5 w-5 text-white" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-xl lg:text-2xl font-bold text-gray-900 leading-tight">Materia prima</h1>
                                <p className="text-gray-500 text-xs truncate">Insumos, compras por semana y cañera</p>
                            </div>
                        </div>
                        {/* El botón «Nuevo» y, a su derecha, el chip del estado: «Modo práctica»
                            (piloto, con permiso), «Solo lectura» (sin permiso) o nada (SPMM dueño
                            y con permiso). */}
                        {(edita || espejo || !puedeEscribir) && (
                            <div className="flex items-center gap-2">
                                {edita && <BotonNuevo practica={practica} cerrarCon={nEnlaces} />}
                                {practica ? (
                                    <MarcaPractica />
                                ) : espejo ? (
                                    <MarcaEspejo aviso={aviso} practica={false} />
                                ) : (
                                    !puedeEscribir && <MarcaSoloLectura que="los insumos, las compras y la cañera" />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="px-2 sm:px-3 pb-2">
                        <ScrollableTabsBar className="rounded-full bg-gray-100/90 p-1 ring-1 ring-black/[0.03]">
                            {SOLAPAS.map((s) => (
                                <TabsTrigger key={s.valor} value={s.valor} className={SOLAPA}>
                                    {s.rotulo}
                                </TabsTrigger>
                            ))}
                        </ScrollableTabsBar>
                    </div>
                </div>

                {/* `forceMount` + `hidden` cuando no están a la vista: ver `montadas`. */}
                <div className="flex-1 min-w-0 flex flex-col px-3 pt-3 pb-6 sm:px-4">
                    {/* Fuera de la cabecera fija a propósito: se lee al entrar y después se
                        va con el scroll, sin comerle alto a la tabla de Pendientes. */}
                    {espejo && <CartelEspejo aviso={aviso} className="mb-3" />}
                    {montar("pendientes") && (
                        <TabsContent value="pendientes" forceMount className="mt-0 data-[state=inactive]:hidden">
                            <PendientesTab
                                key={`pendientes-${nPendientes}`}
                                edita={edita}
                                otInicial={otInicial}
                                espejo={espejo}
                                activo={solapa === "pendientes"}
                            />
                        </TabsContent>
                    )}
                    {montar("insumos") && (
                        <TabsContent value="insumos" forceMount className="mt-0 data-[state=inactive]:hidden">
                            <InsumosTab
                                key={`insumos-${nInsumos}`}
                                edita={edita}
                                piezaInicial={piezaInicial}
                                nuevoInicial={nuevoInicial}
                            />
                        </TabsContent>
                    )}
                    {montar("canera") && (
                        <TabsContent value="canera" forceMount className="mt-0 data-[state=inactive]:hidden">
                            <CaneraTab edita={edita} espejo={espejo} activo={solapa === "canera"} />
                        </TabsContent>
                    )}
                </div>
            </Tabs>
        </div>
    );
}
