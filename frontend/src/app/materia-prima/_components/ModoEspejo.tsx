"use client";

/**
 * El MODO ESPEJO de las materias primas: la prueba piloto con el Sistema Integral.
 *
 * POR QUÉ EXISTE
 *
 * El 24/09 Lucas pidió que la semana del 28/09 SPMM se pruebe EN PARALELO con el sistema
 * viejo («Sistema Integral»). Durante la prueba el Integral sigue siendo el dueño de todo,
 * materia prima incluida: Carolina y Maxi cargan allá, el sync lo trae con las marcas
 * reales (pedido, reserva, disponible…) y SPMM lo MUESTRA. Recién después de la prueba
 * SPMM pasa a ser el dueño (la sección editable que se armó para eso).
 *
 * Si durante la prueba se GUARDARA algo acá, duraría hasta la próxima pasada del sync
 * (que lo pisa con lo del Integral) y, mientras tanto, habría dos verdades. Por eso con
 * el dueño en «integral» no sale ninguna escritura (el candado de `mpFetch`, en
 * lib/materiaPrima.ts) y hay un cartel arriba que dice por qué y dónde se carga.
 *
 * MODO PRÁCTICA (25/09)
 *
 * Hasta el 25/09 eso además dejaba la sección en «Solo lectura». Ese día Julián pidió
 * poder recorrerla: «quiero que lo habilites para ver cómo está adentro o cómo es el
 * proceso de carga en pañol o en materia o lo que sea, todo completo, pero al final no
 * me deje guardarlo con un cartelito». Desde entonces hay tres modos (`useModoMP`):
 *
 *  · «dueno»    → SPMM es el dueño y se puede escribir: todo se guarda, como siempre.
 *  · «practica» → el dueño es el Integral y quien mira PUEDE escribir la sección: ve y
 *                 usa todo igual que con «dueno» (barras de carga, tildes, cortes,
 *                 cañera, stock…), pero cada guardado lo frena el candado y, en vez de
 *                 un error, sale SIEMPRE el mismo cartelito (`CartelitoPractica`): «Esto
 *                 no se guarda». Lo optimista vuelve a su lugar en silencio y los
 *                 formularios quedan abiertos con lo cargado, así se ve completo.
 *  · «lectura»  → no puede escribir (o todavía no se sabe quién es el dueño): sólo mira.
 *
 * El cartelito sale desde el candado (`frenarPorPractica`), no desde cada pantalla: así
 * no hay una pantalla que se olvide de avisar ni dos que avisen distinto. Cada pantalla
 * sólo tiene que tratar la respuesta `practica` (no toastear, deshacer, dejar abierto).
 *
 * QUIÉN LO DECIDE
 *
 * El backend, en `GET /materia-prima/catalogos` (`dueno` y `aviso_dueno`): pasar de la
 * prueba a la operación normal no pide un deploy del front. Se lee del MISMO almacén que
 * los catálogos (InsumoCatalogos.ts): un pedido para todas las pantallas, y cuando llega
 * prende también el candado de los pedidos de escritura (`fijarModoEspejoMP` en
 * lib/materiaPrima.ts).
 *
 *  · Mientras no llegó (`sabido = false`) nadie edita: es un instante (los catálogos se
 *    piden una vez por sesión) y es mejor que mostrar casillas que después se traban.
 *  · Si el backend no manda `dueno` (uno de antes de la prueba), o el pedido falla, es
 *    «spmm»: así andaba ese backend, y trabar la sección por un error de red la dejaría
 *    inservible después de la prueba. Un error se vuelve a probar solo cada tanto, así
 *    un tropiezo al entrar no deja la pantalla editable durante la prueba.
 *
 * «SE ACTUALIZAN SOLAS», CADA 10 MINUTOS
 *
 * Lo del Integral lo trae el sync cada 10 minutos (hasta el 25/09 eran 30): el cartel lo dice con esas palabras
 * (el texto es el del backend, `aviso_dueno`; el de la pantalla, `AVISO_ESPEJO`, dice lo
 * mismo), para que nadie espere verlo al instante y lo cargue dos veces. Lo que sí tiene
 * que ser cierto es que, cuando llega, se vea sin recargar: en modo espejo
 * `useRefrescoEspejo` vuelve a pedir lo que se ve cada 90 segundos (si la pestaña está a
 * la vista) y al volver a la pestaña. Sin spinner ni pantalla en blanco: los datos nuevos
 * reemplazan a los viejos cuando llegan. De paso se vuelven a pedir los catálogos, así al
 * terminar la prueba las pantallas abiertas se destraban solas.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, FlaskConical, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermisos } from "@/hooks/usePermisos";
import { AVISO_ESPEJO, escucharFrenosDePractica, type DuenoMP } from "@/lib/materiaPrima";
import { cargarCatalogos, useCatalogosMP } from "./InsumoCatalogos";

export interface EstadoDueno {
    /** Null = todavía no se sabe (los catálogos no llegaron). */
    dueno: DuenoMP | null;
    /** El dueño es el Integral: nada se guarda (práctica o sólo lectura), con el cartel. */
    espejo: boolean;
    /** Ya se sabe quién es el dueño. Mientras no, nadie edita. */
    sabido: boolean;
    /** El texto del cartel (el del backend, o el de la pantalla). */
    aviso: string;
}

/** Cada cuánto se vuelve a probar un pedido de catálogos que falló. */
const REINTENTO_MS = 15_000;

/**
 * Quién es el dueño de las materias primas. Usa (y si hace falta dispara) el pedido de
 * catálogos compartido: montarlo en varias pantallas a la vez no pide nada de más.
 */
export function useDuenoMP(): EstadoDueno {
    const { catalogos, error, sinServidor } = useCatalogosMP();
    const fallo = !catalogos && (!!error || sinServidor);

    // El pedido falló (y no porque falte la sección): se vuelve a probar solo.
    useEffect(() => {
        if (!fallo || sinServidor) return;
        const t = window.setInterval(() => void cargarCatalogos(), REINTENTO_MS);
        return () => window.clearInterval(t);
    }, [fallo, sinServidor]);

    const dueno: DuenoMP | null = catalogos ? catalogos.dueno : fallo ? "spmm" : null;
    return {
        dueno,
        espejo: dueno === "integral",
        sabido: dueno !== null,
        aviso: catalogos?.aviso_dueno ?? AVISO_ESPEJO,
    };
}

/** Cómo se usa la sección (ver el comentario de arriba). */
export type ModoMP = "dueno" | "practica" | "lectura";

/**
 * El modo de la sección para quien la mira: `edita = modo !== "lectura"` y, si es
 * «practica», el chip y el cartel lo dicen.
 *
 * `puedeEscribir` es el permiso de escribir Materia prima. Por defecto se lee de la
 * sesión (`operaciones_materia_prima` en «editar»); la solapa de la OT pasa el suyo,
 * que además pide poder crear la OT cuando es nueva.
 */
export function useModoMP(puedeEscribir?: boolean): ModoMP {
    const { puedeSeccion } = usePermisos();
    const { dueno } = useDuenoMP();
    const escribe = puedeEscribir ?? puedeSeccion("operaciones_materia_prima", "write");
    if (!escribe || dueno === null) return "lectura";
    return dueno === "integral" ? "practica" : "dueno";
}

/** Lo que el front le suma al cartel en modo práctica (el backend no sabe de pantallas). */
const AGREGADO_PRACTICA = "Acá podés recorrer la carga completa, pero no se guarda nada.";

/**
 * El texto del cartel en modo práctica: «Prueba piloto — modo práctica:» y lo que dice el
 * backend (dónde se carga y cada cuánto llega), sin el «Durante la prueba piloto» /
 * «Prueba piloto:» con que arranca (ya lo dice el título), más el agregado de acá.
 */
function textoPractica(aviso: string): { titulo: string; resto: string } {
    // Sin texto del backend (`AVISO_ESPEJO` es el de la pantalla, largo para un cartel que
    // ahora dice más cosas), el corto.
    let cuerpo = aviso === AVISO_ESPEJO
        ? ""
        : aviso.trim().replace(/^prueba piloto\s*:\s*/i, "").replace(/^durante la prueba piloto,?\s*/i, "");
    if (!cuerpo) cuerpo = "las materias primas se siguen cargando en el Sistema Integral y Metlosys las trae de ahí cada 10 minutos.";
    cuerpo = cuerpo.charAt(0).toLowerCase() + cuerpo.slice(1);
    if (!/[.!?]$/.test(cuerpo)) cuerpo += ".";
    return { titulo: "Prueba piloto — modo práctica:", resto: `${cuerpo} ${AGREGADO_PRACTICA}` };
}

/**
 * El cartel de arriba de la sección y de la solapa de la OT. Si el texto arranca con un
 * «algo:» (el «Prueba piloto:» de siempre), ese pedazo va en negrita.
 *
 * En modo práctica dice que se puede recorrer todo pero que no se guarda nada. `practica`
 * sin pasar = el modo de la sesión (`useModoMP`): así la cabecera de la sección no tiene
 * que saberlo. De paso monta el cartelito (ver `CartelitoPractica`): donde está este
 * cartel, puede frenarse un guardado.
 */
export function CartelEspejo({ aviso, className, practica }: { aviso: string; className?: string; practica?: boolean }) {
    const modo = useModoMP();
    const enPractica = practica ?? modo === "practica";
    let titulo: string | null;
    let resto: string;
    if (enPractica) {
        ({ titulo, resto } = textoPractica(aviso));
    } else {
        const dosPuntos = aviso.indexOf(":");
        titulo = dosPuntos > 0 && dosPuntos <= 40 ? aviso.slice(0, dosPuntos + 1) : null;
        resto = titulo ? aviso.slice(dosPuntos + 1).trim() : aviso;
    }
    return (
        <div
            role="status"
            className={cn(
                "flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-3 text-sm text-sky-950 sm:px-4",
                className,
            )}
        >
            <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-sky-200">
                {enPractica ? <FlaskConical className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </span>
            <p className="min-w-0 flex-1 leading-relaxed">
                {titulo && <b className="font-semibold text-sky-900">{titulo} </b>}
                {resto}
            </p>
            <CartelitoPractica />
        </div>
    );
}

/**
 * La marca chica del modo espejo, al lado del título. Es la hermana de
 * `MarcaSoloLectura`, pero ésa dice «pedíselo a un administrador» y acá no es un tema de
 * permisos. Para quien no puede escribir dice «Solo lectura»; en modo práctica, «Modo
 * práctica» (la misma píldora que la de los diálogos de «Nuevo», NuevoComun.tsx).
 * `practica` sin pasar = el modo de la sesión.
 */
export function MarcaEspejo({ aviso, practica }: { aviso: string; practica?: boolean }) {
    const modo = useModoMP();
    const enPractica = practica ?? modo === "practica";
    return (
        <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200"
            title={enPractica ? textoPractica(aviso).resto : aviso}
        >
            {enPractica ? <FlaskConical className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {enPractica ? "Modo práctica" : "Solo lectura"}
        </span>
    );
}

// ═══════════════════════════ el cartelito del modo práctica ═══════════════════════════

/**
 * Lo mínimo entre dos cartelitos. Un lote frena varias escrituras en el mismo instante y
 * las tildes de Pendientes se guardan solas, una por clic: sin esto serían un cartel por
 * pedido. Con esto, uno; y las tildes que se tocan enseguida vuelven a su lugar calladas.
 */
const ENTRE_CARTELES_MS = 600;

let cartelAbierto = false;
// Desde cuándo se cuenta la espera: desde que se CERRÓ el anterior. Contando desde que se
// abrió (2,5 s, hasta el 25/09), un segundo «Guardar» enseguida de «Entendido» no hacía
// nada y el botón parecía muerto. Mientras está abierto no se abre otro (cartelAbierto),
// así que un lote sigue dando un solo cartel.
let ultimoCartel = 0;
/** Los cartelitos montados. Dibuja sólo el primero: hay uno en cada solapa y en cada cartel. */
const lugares: number[] = [];
let proximoLugar = 1;
const oyentesCartel = new Set<() => void>();
const avisarCartel = () => oyentesCartel.forEach((o) => o());
const suscribirCartel = (o: () => void) => {
    oyentesCartel.add(o);
    return () => {
        oyentesCartel.delete(o);
    };
};

function abrirCartelito() {
    // Sin pantalla que lo dibuje no se abre: si no, aparecería más tarde, fuera de lugar.
    if (cartelAbierto || !lugares.length) return;
    const ahora = Date.now();
    if (ahora - ultimoCartel < ENTRE_CARTELES_MS) return;
    cartelAbierto = true;
    avisarCartel();
}

function cerrarCartelito() {
    if (!cartelAbierto) return;
    cartelAbierto = false;
    ultimoCartel = Date.now();
    avisarCartel();
}

// El candado (lib/materiaPrima.ts) avisa acá cada escritura que frena. Una vez, al cargar
// el módulo: lo importa toda pantalla de la sección (y la solapa de la OT).
if (typeof window !== "undefined") escucharFrenosDePractica(abrirCartelito);

/**
 * «Esto no se guarda»: el cartelito que sale cada vez que el modo práctica frena un
 * guardado. Es UNO para toda la app —el mismo texto en todas las pantallas— aunque se
 * monte en varios lugares (cada solapa, cada cartel de arriba): dibuja el primero que
 * sigue montado.
 *
 * Es un diálogo (Radix) para quedar arriba de todo, también del modal de la OT y de los
 * diálogos de cortes o de alta. Pero NO se lleva el foco: el foco queda donde estaba (el
 * campo o el globo que se estaba llenando). Si se lo llevara, los globos (el casillero de
 * la cañera, el alta de un proveedor, «Marcar pedido…») se cerrarían solos al perderlo, y
 * justamente lo que se quiere es que lo cargado quede a la vista. Por lo mismo, tocarlo
 * no mueve el foco (`onMouseDown`), Enter o Escape lo cierran sin llegarle al formulario
 * de atrás (que con Enter volvería a guardar y con Escape se cerraría).
 */
export function CartelitoPractica() {
    const [mio] = useState(() => proximoLugar++);
    useEffect(() => {
        lugares.push(mio);
        avisarCartel();
        return () => {
            const i = lugares.indexOf(mio);
            if (i >= 0) lugares.splice(i, 1);
            if (!lugares.length) cartelAbierto = false;
            avisarCartel();
        };
    }, [mio]);
    const abierto = useSyncExternalStore(suscribirCartel, () => cartelAbierto, () => false);
    const primero = useSyncExternalStore(suscribirCartel, () => lugares[0] ?? 0, () => 0);
    const dibuja = primero === mio;

    // Enter = «Entendido». En captura: que no le llegue al campo de atrás.
    useEffect(() => {
        if (!abierto || !dibuja) return;
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            cerrarCartelito();
        };
        document.addEventListener("keydown", alTeclear, { capture: true });
        return () => document.removeEventListener("keydown", alTeclear, { capture: true });
    }, [abierto, dibuja]);

    if (!dibuja) return null;
    return (
        <DialogPrimitive.Root open={abierto} onOpenChange={(v) => !v && cerrarCartelito()}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    // z-[100]: arriba de la ficha del teléfono (z-60), los menús (z-70) y el modal de la OT.
                    className="fixed inset-0 z-[100] bg-black/25 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
                    onMouseDown={(e) => e.preventDefault()}
                />
                <DialogPrimitive.Content
                    className={cn(
                        "fixed left-1/2 top-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2",
                        "rounded-xl border border-sky-200 bg-white p-5 shadow-2xl outline-none",
                        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                    )}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.stopPropagation()}
                    // Que tocarlo (el botón incluido) no le saque el foco al formulario de atrás:
                    // el clic igual llega.
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-sky-200">
                            <FlaskConical className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <DialogPrimitive.Title className="text-base font-semibold text-gray-900">Esto no se guarda</DialogPrimitive.Title>
                            <DialogPrimitive.Description className="mt-1 text-sm leading-relaxed text-gray-600">
                                Estás en modo práctica: durante la prueba piloto las materias primas se cargan en el Sistema
                                Integral. Acá podés recorrer la carga completa, pero no se graba nada.
                            </DialogPrimitive.Description>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <button
                            type="button"
                            onClick={cerrarCartelito}
                            className="rounded-lg bg-[#DC143C] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B8112E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                        >
                            Entendido
                        </button>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/** Cada cuánto se refresca lo que se ve en modo espejo. */
const REFRESCO_MS = 90_000;
/** Lo mínimo entre dos refrescos (volver a la pestaña dos veces seguidas no pide dos veces). */
const MINIMO_ENTRE_MS = 15_000;

/**
 * En modo espejo, vuelve a pedir lo que se ve: cada 90 s con la pestaña a la vista, y al
 * volver a ella. `recargar` tiene que ser silenciosa (dejar los datos viejos a la vista
 * hasta que lleguen los nuevos), como las `recargar` de los hooks de la sección.
 */
export function useRefrescoEspejo(activo: boolean, recargar: () => unknown) {
    const recargarRef = useRef(recargar);
    recargarRef.current = recargar;

    useEffect(() => {
        if (!activo) return;
        let ultimo = Date.now();
        const refrescar = () => {
            if (document.visibilityState !== "visible") return;
            if (Date.now() - ultimo < MINIMO_ENTRE_MS) return;
            ultimo = Date.now();
            void recargarRef.current();
            // El dueño también puede cambiar (fin de la prueba): que se entere sin F5.
            void cargarCatalogos(true);
        };
        const reloj = window.setInterval(refrescar, REFRESCO_MS);
        document.addEventListener("visibilitychange", refrescar);
        window.addEventListener("focus", refrescar);
        return () => {
            window.clearInterval(reloj);
            document.removeEventListener("visibilitychange", refrescar);
            window.removeEventListener("focus", refrescar);
        };
    }, [activo]);
}
