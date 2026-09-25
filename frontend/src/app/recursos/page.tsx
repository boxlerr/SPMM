"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, Pencil, Trash2, User, RefreshCw, Plus, Factory, Phone, Layers, Search, Target, MapPin, AlertTriangle, Ruler } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import OperarioForm from "./_components/OperarioForm";
import MaquinaForm from "./_components/MaquinaForm";
import ProcesoForm from "./_components/ProcesoForm";
import CatalogoSimple from "./_components/CatalogoSimple";
import RangoComposicion from "./_components/RangoComposicion";
import DetalleOperario from "./_components/DetalleOperario";
import DetalleMaquina from "./_components/DetalleMaquina";
import { EstadoBadge, EstadoMaquinaSelector } from "./_components/EstadoMaquina";
import { backendConoceEstado, infoEstado, type EstadoOperativo } from "./_maquinaOpciones";
import { parseApiError } from "@/lib/utils";
import CambiarEstado from "./_components/CambiarEstado";
import { Operario, Maquina, Proceso } from "./_types";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { PlanificacionItem } from "@/lib/types";
import { API_URL } from "@/config"
import { SharedOperatorsList } from "@/components/resources/SharedOperatorsList";
import { useCoberturaRangos, problemaDelProceso } from "@/hooks/useCoberturaRangos";
import EditorRangosDe from "./_components/EditorRangosDe";
import EditorMaquinasDe from "./_components/EditorMaquinasDe";
import DesdeAviso from "./_components/DesdeAviso";
import SinResultados, { type FiltroPuesto } from "./_components/SinResultados";
import { BibliotecaPlanos } from "@/components/planos/BibliotecaPlanos";
import { usePermisos } from "@/hooks/usePermisos";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";
import type { SeccionCodigo } from "@/lib/permisos";
import {
  comoSeHace, esParamDelAviso, leerCambioDelLink, leerFocoDelLink, leerHechoDelLink, leerRangosDelLink,
  siguientePendiente, sinAlternativa, type CambioDelAviso,
} from "@/lib/avisoEnRecursos";

type SolapaRecursos = "operarios" | "maquinas" | "procesos" | "rangos" | "sectores" | "planos";

/**
 * RF-24: cada solapa es una sección de Recursos (el rol puede cerrar algunas), salvo
 * Planos, que es la misma biblioteca de la pantalla Planos y va por esa área.
 */
const SECCION_DE_SOLAPA: Record<Exclude<SolapaRecursos, "planos">, SeccionCodigo> = {
  operarios: "recursos_humano",
  maquinas: "recursos_maquinaria",
  procesos: "recursos_procesos",
  rangos: "recursos_rangos",
  sectores: "recursos_sectores",
};
const ORDEN_SOLAPAS: SolapaRecursos[] = ["operarios", "maquinas", "procesos", "rangos", "sectores", "planos"];
const NOMBRE_SOLAPA: Record<SolapaRecursos, string> = {
  operarios: "Recurso humano",
  maquinas: "Recurso maquinaria",
  procesos: "Procesos",
  rangos: "Rangos",
  sectores: "Sectores",
  planos: "Planos",
};

/**
 * Para comparar nombres: sin mayúsculas, sin tildes y con un solo espacio.
 *
 * El catálogo viene del legacy en mayúscula y sin tildes («PREPARACION DE PINTURA»,
 * «ENSAMBLAJE, PUNTEADO  Y ESCUADRADO» con dos espacios), y los avisos del plan lo
 * escriben como frase («Preparación de pintura»). Buscando una forma no se encontraba
 * la otra. Vale también para quien tipea: «preparacion» y «preparación» son lo mismo.
 */
const normalizar = (t: string) =>
  (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Cómo se marca la fila que pidió el aviso: el mismo celeste que el cartel de arriba. */
const RESALTE_FOCO = "bg-sky-50 shadow-[inset_3px_0_0_0_var(--color-sky-500)]";

/** Lo que trae el link de un aviso del plan (ver `lib/avisoEnRecursos`). */
interface LlegadaDesdeAviso {
  tab: SolapaRecursos;
  titulo: string | null;
  hacer: string | null;
  /** Qué clase de cambio se vino a hacer: decide qué explica el cartel y qué permiso mira. */
  cambio: CambioDelAviso | null;
  /** Se vino a MIRAR lo que ya se guardó desde el plan («Ver cómo quedó»), no a hacerlo. */
  hecho: boolean;
}
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";
import { etiquetaTipo } from "./_maquinaOpciones";
import { rangoDePeriodo } from "@/lib/asistencia";
import { type ResumenMaquinas, chipDeLaTabla, fmtHorasUso } from "@/lib/usoMaquina";

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

export default function RecursosPage() {
  const { addNotification } = useNotifications();
  const { showToast } = useToast();

  // Qué rangos tiene cada máquina y qué máquinas habilita cada rango. Los huecos
  // (máquina sin rango, rango sin máquinas o sin gente) no se veían en ninguna
  // pantalla y salían a la luz recién cuando el plan quedaba raro.
  const {
    listo: coberturaListo, rangosPorMaquina, porRango, porProceso,
    catalogoRangos, recargar: recargarCobertura,
  } = useCoberturaRangos();

  // Fila desplegada para editar rangos (una por vez, como en la pestaña Rangos).
  const [maquinaAbierta, setMaquinaAbierta] = useState<number | null>(null);
  const [procesoAbierto, setProcesoAbierto] = useState<number | null>(null);
  // Filtro de la pestaña Procesos: el catálogo tiene 414 y los que traen problema son
  // unas decenas. Sin esto hay que buscarlos a ojo entre todos.
  const [soloProblemas, setSoloProblemas] = useState(false);

  const [tabElegida, setTabActiva] = useState<SolapaRecursos>("operarios");

  // RF-24. Qué solapas se ven y en cuáles se puede escribir. Si la elegida (la de
  // siempre, o la que pidió un ?tab=) no se puede ver, se abre la primera que sí: la
  // pantalla nunca queda parada en una solapa cerrada.
  const { puede, puedeSeccion } = usePermisos();
  const veSolapa = (t: SolapaRecursos) =>
    t === "planos" ? puede("planos") : puedeSeccion(SECCION_DE_SOLAPA[t]);
  const editaSolapa = (t: SolapaRecursos) =>
    t === "planos" ? puede("planos", "write") : puedeSeccion(SECCION_DE_SOLAPA[t], "write");
  const tabActiva: SolapaRecursos = veSolapa(tabElegida)
    ? tabElegida
    : (ORDEN_SOLAPAS.find(veSolapa) ?? tabElegida);
  const editaPersonas = editaSolapa("operarios");
  const editaMaquinas = editaSolapa("maquinas");
  const editaProcesos = editaSolapa("procesos");
  // Qué rangos habilitan una máquina o un proceso se edita en la solapa Rangos: el
  // backend pide eso para /maquinarias/{id}/rangos y /procesos/{id}/rangos.
  const editaRangos = editaSolapa("rangos");
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  // ¿El backend ya sabe de tipo, estado y frecuencia (RF-08)? Mientras el deploy a mano
  // no llegue, la lista no trae esos campos y la pantalla se ve como antes.
  const conoceEstado = backendConoceEstado(maquinas);
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  /**
   * Si la lista de procesos ya llegó alguna vez. `api.loading` no alcanza: lo comparten
   * todas las solapas, y entrando directo a Procesos el pedido de Recurso humano (la
   * solapa de siempre, que arranca primero) termina antes y lo apaga con los procesos
   * todavía en camino. En ese hueco se veía «no hay procesos» por un instante.
   */
  const [procesosCargados, setProcesosCargados] = useState(false);
  /**
   * Lo mismo para Recurso maquinaria. Llegando desde un aviso con `?tab=maquinas`, la
   * pantalla arranca en Recurso humano y pide las personas; ese pedido termina antes
   * que el de las máquinas, apaga `api.loading`, y por un instante se leía «No hay
   * recurso maquinaria disponible» justo en la solapa a la que te mandó el aviso.
   */
  const [maquinasCargadas, setMaquinasCargadas] = useState(false);
  /**
   * RF-10: las horas de uso de este mes y el estado del mantenimiento de cada máquina.
   * `undefined` = todavía no llegó; `null` = el backend no lo tiene (se deploya a mano y
   * puede ir atrás del front) o no contestó: la columna no se muestra.
   */
  const [usoDelMes, setUsoDelMes] = useState<ResumenMaquinas | null | undefined>(undefined);

  const [busquedaProceso, setBusquedaProceso] = useState("");

  // Pagination for Processes
  const ITEMS_PER_PAGE = 20;
  const [currentProcesosPage, setCurrentProcesosPage] = useState(1);

  // Reset page on search
  useEffect(() => {
    setCurrentProcesosPage(1);
  }, [busquedaProceso]);
  const [operarioSeleccionado, setOperarioSeleccionado] = useState<Operario | null>(null);
  const [maquinaSeleccionada, setMaquinaSeleccionada] = useState<Maquina | null>(null);
  const [mostrarDialogo, setMostrarDialogo] = useState({
    eliminar: false,
    crear: false,
    editar: false,
    cambiarEstado: false,
  });
  const [itemAEliminar, setItemAEliminar] = useState<{ tipo: "operario" | "maquina" | "proceso"; id: number; nombre: string } | null>(null);
  /**
   * Qué se lleva puesto el borrado, si el backend lo contestó.
   *
   * null = todavía no se preguntó. Con texto = el backend dijo 409 («está en 3 OT»,
   * «tiene 2 categorías») y el botón pasa a «Eliminar igual». Antes ese motivo se
   * perdía y el cartel decía que se había caído la base de datos — mandando a esperar
   * a que se arreglara algo que no estaba roto.
   */
  const [motivoBorrado, setMotivoBorrado] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [itemAEditar, setItemAEditar] = useState<Operario | Maquina | Proceso | null>(null);
  const [operarioCambiarEstado, setOperarioCambiarEstado] = useState<Operario | null>(null);

  // State for assigned tasks
  const [tasks, setTasks] = useState<PlanificacionItem[]>([]);
  const [operatorTasks, setOperatorTasks] = useState<PlanificacionItem[]>([]);

  const apiUrl = API_URL;
  const cleanUrl = apiUrl.replace(/\/$/, "");
  const api = useApi<any>();

  useEffect(() => {
    if (tabActiva === "operarios") {
      fetchOperarios();
    } else if (tabActiva === "maquinas") {
      fetchMaquinas();
      void pedirUsoDelMes();
    } else if (tabActiva !== "planos") {
      // Planos se arregla solo: la biblioteca sale a buscar su propia lista paginada y
      // no mira `procesos` para nada. Sin esta salida, entrar a la solapa disparaba el
      // pedido de los 414 procesos para no mostrarlos en ningún lado.
      fetchProcesos();
      // La fila desplegada de un proceso tiene el editor de "en qué máquinas se hace",
      // y su lista para elegir es `maquinas`, que sólo se pedía al entrar a la solapa
      // Recurso maquinaria. Entrando directo a Procesos —que es lo que hace el aviso
      // «Decile en qué máquinas se hace»— el desplegable decía «No queda recurso
      // maquinaria para agregar»: se llegaba a la fila y no había nada que elegir.
      // En silencio, sin el spinner que taparía la lista de procesos.
      if (tabActiva === "procesos" && maquinas.length === 0) void refrescarMaquinasSinSpinner();
    }
  }, [tabActiva]);

  /**
   * `?tab=procesos&foco=123&q=plegado` — entrar directo a lo que hay que tocar.
   *
   * Los avisos del planificador terminan en "Recursos › Procesos", y hasta ahora
   * eso era un cartelito: había que salir del plan, encontrar esta pantalla,
   * elegir la pestaña, buscar el proceso entre 414 (paginados de a 20) y recién
   * ahí desplegar la fila. El link del aviso ahora deja todo eso hecho.
   *
   * `foco` es uno o varios ids separados por coma, y la solapa muestra ESOS y nada
   * más, con un cartel que lo dice y un botón para ver el resto. Hasta el 23/09/2026
   * el foco se buscaba precargando el buscador con el nombre (`q`), y el nombre que
   * manda el aviso no es el del catálogo («Preparación de pintura» contra «PREPARACION
   * DE PINTURA»): la lista quedaba vacía y la fila que había que tocar no aparecía.
   * `q` sin `foco` se sigue aceptando, y el buscador ahora ignora tildes y espacios.
   *
   * `aviso` y `hacer` son el aviso y la solución: van al cartel de arriba, con
   * `cambio` (qué clase de cambio es) para decir dónde se hace y si se puede. El
   * formato entero está en `lib/avisoEnRecursos`, junto con quien arma el link.
   */
  const focoAplicado = useRef(false);
  /** Los ids que mandó el aviso, y en qué solapa. Mientras esté, esa solapa muestra solo esos. */
  const [foco, setFoco] = useState<{ tab: SolapaRecursos; ids: number[] } | null>(null);
  /** De qué aviso se vino, para el cartel de arriba. */
  const [desdeAviso, setDesdeAviso] = useState<LlegadaDesdeAviso | null>(null);
  const focoEn = (t: SolapaRecursos) => (foco && foco.tab === t ? foco.ids : null);
  const esFoco = (t: SolapaRecursos, id: number) => !!focoEn(t)?.includes(id);
  /** Operario del `?foco=`: se guarda acá y se abre recién cuando la lista cargó. */
  const [operarioAFocalizar, setOperarioAFocalizar] = useState<number | null>(null);
  /**
   * Rangos que el aviso le propone a cada fila del `?foco=` (`?rangos=3,7`, o
   * `?rangos.12=3,7` cuando no a todas les suma lo mismo).
   *
   * Se guardan para pasárselos al editor, que los deja tildados y enciende el botón
   * de guardar: el que llega desde un aviso ya no tiene que acordarse de cuál era el
   * rango ni buscarlo entre treinta. No se guarda nada solo.
   */
  const [rangosSugeridos, setRangosSugeridos] = useState<Record<number, number[]> | null>(null);
  /**
   * Las filas del aviso que ya se guardaron. A esas no se les vuelve a proponer nada
   * (si destildaste un propuesto y guardaste, reabrirla no te lo vuelve a tildar) y
   * no cuentan como pendientes para abrir la siguiente.
   */
  const [guardadosDelAviso, setGuardadosDelAviso] = useState<number[]>([]);
  /**
   * Desplegar la primera fila del aviso en cuanto se sepa qué tiene cada una (la
   * cobertura). Se espera a eso para no abrir una que ya tiene todo lo que el aviso
   * propone, cuando otra del mismo aviso sigue esperando.
   */
  const [abrirAlLlegar, setAbrirAlLlegar] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || focoAplicado.current) return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (!tab) return;
    if (!ORDEN_SOLAPAS.includes(tab as SolapaRecursos)) return;
    focoAplicado.current = true;

    const solapa = tab as SolapaRecursos;
    setTabActiva(solapa);

    const ids = leerFocoDelLink(params);
    // El nombre sólo si no vino el id: con el id no hace falta, y el nombre del aviso
    // puede no coincidir con el del catálogo (ver arriba).
    const q = params.get("q");
    if (q && solapa === "procesos" && ids.length === 0) setBusquedaProceso(q);

    if (ids.length > 0) {
      setFoco({ tab: solapa, ids });
      // Con uno solo es "la fila"; con varios (las tres fresadoras) al guardar una se
      // pasa a la que falte (ver `alGuardarDelAviso`).
      if (solapa === "procesos" || solapa === "maquinas") setAbrirAlLlegar(true);
      if (solapa === "operarios" && ids.length === 1) setOperarioAFocalizar(ids[0]);
      // Lo ya guardado no se vuelve a proponer: tildar de nuevo lo que ya tiene
      // haría parecer que falta guardarlo.
      if (!leerHechoDelLink(params)) setRangosSugeridos(leerRangosDelLink(params, ids));
    }

    const titulo = params.get("aviso");
    // Sin el «O » de alternativa: un link armado por una pestaña del plan abierta desde
    // antes de este cambio todavía lo trae.
    const hacer = params.get("hacer") ? sinAlternativa(params.get("hacer")) : null;
    if (titulo || hacer || ids.length > 0) {
      setDesdeAviso({ tab: solapa, titulo, hacer, cambio: leerCambioDelLink(params), hecho: leerHechoDelLink(params) });
    }

    // El query param se limpia para que un F5 no vuelva a arrastrar el foco de un
    // aviso que quizás ya se resolvió.
    const url = new URL(window.location.href);
    Array.from(url.searchParams.keys()).filter(esParamDelAviso).forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
  }, []);

  /** Sacar el filtro del aviso: se ve la lista entera, el cartel queda con lo que había que hacer. */
  const verTodoSinFoco = () => {
    setFoco(null);
    setRangosSugeridos(null);
    setGuardadosDelAviso([]);
    setAbrirAlLlegar(false);
  };
  /** Cerrar el cartel también saca el filtro: un filtro sin cartel sería un filtro escondido. */
  const cerrarDesdeAviso = () => {
    setDesdeAviso(null);
    verTodoSinFoco();
  };

  /** Los rangos que una fila tiene hoy guardados. */
  const rangosDeHoy = (t: SolapaRecursos, id: number) =>
    (t === "maquinas" ? rangosPorMaquina.get(id) : porProceso.get(id)?.rangos) ?? [];
  /** Lo que el aviso le propone a una fila, mientras sea del aviso y no se haya guardado. */
  const sugeridosPara = (t: SolapaRecursos, id: number): number[] | undefined =>
    esFoco(t, id) && !guardadosDelAviso.includes(id) ? rangosSugeridos?.[id] : undefined;
  /**
   * Si a una fila del aviso le falta algo: no se guardó y, si el aviso propone rangos,
   * todavía no tiene alguno. Las que ya tienen todo lo propuesto se saltean.
   */
  const pendienteDelAviso = (t: SolapaRecursos, id: number, guardados: number[]) => {
    if (guardados.includes(id)) return false;
    if (!rangosSugeridos) return true;
    const tiene = new Set(rangosDeHoy(t, id).map((r) => r.id));
    return (rangosSugeridos[id] ?? []).some((r) => !tiene.has(r));
  };
  /**
   * Al guardar una fila, abrir la que falte del mismo aviso.
   *
   * El aviso de la FRESADORA CNC pide lo mismo en tres máquinas. El botón del plan lo
   * hace de una, pero quien viene a hacerlo acá tenía que abrir cada fila, y al
   * guardar la primera se perdían los rangos propuestos para las otras dos. Se lleva
   * la cuenta de cuáles se guardaron, y no importa el orden: guardar la tercera
   * primero abre la primera. Los propuestos se sueltan recién cuando no falta ninguna.
   */
  const alGuardarDelAviso = (t: "maquinas" | "procesos", id: number) => {
    const abrir = t === "maquinas" ? setMaquinaAbierta : setProcesoAbierto;
    const ids = focoEn(t);
    if (!ids || !ids.includes(id)) {
      abrir(null);
      return;
    }
    const guardados = guardadosDelAviso.includes(id) ? guardadosDelAviso : [...guardadosDelAviso, id];
    setGuardadosDelAviso(guardados);
    const siguiente = siguientePendiente(ids, id, (x) => pendienteDelAviso(t, x, guardados));
    abrir(siguiente);
    if (siguiente === null) setRangosSugeridos(null);
  };

  useEffect(() => {
    if (!abrirAlLlegar || !foco || !coberturaListo) return;
    setAbrirAlLlegar(false);
    const primera =
      siguientePendiente(foco.ids, null, (id) => pendienteDelAviso(foco.tab, id, guardadosDelAviso)) ?? foco.ids[0];
    if (foco.tab === "procesos") setProcesoAbierto(primera);
    if (foco.tab === "maquinas") setMaquinaAbierta(primera);
  }, [abrirAlLlegar, foco, coberturaListo]);

  useEffect(() => {
    if (operarioAFocalizar === null || operarios.length === 0) return;
    const op = operarios.find((o) => o.id === operarioAFocalizar);
    setOperarioAFocalizar(null);
    if (op) void handleVerOperario(op);
  }, [operarioAFocalizar, operarios]);

  /**
   * Lleva a la vista la fila desplegada por el `?foco=`, que puede estar abajo.
   *
   * Depende también del largo de las listas: cuando el link entra directo a una
   * pestaña, la fila todavía no existe —el fetch está en curso— y buscarla por id
   * no encuentra nada. Al llegar los datos, el efecto corre de nuevo y ahí sí.
   */
  useEffect(() => {
    const id = procesoAbierto ? `proceso-${procesoAbierto}` : maquinaAbierta ? `maquina-${maquinaAbierta}` : null;
    if (!id) return;
    // Un tick: la fila se despliega en este mismo render y todavía no está en el DOM.
    // La fila existe dos veces —la tabla de escritorio y la tarjeta del teléfono— y una
    // de las dos está escondida: se lleva a la vista la que se ve.
    const t = window.setTimeout(() => {
      const filas = Array.from(document.querySelectorAll<HTMLElement>(`[data-fila="${id}"]`));
      (filas.find((f) => f.offsetParent !== null) ?? filas[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [procesoAbierto, maquinaAbierta, procesos.length, maquinas.length, currentProcesosPage]);

  const fetchOperarios = async () => {
    const data = await api.fetchData(`${cleanUrl}/operarios`);
    const filtered = data.filter((op: Operario) => op.sector?.toUpperCase() !== "PRUEBAS");
    setOperarios(filtered);
  };

  const fetchMaquinas = async () => {
    const data = await api.fetchData(`${cleanUrl}/maquinarias`);
    setMaquinas(data);
    setMaquinasCargadas(true);
  };

  /**
   * La lista de nuevo, pero sin el spinner de `fetchMaquinas`, que la tapa entera.
   * Después de guardar la fila ya muestra lo guardado: esto sólo trae lo que haya
   * cambiado otro (y la máquina recién creada, que todavía no tiene fila).
   */
  const refrescarMaquinasSinSpinner = async () => {
    try {
      const res = await fetch(`${cleanUrl}/maquinarias`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const cuerpo = await res.json();
      if (cuerpo?.status && Array.isArray(cuerpo.data)) {
        setMaquinas(cuerpo.data);
        setMaquinasCargadas(true);
      }
    } catch {
      // Se queda lo que está en pantalla, que ya es lo guardado.
    }
  };

  /**
   * RF-10: las horas del mes y el mantenimiento de todas las máquinas, en UN pedido y sin
   * spinner: la tabla ya está a la vista y esto sólo suma una columna.
   */
  const pedirUsoDelMes = async () => {
    const { desde, hasta } = rangoDePeriodo("mes");
    try {
      const res = await fetch(`${cleanUrl}/maquinarias-uso?desde=${desde}&hasta=${hasta}`, { headers: getAuthHeaders() });
      const cuerpo = res.ok ? await res.json().catch(() => null) : null;
      setUsoDelMes(cuerpo?.status && cuerpo?.data?.horas ? (cuerpo.data as ResumenMaquinas) : null);
    } catch {
      setUsoDelMes((previo) => previo ?? null);
    }
  };

  /** Pone en la lista (y en el detalle, si está abierto) la máquina como quedó guardada. */
  const aplicarMaquinaGuardada = (guardada?: Maquina) => {
    if (!guardada) return;
    setMaquinas((prev) => prev.map((m) => (m.id === guardada.id ? { ...m, ...guardada } : m)));
    setMaquinaSeleccionada((sel) => (sel && sel.id === guardada.id ? { ...sel, ...guardada } : sel));
  };

  // Último pedido de cambio de estado por máquina: si se cambia dos veces seguidas y el
  // primero falla tarde, no tiene que deshacer el segundo.
  const ultimoCambioEstado = useRef<Record<number, number>>({});

  /**
   * Cambiar el estado operativo desde la fila (RF-08). Se ve al toque y, si el backend
   * no lo guarda, vuelve a como estaba y avisa. Nada de recargar la lista.
   */
  const cambiarEstadoMaquina = async (maquina: Maquina, nuevo: EstadoOperativo) => {
    const anterior = maquina.estado_operativo;
    const pedido = (ultimoCambioEstado.current[maquina.id] ?? 0) + 1;
    ultimoCambioEstado.current[maquina.id] = pedido;
    const poner = (valor?: string) => {
      setMaquinas((prev) => prev.map((m) => (m.id === maquina.id ? { ...m, estado_operativo: valor } : m)));
      setMaquinaSeleccionada((sel) => (sel && sel.id === maquina.id ? { ...sel, estado_operativo: valor } : sel));
    };
    const deshacer = (motivo: string) => {
      if (ultimoCambioEstado.current[maquina.id] === pedido) poner(anterior);
      showToast(motivo, "error");
    };

    poner(nuevo);
    try {
      const res = await fetch(`${cleanUrl}/maquinarias/${maquina.id}`, {
        method: "PUT",
        headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
        // `nombre` va porque el DTO lo exige; el backend sólo toca los campos que vienen.
        body: JSON.stringify({ nombre: maquina.nombre, estado_operativo: nuevo }),
      });
      const texto = await res.text().catch(() => "");
      let cuerpo: { status?: boolean } | null = null;
      try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; }
      if (!res.ok || cuerpo?.status === false) {
        deshacer(parseApiError(texto) || `No se pudo cambiar el estado de ${maquina.nombre}; quedó como estaba.`);
        return;
      }
      showToast(`${maquina.nombre}: ${infoEstado(nuevo).etiqueta.toLowerCase()}.`, "success");
    } catch {
      deshacer(`No se pudo conectar con el servidor: ${maquina.nombre} quedó como estaba.`);
    }
  };

  const fetchProcesos = async () => {
    const data = await api.fetchData(`${cleanUrl}/procesos`);
    setProcesos(data);
    setProcesosCargados(true);
  };

  const handleVerOperario = async (operario: Operario) => {
    try {
      // Optimistic / Cache: Show existing tasks immediately or clear stale data
      if (tasks.length > 0) {
        setOperatorTasks(tasks.filter(t => t.id_operario === operario.id));
      } else {
        setOperatorTasks([]);
      }

      // 1. Fetch Operario Details
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`, { headers: getAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setOperarioSeleccionado(data.data || operario);
      } else {
        setOperarioSeleccionado(operario);
      }

      // 2. Fetch Assigned Tasks (Background refresh)
      const planResponse = await fetch(`${cleanUrl}/planificacion`, { headers: getAuthHeaders() });
      if (planResponse.ok) {
        const planData: PlanificacionItem[] = await planResponse.json();
        setTasks(planData);
        // Filter for this operator
        const assigned = planData.filter(t => t.id_operario === operario.id);
        setOperatorTasks(assigned);
      }

    } catch (e) {
      console.error("Error loading operator details:", e);
      setOperarioSeleccionado(operario);
    }
  };

  const handleVerMaquina = async (maquina: Maquina) => {
    // Se abre al toque con lo que ya está en la lista, y después se refresca por si otro
    // la cambió. Antes esperaba al pedido para abrir, y si la máquina no existía más
    // abría el detalle vacío: `data` viene como {} y `{} || maquina` elige el {}.
    setMaquinaSeleccionada(maquina);
    try {
      const response = await fetch(`${cleanUrl}/maquinarias/${maquina.id}`, { headers: getAuthHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      const fresca = data?.data;
      if (fresca && fresca.id === maquina.id) {
        setMaquinaSeleccionada((sel) => (sel && sel.id === maquina.id ? { ...sel, ...fresca } : sel));
      }
    } catch {
      // Queda lo de la lista.
    }
  };

  const handleEditar = async (tipo: "operario" | "maquina" | "proceso", item: Operario | Maquina | Proceso) => {
    setItemAEditar(item);
    setMostrarDialogo({ ...mostrarDialogo, editar: true });
  };

  const handleEliminar = async () => {
    if (!itemAEliminar) return;

    const url = itemAEliminar.tipo === "operario"
      ? `${cleanUrl}/operarios/${itemAEliminar.id}`
      : itemAEliminar.tipo === "maquina"
        ? `${cleanUrl}/maquinarias/${itemAEliminar.id}`
        : `${cleanUrl}/procesos/${itemAEliminar.id}`;

    // Se pide con fetch y no con executeOperation porque hay que LEER el cuerpo del
    // 409: executeOperation devuelve un booleano y el motivo se pierde.
    const forzar = motivoBorrado !== null;
    setBorrando(true);
    let success = false;
    let aviso = "";
    try {
      const res = await fetch(`${url}${forzar ? "?forzar=true" : ""}`,
        { method: "DELETE", headers: getAuthHeaders() });
      if (res.status === 409) {
        const cuerpo = await res.json().catch(() => ({}));
        setMotivoBorrado(cuerpo?.detail || cuerpo?.errorDescription ||
          "Algo está usando esto.");
        setBorrando(false);
        return;   // el cartel queda abierto con el motivo y el botón «Eliminar igual»
      }
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        showToast(cuerpo?.detail || "No se pudo eliminar.", "error");
        setBorrando(false);
        setMostrarDialogo({ ...mostrarDialogo, eliminar: false });
        setItemAEliminar(null);
        setMotivoBorrado(null);
        return;
      }
      const cuerpo = await res.json().catch(() => ({}));
      aviso = typeof cuerpo?.data?.aviso === "string" && cuerpo.data.aviso
        ? ` ${cuerpo.data.aviso}` : "";
      success = true;
    } catch {
      showToast("No se pudo eliminar: no hubo respuesta del servidor.", "error");
    }
    setBorrando(false);
    setMotivoBorrado(null);
    if (success) {
      if (itemAEliminar.tipo === "operario") {
        addNotification(
          `Recurso humano ${itemAEliminar.nombre} ha sido eliminado`,
          "operario_deleted"
        );
        showToast(`Recurso humano ${itemAEliminar.nombre} eliminado correctamente.${aviso}`, 'success');
        await fetchOperarios();
      } else if (itemAEliminar.tipo === "maquina") {
        showToast(`Recurso maquinaria ${itemAEliminar.nombre} eliminado correctamente.${aviso}`, 'success');
        await fetchMaquinas();
      } else {
        showToast(`Proceso ${itemAEliminar.nombre} eliminado correctamente.${aviso}`, 'success');
        await fetchProcesos();
      }
    }
    setMostrarDialogo({ ...mostrarDialogo, eliminar: false });
    setItemAEliminar(null);
  };

  const handleAbrirCrear = () => {
    setItemAEditar(null);
    setMostrarDialogo({ ...mostrarDialogo, crear: true });
  };

  const handleCambiarEstado = (operario: Operario) => {
    setOperarioCambiarEstado(operario);
    setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: true });
  };

  const getEstadoColor = (disponible?: boolean) => {
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  const formatPhone = (value?: string) => {
    if (!value) return "";
    return value.replace(/\D/g, "");
  };

  const capitalizeName = (text?: string) => {
    if (!text) return "";
    return text
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const busquedaNormalizada = normalizar(busquedaProceso);
  const focoProcesos = focoEn("procesos");
  const procesosFiltrados = procesos
    .filter(p => !focoProcesos || focoProcesos.includes(p.id))
    .filter(p => normalizar(p.nombre).includes(busquedaNormalizada))
    // "Problema" es no tener rango (se lo lleva cualquiera) o tener rangos que no
    // habilitan a nadie disponible (no lo hace nadie). Son los dos casos que el
    // planificador después reporta como bloqueo.
    .filter(p => {
      if (!soloProblemas) return true;
      const c = porProceso.get(p.id);
      return !!c && c.lineas_abiertas > 0 && !!problemaDelProceso(c);
    });

  /**
   * Los filtros puestos en Procesos, cada uno con cómo sacarlo. Es lo que se muestra
   * cuando la lista queda vacía: sin esto, «No se encontraron procesos» no decía que
   * había un filtro ni cuál (ver `SinResultados`).
   */
  const filtrosProcesos: FiltroPuesto[] = [
    ...(focoProcesos ? [{ etiqueta: "Solo lo del aviso del plan", onSacar: verTodoSinFoco }] : []),
    ...(busquedaNormalizada ? [{ etiqueta: `Búsqueda «${busquedaProceso.trim()}»`, onSacar: () => setBusquedaProceso("") }] : []),
    ...(soloProblemas ? [{ etiqueta: "Solo los que frenan un plan", onSacar: () => setSoloProblemas(false) }] : []),
  ];
  // Si lo que pidió el aviso no está en el catálogo, se dice eso y no "no hay nada".
  const focoProcesosPerdido = !!focoProcesos && procesosCargados && !procesos.some((p) => focoProcesos.includes(p.id));

  // Recurso maquinaria y Recurso humano: lo mismo, pero el aviso es el único filtro.
  const focoMaquinas = focoEn("maquinas");
  const maquinasVisibles = focoMaquinas ? maquinas.filter((m) => focoMaquinas.includes(m.id)) : maquinas;
  const focoOperarios = focoEn("operarios");
  const operariosVisibles = focoOperarios ? operarios.filter((o) => focoOperarios.includes(o.id)) : operarios;

  /** Qué está mostrando el cartel del aviso en la solapa abierta, con nombre. */
  const nombresDelFoco: string[] =
    tabActiva === "procesos" && focoProcesos
      ? procesos.filter((p) => focoProcesos.includes(p.id)).map((p) => p.nombre)
      : tabActiva === "maquinas" && focoMaquinas
        ? maquinasVisibles.map((m) => m.nombre.trim())
        : tabActiva === "operarios" && focoOperarios
          ? operariosVisibles.map((o) => `${o.nombre} ${o.apellido}`.trim())
          : [];
  const totalDeLaSolapa =
    tabActiva === "procesos" ? procesos.length : tabActiva === "maquinas" ? maquinas.length : operarios.length;
  /**
   * Dónde se hace, en esta solapa, lo que pide el aviso. "Dale el rango TERCERIZADO"
   * trae a la lista de personas, y en la lista no hay ningún botón de rangos: se
   * cambian adentro de la ficha. Y si el usuario no puede hacer ESE cambio (RF-24),
   * decirlo, en vez de dejarlo buscando un botón que para él no existe. El texto
   * depende del cambio y del permiso que pide cada uno (ver `comoSeHace`).
   */
  const comoDelAviso =
    desdeAviso && (desdeAviso.tab === "operarios" || desdeAviso.tab === "maquinas" || desdeAviso.tab === "procesos")
      ? comoSeHace(desdeAviso.tab, desdeAviso.cambio, {
        personas: editaPersonas,
        maquinas: editaMaquinas,
        procesos: editaProcesos,
        rangos: editaRangos,
      })
      : null;

  const totalProcesosPages = Math.ceil(procesosFiltrados.length / ITEMS_PER_PAGE);
  const paginatedProcesos = procesosFiltrados.slice(
    (currentProcesosPage - 1) * ITEMS_PER_PAGE,
    currentProcesosPage * ITEMS_PER_PAGE
  );

  const handleProcesosPrevious = () => {
    if (currentProcesosPage > 1) setCurrentProcesosPage(p => p - 1);
  };

  const handleProcesosNext = () => {
    if (currentProcesosPage < totalProcesosPages) setCurrentProcesosPage(p => p + 1);
  };

  // RF-22: lo que muestran las tablas de Recurso maquinaria y Procesos. Procesos sale
  // entero con la búsqueda y el filtro puestos, no sólo la página de 20 que se ve.
  const columnasMaquinas: ColumnaExport<Maquina>[] = [
    { titulo: "Nombre", valor: (m) => m.nombre },
    { titulo: "Código", valor: (m) => m.cod_maquina ?? "" },
    ...(conoceEstado
      ? [
          { titulo: "Estado", valor: (m: Maquina) => infoEstado(m.estado_operativo).etiqueta } as ColumnaExport<Maquina>,
          { titulo: "Tipo", valor: (m: Maquina) => etiquetaTipo(m.tipo) ?? "" } as ColumnaExport<Maquina>,
          { titulo: "Mantenimiento cada (días)", tipo: "entero", valor: (m: Maquina) => m.frecuencia_mantenimiento_dias } as ColumnaExport<Maquina>,
        ]
      : []),
    ...(usoDelMes
      ? [
          { titulo: "Horas de uso del mes", tipo: "numero", decimales: 1,
            valor: (m: Maquina) => (usoDelMes.horas[String(m.id)]?.efectivo_min ?? 0) / 60 } as ColumnaExport<Maquina>,
          ...(usoDelMes.mantenimiento
            ? [{ titulo: "Mantenimiento", valor: (m: Maquina) => {
                const e = usoDelMes.mantenimiento?.[String(m.id)];
                if (!e) return "";
                return e.proxima_fecha ? `${e.estado_texto} (próximo: ${e.proxima_fecha.split("-").reverse().join("/")})` : e.estado_texto;
              } } as ColumnaExport<Maquina>]
            : []),
        ]
      : []),
    {
      titulo: "Rangos",
      valor: (m) => (coberturaListo ? (rangosPorMaquina.get(m.id) ?? []).map((r) => r.nombre).join(", ") || "Sin rango" : ""),
    },
    { titulo: "Limitación", valor: (m) => m.limitacion ?? "" },
    { titulo: "Capacidad", valor: (m) => m.capacidad ?? "" },
    { titulo: "Especialidad", valor: (m) => m.especialidad ?? "" },
  ];
  const columnasProcesos: ColumnaExport<Proceso>[] = [
    { titulo: "Nombre", valor: (p) => p.nombre },
    {
      titulo: "Quién puede hacerlo",
      valor: (p) => {
        const cob = porProceso.get(p.id);
        if (!coberturaListo || !cob) return "";
        const problema = problemaDelProceso(cob);
        if (problema === "nadie") return "No lo puede hacer nadie";
        if (problema === "sin_rango") return "Sin rango";
        return cob.rangos.map((r) => r.nombre).join(", ");
      },
    },
    { titulo: "Recurso humano habilitado", tipo: "entero", valor: (p) => porProceso.get(p.id)?.habilitados ?? null },
    { titulo: "Habilitados a mano", tipo: "entero", valor: (p) => porProceso.get(p.id)?.por_habilidad_manual ?? null },
    { titulo: "Recurso maquinaria", valor: (p) => (porProceso.get(p.id)?.maquinas ?? []).map((m) => m.nombre).join(", ") },
    { titulo: "Líneas en OT abiertas", tipo: "entero", valor: (p) => porProceso.get(p.id)?.lineas_abiertas ?? null },
    { titulo: "Descripción", valor: (p) => p.descripcion ?? "" },
  ];

  /**
   * Los editores de la fila desplegada. Salen de acá y no escritos en la tabla porque
   * van en dos lugares: la tabla de escritorio y la tarjeta del teléfono, que hasta
   * ahora no los tenía (se llegaba desde el aviso y no había con qué hacer lo que pedía).
   *
   * Los rangos que propone el aviso van SÓLO a las filas del aviso: antes iban a
   * cualquier fila que se abriera, y abrir otra máquina la mostraba con un rango
   * tildado que nadie le había pedido.
   */
  const editorRangosDeMaquina = (maquina: Maquina) => (
    <EditorRangosDe
      tipo="maquinaria"
      id={maquina.id}
      nombre={maquina.nombre}
      actuales={rangosPorMaquina.get(maquina.id) ?? []}
      catalogo={catalogoRangos}
      sugeridos={sugeridosPara("maquinas", maquina.id)}
      onGuardado={() => {
        alGuardarDelAviso("maquinas", maquina.id);
        recargarCobertura();
      }}
    />
  );
  const editoresDeProceso = (proceso: Proceso) => {
    const cob = porProceso.get(proceso.id);
    const sugeridos = sugeridosPara("procesos", proceso.id);
    // Si el aviso vino a cargarle rangos y todavía faltan, guardar en qué máquina se
    // hace no lo cierra: la fila queda abierta con los rangos propuestos a la vista.
    const faltanRangos =
      editaRangos && !!sugeridos?.some((r) => !(cob?.rangos ?? []).some((a) => a.id === r));
    return (
      <>
        {editaRangos && <EditorRangosDe
          tipo="proceso"
          id={proceso.id}
          nombre={proceso.nombre}
          actuales={cob?.rangos ?? []}
          catalogo={catalogoRangos}
          sugeridos={sugeridos}
          onGuardado={() => {
            alGuardarDelAviso("procesos", proceso.id);
            recargarCobertura();
          }}
        />}
        {/* Quién puede hacerlo y en qué máquina son las dos mitades
            de la misma pregunta: hacen falta las dos para que el
            planificador pueda reservar. Van juntas, en la misma
            fila desplegada. */}
        {editaProcesos && <EditorMaquinasDe
          id={proceso.id}
          nombre={proceso.nombre}
          actuales={cob?.maquinas ?? []}
          catalogo={maquinas}
          onGuardado={() => {
            if (!faltanRangos) alGuardarDelAviso("procesos", proceso.id);
            recargarCobertura();
          }}
        />}
      </>
    );
  };

  return (
    // RF-27: en el teléfono casi sin margen propio, porque el layout ya pone el suyo
    // (sumados eran 28px de cada lado de 375). Desde `sm`, los de siempre. El `pr-12`
    // del título, abajo de `lg`, deja libre la esquina de la campana de avisos.
    <div className="min-h-screen bg-background p-1 sm:p-4 md:p-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3 md:mb-4 pr-12 lg:pr-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          Administración de Recursos
          {!editaSolapa(tabActiva) && <MarcaSoloLectura />}
        </h1>
        <div className="flex flex-col sm:flex-row gap-2">
          {(tabActiva === "operarios" || tabActiva === "maquinas" || tabActiva === "procesos") && (
            <>
              {editaSolapa(tabActiva) && (
                <Button onClick={handleAbrirCrear} size="sm" className="w-full sm:w-auto bg-[#DC143C] hover:bg-[#B01030] text-white">
                  <Plus className="h-4 w-4 mr-2" />
                  {tabActiva === "operarios" ? "Nuevo recurso humano" : tabActiva === "maquinas" ? "Nuevo recurso maquinaria" : "Nuevo Proceso"}
                </Button>
              )}
              <Button
                onClick={tabActiva === "operarios" ? fetchOperarios : tabActiva === "maquinas" ? fetchMaquinas : fetchProcesos}
                disabled={api.loading}
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${api.loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </>
          )}
        </div>
      </div>

      {api.error && (
        <Alert variant="destructive" className="mb-4 md:mb-6">
          <AlertDescription>{api.error}</AlertDescription>
        </Alert>
      )}

      {/* Grilla y no `flex gap-2` con `flex-1`: los Button de shadcn traen
          `whitespace-nowrap` y no achican, así que "Recurso maquinaria" y los demás
          pedían ~820px y abajo de eso la fila se iba de la pantalla. Con
          grilla el ancho lo pone la columna y los rótulos se acomodan solos.
          En el teléfono (RF-27) cada celda mide ~150px y «Recurso maquinaria» con su
          ícono pide ~155: el botón se estiraba y descuadraba la grilla. Ahí el rótulo
          puede bajar a un segundo renglón; desde `sm` vuelve a ir en una línea. */}
      <div className="mb-4 md:mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {veSolapa("operarios") && <Button
          variant={tabActiva === "operarios" ? "default" : "outline"}
          onClick={() => setTabActiva("operarios")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "operarios" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <User className="h-4 w-4 mr-2" />
          <span>Recurso humano</span>
        </Button>}
        {veSolapa("maquinas") && <Button
          variant={tabActiva === "maquinas" ? "default" : "outline"}
          onClick={() => setTabActiva("maquinas")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "maquinas" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Factory className="h-4 w-4 mr-2" />
          <span>Recurso maquinaria</span>
        </Button>}
        {veSolapa("procesos") && <Button
          variant={tabActiva === "procesos" ? "default" : "outline"}
          onClick={() => setTabActiva("procesos")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "procesos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Layers className="h-4 w-4 mr-2" />
          <span>Procesos</span>
        </Button>}
        {veSolapa("rangos") && <Button
          variant={tabActiva === "rangos" ? "default" : "outline"}
          onClick={() => setTabActiva("rangos")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "rangos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Target className="h-4 w-4 mr-2" />
          <span>Rangos</span>
        </Button>}
        {veSolapa("sectores") && <Button
          variant={tabActiva === "sectores" ? "default" : "outline"}
          onClick={() => setTabActiva("sectores")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "sectores" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <MapPin className="h-4 w-4 mr-2" />
          <span>Sectores</span>
        </Button>}
        {veSolapa("planos") && <Button
          variant={tabActiva === "planos" ? "default" : "outline"}
          onClick={() => setTabActiva("planos")}
          className={`flex-1 min-w-0 h-auto min-h-9 has-[>svg]:px-2 sm:has-[>svg]:px-3 whitespace-normal leading-tight sm:whitespace-nowrap ${tabActiva === "planos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Ruler className="h-4 w-4 mr-2" />
          <span>Planos</span>
        </Button>}
      </div>

      {/* De qué aviso del plan se vino y qué había que hacer. Sólo en la solapa a la
          que apuntaba el aviso —en otra solapa hablaría de algo que no está a la vista—,
          salvo que esa solapa no se pueda ver: ahí es justamente lo que hay que decir. */}
      {desdeAviso && (desdeAviso.tab === tabActiva || !veSolapa(desdeAviso.tab)) && (
        <DesdeAviso
          titulo={desdeAviso.titulo}
          hacer={desdeAviso.hacer}
          hecho={desdeAviso.hecho}
          como={comoDelAviso}
          mostrando={desdeAviso.tab === tabActiva ? nombresDelFoco : []}
          total={totalDeLaSolapa}
          onVerTodos={verTodoSinFoco}
          onCerrar={cerrarDesdeAviso}
          sinAccesoA={veSolapa(desdeAviso.tab) ? null : NOMBRE_SOLAPA[desdeAviso.tab]}
        />
      )}

      {/* TABLA DE OPERARIOS */}
      {tabActiva === "operarios" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Recurso humano</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión del recurso humano</p>
          </div>

          {focoOperarios && !api.loading && operarios.length > 0 && operariosVisibles.length === 0 ? (
            <SinResultados
              que="personas"
              filtros={[{ etiqueta: "Solo lo del aviso del plan", onSacar: verTodoSinFoco }]}
              motivo="Las personas que nombraba el aviso ya no están en la lista: puede que las hayan dado de baja después de calcular el plan."
            />
          ) : (
          <SharedOperatorsList
            operarios={operariosVisibles}
            isLoading={api.loading}
            onView={handleVerOperario}
            onDelete={editaPersonas ? (op) => {
              setItemAEliminar({ tipo: "operario", id: op.id, nombre: `${op.nombre} ${op.apellido}` });
              setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
            } : undefined}
          />
          )}
        </div>
      )}

      {/* TABLA DE MAQUINAS */}
      {tabActiva === "maquinas" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Recurso maquinaria</h2>
              <div className="ml-auto">
                <ExportarMenu
                  titulo="Recurso maquinaria"
                  archivo="recurso_maquinaria"
                  filas={maquinasVisibles}
                  columnas={columnasMaquinas}
                  disabled={api.loading}
                  filtros={() => (focoMaquinas ? ["Solo las del aviso del plan"] : [])}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión del recurso maquinaria</p>

            {/* Aviso de las que no puede usar nadie. Va acá arriba porque es el tipo de
                hueco que no se nota mirando la lista: la máquina existe, está bien
                cargada, y aun así el planificador nunca se la asigna a nadie. */}
            {(() => {
              if (!coberturaListo) return null;
              const sinRango = maquinas.filter((m) => (rangosPorMaquina.get(m.id)?.length ?? 0) === 0);
              if (sinRango.length === 0) return null;
              return (
                <Alert className="mt-3 border-amber-200 bg-amber-50">
                  <AlertDescription className="text-amber-900 text-sm">
                    <span>
                      Hay <strong>{sinRango.length} de recurso maquinaria sin rango cargado</strong>, de{" "}
                      {maquinas.length} en total: el planificador no se lo asigna a nadie y el trabajo
                      sale “sin recurso maquinaria”. Son {sinRango.map((m) => m.nombre).join(", ")}.
                      Tocá el aviso de cada uno en la columna Rangos para cargarlo acá mismo.
                    </span>
                  </AlertDescription>
                </Alert>
              );
            })()}
          </div>

          {(api.loading || !maquinasCargadas) && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">Cargando el recurso maquinaria...</span>
            </div>
          )}

          {!api.loading && maquinasCargadas && maquinas.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg">No hay recurso maquinaria disponible</p>
            </div>
          )}

          {!api.loading && maquinasCargadas && maquinas.length > 0 && maquinasVisibles.length === 0 && (
            <SinResultados
              que="máquinas"
              filtros={[{ etiqueta: "Solo las del aviso del plan", onSacar: verTodoSinFoco }]}
              motivo="Las máquinas que nombraba el aviso ya no están en la lista: puede que las hayan borrado después de calcular el plan."
            />
          )}

          {!api.loading && maquinasCargadas && maquinasVisibles.length > 0 && (
            <>
              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Código</th>
                      {conoceEstado && (
                        <th
                          className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground"
                          title="Operativa, en mantenimiento o fuera de servicio. Tocá el estado de una fila para cambiarlo."
                        >
                          Estado
                        </th>
                      )}
                      {usoDelMes && (
                        <th
                          className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground whitespace-nowrap"
                          title="Horas de uso efectivas de este mes: las de la jornada del taller, sin pausas. Se registran solas al arrancar y terminar un paso con la máquina. El detalle, en el ojito."
                        >
                          Horas del mes
                        </th>
                      )}
                      <th
                        className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground"
                        title="Quién puede usar el recurso maquinaria. Sin rango, el planificador no se lo asigna a nadie."
                      >
                        Rangos
                      </th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Limitación</th>
                      <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {maquinasVisibles.map((maquina) => (
                      <React.Fragment key={maquina.id}>
                      <tr
                        id={`maquina-${maquina.id}`}
                        data-fila={`maquina-${maquina.id}`}
                        className={`hover:bg-muted/50 transition-colors ${esFoco("maquinas", maquina.id) ? RESALTE_FOCO : coberturaListo && (rangosPorMaquina.get(maquina.id)?.length ?? 0) === 0 ? "bg-amber-50/40" : ""}`}
                      >
                        <td className="px-4 py-2 text-sm font-medium">{maquina.nombre}</td>
                        <td className="px-4 py-2 text-sm">{maquina.cod_maquina || "-"}</td>
                        {conoceEstado && (
                          <td className="px-4 py-2 text-sm">
                            {editaMaquinas ? (
                              <EstadoMaquinaSelector
                                valor={maquina.estado_operativo}
                                nombre={maquina.nombre}
                                onCambiar={(nuevo) => void cambiarEstadoMaquina(maquina, nuevo)}
                              />
                            ) : (
                              <EstadoBadge valor={maquina.estado_operativo} />
                            )}
                          </td>
                        )}
                        {usoDelMes && (
                          <td className="px-4 py-2 text-sm text-right">
                            <span className="tabular-nums">{fmtHorasUso(usoDelMes.horas[String(maquina.id)]?.efectivo_min)}</span>
                            {(() => {
                              const chip = chipDeLaTabla(usoDelMes.mantenimiento?.[String(maquina.id)]);
                              return chip ? (
                                <span className={`mt-0.5 block w-fit ml-auto rounded-md border px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${chip.clase}`}>
                                  {chip.texto}
                                </span>
                              ) : null;
                            })()}
                          </td>
                        )}
                        {/* Rangos que habilitan la máquina. Sin ninguno, el planificador
                            no puede asignarla: queda fuera del dominio de todo proceso
                            que exija rangos y el trabajo sale "sin máquina". */}
                        <td className="px-4 py-2 text-sm">
                          {!coberturaListo ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (rangosPorMaquina.get(maquina.id)?.length ?? 0) > 0 && !editaRangos ? (
                            <span className="flex flex-wrap gap-1">
                              {rangosPorMaquina.get(maquina.id)!.map((r) => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                  {r.nombre}
                                </Badge>
                              ))}
                            </span>
                          ) : (rangosPorMaquina.get(maquina.id)?.length ?? 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => setMaquinaAbierta(maquinaAbierta === maquina.id ? null : maquina.id)}
                              className="flex flex-wrap gap-1 hover:opacity-70 transition-opacity"
                              title="Clic para editar qué rangos pueden usar este recurso maquinaria"
                            >
                              {rangosPorMaquina.get(maquina.id)!.map((r) => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                  {r.nombre}
                                </Badge>
                              ))}
                            </button>
                          ) : !editaRangos ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold">
                              Sin rango
                            </Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMaquinaAbierta(maquinaAbierta === maquina.id ? null : maquina.id)}
                              className="h-6 bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 text-xs font-semibold"
                              title="Sin rango cargado: el planificador no se lo asigna a nadie. Clic para cargarlo acá mismo."
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Sin rango — asignar
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {maquina.limitacion ? (
                            maquina.limitacion
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Sin limitación</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-2">
                            {/* El detalle existía y no había cómo abrirlo: es el único lugar
                                donde se ven capacidad, tipo y frecuencia de mantenimiento. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleVerMaquina(maquina)}
                              className="h-8 w-8"
                              title="Ver detalle"
                              aria-label={`Ver detalle de ${maquina.nombre}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {editaMaquinas && (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => handleEditar("maquina", maquina)} className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setItemAEliminar({ tipo: "maquina", id: maquina.id, nombre: maquina.nombre });
                                    setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                                  }}
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {maquinaAbierta === maquina.id && coberturaListo && editaRangos && (
                        <tr>
                          <td colSpan={(conoceEstado ? 6 : 5) + (usoDelMes ? 1 : 0)} className="p-0">
                            {editorRangosDeMaquina(maquina)}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vista Mobile - Tarjetas */}
              <div className="md:hidden divide-y">
                {maquinasVisibles.map((maquina) => (
                  <div
                    key={maquina.id}
                    data-fila={`maquina-${maquina.id}`}
                    className={`p-4 hover:bg-muted/50 transition-colors ${esFoco("maquinas", maquina.id) ? RESALTE_FOCO : ""}`}
                  >
                    <div className="mb-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-base min-w-0 break-words">{maquina.nombre}</h3>
                        {conoceEstado && (
                          <div className="shrink-0">
                            {editaMaquinas ? (
                              <EstadoMaquinaSelector
                                valor={maquina.estado_operativo}
                                nombre={maquina.nombre}
                                onCambiar={(nuevo) => void cambiarEstadoMaquina(maquina, nuevo)}
                              />
                            ) : (
                              <EstadoBadge valor={maquina.estado_operativo} />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Código:</span>
                          <span className="ml-2 font-medium">{maquina.cod_maquina || "-"}</span>
                        </div>
                        {usoDelMes && (
                          <div className="text-right">
                            <span className="text-muted-foreground">Este mes:</span>
                            <span className="ml-2 font-medium tabular-nums">{fmtHorasUso(usoDelMes.horas[String(maquina.id)]?.efectivo_min)}</span>
                          </div>
                        )}
                      </div>
                      {(() => {
                        const chip = usoDelMes ? chipDeLaTabla(usoDelMes.mantenimiento?.[String(maquina.id)]) : null;
                        return chip ? (
                          <span className={`mt-2 inline-block rounded-md border px-1.5 py-px text-[11px] font-medium ${chip.clase}`}>
                            {chip.texto}
                          </span>
                        ) : null;
                      })()}
                      <div className="mt-2 text-sm">
                        <span className="text-muted-foreground">Rangos:</span>
                        {!coberturaListo ? (
                          <span className="ml-2 text-muted-foreground text-xs">—</span>
                        ) : (rangosPorMaquina.get(maquina.id)?.length ?? 0) > 0 ? (
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {rangosPorMaquina.get(maquina.id)!.map((r) => (
                              <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                {r.nombre}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <Badge variant="outline" className="ml-2 bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold">
                            Sin rango
                          </Badge>
                        )}
                        {/* En el teléfono no había forma de cambiar los rangos: el editor
                            vivía sólo en la tabla de escritorio, y el aviso del plan que
                            trae acá ("agregale OFICIAL CNC") no se podía cumplir. */}
                        {coberturaListo && editaRangos && (
                          <button
                            type="button"
                            onClick={() => setMaquinaAbierta(maquinaAbierta === maquina.id ? null : maquina.id)}
                            className="ml-2 text-xs font-medium text-blue-700 underline underline-offset-2"
                          >
                            {maquinaAbierta === maquina.id ? "Cerrar" : "Cambiar"}
                          </button>
                        )}
                      </div>
                      {maquinaAbierta === maquina.id && coberturaListo && editaRangos && (
                        <div className="mt-2 -mx-4 border-y">{editorRangosDeMaquina(maquina)}</div>
                      )}
                      <div className="mt-2 text-sm">
                        <span className="text-muted-foreground">Limitación:</span>
                        <span className="ml-2 font-medium">
                          {maquina.limitacion || <span className="text-muted-foreground text-xs italic">Sin limitación</span>}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleVerMaquina(maquina)}
                        aria-label={`Ver detalle de ${maquina.nombre}`}
                        title="Ver detalle"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {editaMaquinas && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditar("maquina", maquina)}
                            className="flex-1"
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setItemAEliminar({ tipo: "maquina", id: maquina.id, nombre: maquina.nombre });
                              setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TABLA DE PROCESOS */}
      {tabActiva === "procesos" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Procesos</h2>
              <div className="ml-auto">
                <ExportarMenu
                  titulo="Procesos"
                  archivo="procesos"
                  filas={procesosFiltrados}
                  columnas={columnasProcesos}
                  disabled={api.loading}
                  filtros={() => [
                    ...(focoProcesos ? ["Solo lo del aviso del plan"] : []),
                    ...filtroBusqueda(busquedaProceso),
                    ...(soloProblemas ? ["Sólo los que frenan un plan"] : []),
                  ]}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión de procesos productivos</p>
          </div>

          <div className="p-4 md:p-6 border-b bg-muted/20">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar proceso..."
                  value={busquedaProceso}
                  onChange={(e) => setBusquedaProceso(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* El catálogo tiene cientos de procesos y los que traen problema son unas
                  decenas. Sin este filtro hay que encontrarlos a ojo, uno por uno. */}
              {coberturaListo && (() => {
                // Solo se cuentan los que están EN USO. El catálogo arrastra cientos de
                // procesos del legacy sin rango que no usa nadie: contarlos daba 272
                // "problemas" y el que de verdad frena un plan se perdía entre ellos.
                const conProblema = procesos.filter((p) => {
                  const c = porProceso.get(p.id);
                  return c && c.lineas_abiertas > 0 && !!problemaDelProceso(c);
                }).length;
                if (conProblema === 0) return null;
                return (
                  <Button
                    variant={soloProblemas ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSoloProblemas((v) => !v)}
                    className={soloProblemas ? "bg-amber-600 hover:bg-amber-700" : "border-amber-300 text-amber-800 hover:bg-amber-50"}
                    title="Procesos usados en OTs abiertas que no puede hacer nadie o que no tienen rango cargado"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                    {soloProblemas
                      ? "Viendo solo los que frenan un plan"
                      : `Ver los ${conProblema} que frenan un plan`}
                  </Button>
                );
              })()}
            </div>
          </div>

          {(api.loading || !procesosCargados) && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">Cargando procesos...</span>
            </div>
          )}

          {/* Vacía por un filtro: se dice cuál, por qué y cómo sacarlo. Era un «No se
              encontraron procesos» a secas, y llegando desde un aviso con el buscador
              cargado con un nombre que no coincidía se leía como una pantalla rota. */}
          {!api.loading && procesosCargados && procesosFiltrados.length === 0 && (
            <SinResultados
              que="procesos"
              filtros={filtrosProcesos}
              motivo={focoProcesosPerdido
                ? "El proceso que nombraba el aviso ya no está en el catálogo: puede que lo hayan borrado o reemplazado después de calcular el plan."
                : null}
            />
          )}

          {!api.loading && procesosCargados && procesosFiltrados.length > 0 && (
            <>
              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th
                        className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground"
                        title="Quién puede hacerlo. Sin rango se lo lleva cualquiera; con rangos que no tiene nadie, no lo hace nadie."
                      >
                        Quién puede hacerlo
                      </th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Descripción</th>
                      <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedProcesos.map((proceso) => {
                      const cob = porProceso.get(proceso.id);
                      const problema = coberturaListo && cob ? problemaDelProceso(cob) : null;
                      // Un problema en un proceso que no se usa no frena nada: se marca
                      // igual, pero sin gritar. Lo urgente es lo que está en una OT abierta.
                      const enUso = (cob?.lineas_abiertas ?? 0) > 0;
                      const sinRango = problema === "sin_rango";
                      const sinNadie = problema === "nadie";
                      return (
                      <React.Fragment key={proceso.id}>
                      <tr
                        id={`proceso-${proceso.id}`}
                        data-fila={`proceso-${proceso.id}`}
                        className={`hover:bg-muted/50 transition-colors ${esFoco("procesos", proceso.id) ? RESALTE_FOCO : enUso && sinNadie ? "bg-rose-50/50" : enUso && sinRango ? "bg-amber-50/40" : ""}`}
                      >
                        <td className="px-4 py-2 text-sm font-medium">{proceso.nombre}</td>
                        {/* La pregunta que importa de un proceso no es qué rangos tiene
                            cargados sino si hay alguien que pueda hacerlo. Se puede tener
                            tres rangos y que no los tenga ninguna persona disponible. */}
                        <td className="px-4 py-2 text-sm">
                          {/* `!cob` además de `!coberturaListo`: la cobertura se cachea a
                              nivel módulo, así que un proceso creado después de esa consulta
                              no está en el mapa. Sin este chequeo, la rama de abajo hacía
                              `cob!.rangos.map(...)` sobre undefined y la pestaña Procesos se
                              caía entera con un TypeError. */}
                          {!coberturaListo || !cob ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : !(editaRangos || editaProcesos) ? (
                            // RF-24: sin permiso para cambiar rangos ni máquinas, lo mismo
                            // que dice la fila pero sin el botón que abre los editores.
                            <span className="flex flex-wrap items-center gap-1 text-xs">
                              {sinNadie ? (
                                <span className={`font-semibold ${enUso ? "text-rose-800" : "text-muted-foreground"}`}>No lo puede hacer nadie</span>
                              ) : sinRango ? (
                                <span className={`font-semibold ${enUso ? "text-amber-800" : "text-muted-foreground"}`}>Sin rango</span>
                              ) : (
                                <>
                                  {cob.rangos.map((r) => (
                                    <Badge key={r.id} variant="outline" className="text-xs font-normal">{r.nombre}</Badge>
                                  ))}
                                  <span className="text-muted-foreground ml-1">{cob.habilitados} de recurso humano</span>
                                </>
                              )}
                            </span>
                          ) : sinNadie ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className={`h-6 text-xs font-semibold ${enUso ? "bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100" : "text-muted-foreground hover:bg-muted"}`}
                              title={`Pide ${cob!.rangos.map(r => r.nombre).join(" o ")}, y ningún recurso humano disponible lo tiene.${enUso ? ` Se usa en ${cob!.lineas_abiertas} línea(s) de OTs abiertas.` : " Hoy no se usa en ninguna OT abierta."} Clic para resolverlo acá mismo.`}
                            >
                              {enUso && <AlertTriangle className="h-3 w-3 mr-1" />}
                              No lo puede hacer nadie
                            </Button>
                          ) : sinRango ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className={`h-6 text-xs font-semibold ${enUso ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100" : "text-muted-foreground hover:bg-muted"}`}
                              title={`Sin rango cargado: el planificador se lo puede asignar a cualquiera, sepa hacerlo o no.${enUso ? ` Se usa en ${cob!.lineas_abiertas} línea(s) de OTs abiertas.` : " Hoy no se usa en ninguna OT abierta."} Clic para cargarlo acá mismo.`}
                            >
                              {enUso && <AlertTriangle className="h-3 w-3 mr-1" />}
                              Sin rango — asignar
                            </Button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className="flex flex-wrap items-center gap-1 hover:opacity-70 transition-opacity"
                              title="Clic para editar qué rangos lo habilitan"
                            >
                              {cob!.rangos.map((r) => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">{r.nombre}</Badge>
                              ))}
                              <span className="text-xs text-muted-foreground ml-1">
                                {cob!.habilitados} de recurso humano
                                {cob!.por_habilidad_manual > 0 && ` (${cob!.por_habilidad_manual} a mano)`}
                              </span>
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm">{proceso.descripcion || "-"}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-2">
                            {editaProcesos && (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => handleEditar("proceso", proceso)} className="h-8 w-8">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setItemAEliminar({ tipo: "proceso", id: proceso.id, nombre: proceso.nombre });
                                    setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                                  }}
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {procesoAbierto === proceso.id && coberturaListo && (editaRangos || editaProcesos) && (
                        <tr>
                          <td colSpan={4} className="p-0">
                            {editoresDeProceso(proceso)}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Vista Mobile - Tarjetas */}
              <div className="md:hidden divide-y">
                {paginatedProcesos.map((proceso) => (
                  <div
                    key={proceso.id}
                    data-fila={`proceso-${proceso.id}`}
                    className={`p-4 hover:bg-muted/50 transition-colors ${esFoco("procesos", proceso.id) ? RESALTE_FOCO : ""}`}
                  >
                    <div className="mb-3">
                      <h3 className="font-semibold text-base mb-2">{proceso.nombre}</h3>
                      {proceso.descripcion && (
                        <div className="text-sm text-muted-foreground">
                          {proceso.descripcion}
                        </div>
                      )}
                    </div>

                    {/* Quién lo hace y en qué máquina, también en el teléfono. Hasta ahora
                        los editores vivían sólo en la tabla de escritorio: el aviso del plan
                        traía hasta acá y no había con qué hacer lo que pedía. */}
                    {coberturaListo && (editaRangos || editaProcesos) && (
                      <div className="mb-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                        >
                          <Layers className="h-4 w-4 mr-1" />
                          {procesoAbierto === proceso.id ? "Cerrar" : "Quién puede hacerlo y en qué máquina"}
                        </Button>
                        {procesoAbierto === proceso.id && (
                          <div className="mt-2 -mx-4 border-y">{editoresDeProceso(proceso)}</div>
                        )}
                      </div>
                    )}

                    {editaProcesos && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditar("proceso", proceso)}
                        className="flex-1"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setItemAEliminar({ tipo: "proceso", id: proceso.id, nombre: proceso.nombre });
                          setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Pagination Controls */}
          {!api.loading && totalProcesosPages > 1 && (
            <div className="flex items-center justify-center gap-4 py-4 border-t">
              <Button
                onClick={handleProcesosPrevious}
                disabled={currentProcesosPage === 1}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-gray-300 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </Button>
              <span className="text-sm font-medium text-gray-600">
                Página {currentProcesosPage} de {totalProcesosPages}
              </span>
              <Button
                onClick={handleProcesosNext}
                disabled={currentProcesosPage === totalProcesosPages}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-gray-300 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* TABLA DE RANGOS */}
      {tabActiva === "rangos" && (
        <CatalogoSimple
          soloLectura={!editaRangos}
          resource="rangos"
          singular="Rango"
          titulo="Rangos"
          descripcion="Clic en un rango para ver y editar qué procesos y qué recurso maquinaria habilita."
          icon={<Target className="h-5 w-5 text-muted-foreground" />}
          renderBadge={(rango) => {
            const cob = porRango.get(rango.id);
            if (!cob) return null;
            return (
              <span className="flex items-center gap-1.5">
                {cob.maquinas.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                    title={cob.maquinas.map((m) => m.nombre).join(", ")}
                  >
                    {cob.maquinas.length} de recurso maquinaria
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold"
                    title="Este rango no habilita ningún recurso maquinaria. Quien lo tenga solo puede tomar procesos manuales."
                  >
                    Sin recurso maquinaria
                  </Badge>
                )}
                {cob.operarios === 0 && (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold"
                    title="Nadie tiene este rango: los procesos y el recurso maquinaria que solo él habilita quedan sin candidatos."
                  >
                    Sin recurso humano
                  </Badge>
                )}
              </span>
            );
          }}
          renderExpanded={(rango) => (
            <RangoComposicion idRango={rango.id} nombreRango={rango.nombre} />
          )}
          columnasExport={[
            {
              titulo: "Recurso maquinaria",
              valor: (rango) => (porRango.get(rango.id)?.maquinas ?? []).map((m) => m.nombre).join(", "),
            },
            {
              titulo: "Recurso humano con el rango",
              tipo: "entero",
              valor: (rango) => porRango.get(rango.id)?.operarios ?? null,
            },
          ]}
        />
      )}

      {/* TABLA DE SECTORES */}
      {tabActiva === "sectores" && (
        <CatalogoSimple
          soloLectura={!editaSolapa("sectores")}
          resource="sectores"
          singular="Sector"
          titulo="Sectores"
          descripcion="Gestión de sectores del taller (donde se asignan las OTs)."
          icon={<MapPin className="h-5 w-5 text-muted-foreground" />}
        />
      )}

      {/* BIBLIOTECA DE PLANOS */}
      {tabActiva === "planos" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <Ruler className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Planos</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Todos los planos cargados, buscables por código de producto.
            </p>
          </div>

          {/* Sin el encabezado propio de la biblioteca: acá arriba ya hay un título
              "Planos" y el componente trae otro igual, así que quedaban dos encimados y
              parecían dos pantallas metidas una adentro de la otra. Apagado, deja solo
              su barra de buscador + Subir plano + Actualizar. */}
          <div className="p-4 md:p-6">
            <BibliotecaPlanos conEncabezado={false} />
          </div>
        </div>
      )}

      {/* DIÁLOGOS */}
      {/* Borrar en dos pasos: la primera pasada pregunta y el backend contesta QUÉ se
          lleva puesto; la segunda ejecuta. Es el mismo trato que ya tenían los rangos
          y los sectores en CatalogoSimple, que acá faltaba. */}
      <Dialog
        open={mostrarDialogo.eliminar}
        onOpenChange={(open) => {
          setMostrarDialogo({ ...mostrarDialogo, eliminar: open });
          if (!open) { setMotivoBorrado(null); setItemAEliminar(null); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {motivoBorrado ? "¿Eliminar igual?" : "Confirmar eliminación"}
            </DialogTitle>
            <DialogDescription>
              ¿Eliminar <strong>{itemAEliminar?.nombre}</strong>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {motivoBorrado && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900">{motivoBorrado}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={borrando}
              onClick={() => { setMostrarDialogo({ ...mostrarDialogo, eliminar: false }); setMotivoBorrado(null); }}
            >
              Cancelar
            </Button>
            <Button variant="destructive" disabled={borrando} onClick={handleEliminar}>
              {borrando ? "Eliminando…" : motivoBorrado ? "Eliminar igual" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperarioForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "operarios"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Operario}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={async () => {
          await fetchOperarios();
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
        }}
        cleanUrl={cleanUrl}
      />

      <MaquinaForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "maquinas"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Maquina}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={(guardada) => {
          // Lo guardado se pone en la fila al toque y la lista se refresca por detrás, sin
          // el spinner que la tapaba entera cada vez que se editaba una máquina.
          aplicarMaquinaGuardada(guardada);
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
          void refrescarMaquinasSinSpinner();
        }}
        cleanUrl={cleanUrl}
        conoceEstado={conoceEstado}
      />

      <ProcesoForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "procesos"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Proceso}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={async () => {
          await fetchProcesos();
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
        }}
        cleanUrl={cleanUrl}
      />

      <DetalleOperario
        key={operarioSeleccionado?.id}
        operario={operarioSeleccionado}
        tasks={operatorTasks}
        onClose={() => setOperarioSeleccionado(null)}
        onCambiarEstado={(operario: Operario) => handleCambiarEstado(operario)}
        onOperatorUpdated={() => {
          fetchOperarios();
          if (operarioSeleccionado) handleVerOperario(operarioSeleccionado);
        }}
      />

      <DetalleMaquina
        maquina={maquinaSeleccionada}
        onClose={() => setMaquinaSeleccionada(null)}
        onEditar={editaMaquinas ? (m) => {
          setMaquinaSeleccionada(null);
          void handleEditar("maquina", m);
        } : undefined}
        edita={editaMaquinas}
        onMantenimiento={(d) => {
          // La frecuencia es un dato de la máquina (RF-08): la fila y el detalle la
          // muestran como quedó. Y el estado del mantenimiento de la tabla, en silencio.
          setMaquinas((prev) => prev.map((m) => (m.id === d.id_maquinaria
            ? { ...m, frecuencia_mantenimiento_dias: d.config.frecuencia_dias } : m)));
          setMaquinaSeleccionada((sel) => (sel && sel.id === d.id_maquinaria
            ? { ...sel, frecuencia_mantenimiento_dias: d.config.frecuencia_dias } : sel));
          void pedirUsoDelMes();
        }}
      />

      <CambiarEstado
        operario={operarioCambiarEstado as Operario}
        open={mostrarDialogo.cambiarEstado}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: false })}
        onSuccess={async () => {
          await fetchOperarios();
          setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: false });
        }}
        cleanUrl={cleanUrl}
      />
    </div>
  );
}
