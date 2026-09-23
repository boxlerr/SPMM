"use client";

/**
 * Configuración › Copias de seguridad (RF-19). Sólo el administrador.
 *
 * Tres cosas, de arriba abajo:
 *
 *  1. Descargar: un archivo con TODOS los datos del sistema. Los archivos de los planos
 *     no vienen (viven en Supabase Storage) y eso se dice acá, no en letra chica.
 *  2. Restaurar: se elige el archivo, el servidor lo revisa entero SIN tocar nada y
 *     muestra qué pasaría tabla por tabla (y, con los usuarios, cuenta por cuenta);
 *     recién ahí se confirma escribiendo RESTAURAR (que el servidor vuelve a exigir).
 *     Una copia sin la firma de este servidor se avisa y se confirma aparte. Antes de
 *     pisar nada, el servidor guarda sola una copia de cómo está todo; si no puede, pide
 *     que la bajes vos en ese momento, desde acá: la pantalla le manda la huella (sha256)
 *     del archivo que recibió entero, y el servidor comprueba que sea ése y que nadie
 *     haya guardado nada después.
 *  3. Las copias que se guardaron solas antes de cada restauración: con una de ésas se
 *     deshace una restauración.
 *
 * Todo lo que decide qué se puede y qué no está en el backend
 * (infrastructure/copias_de_seguridad.py y presentation/CopiaSeguridadAPI.py). Acá se
 * muestra y se pregunta.
 *
 * Con un backend de antes de RF-19 (404) es un aviso chico y nada más: la solapa nunca
 * rompe Configuración.
 *
 * Las descargas van con fetch y blob, no con un `<a href>`: la dirección pide token y un
 * link pelado se come un 401 (mismo camino que la descarga de planos y el CSV de no
 * conformidades).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArchiveRestore, CheckCircle2, DatabaseBackup, Download, FileArchive,
  History, Info, Loader2, RefreshCw, ShieldAlert, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn, parseApiError } from "@/lib/utils";
import { usePermisos } from "@/hooks/usePermisos";
import {
  ACCIONES,
  CONFIRMACION,
  type CopiaAutomatica,
  type EstadoCopias,
  type ResultadoRestauracion,
  type TablaDeLaVista,
  type VistaPrevia,
  cambia,
  estaFirmada,
  fechaLegible,
  hexDeBytes,
  motivoParaNoRestaurar,
  nombreDeLaCabecera,
  ordenarParaMostrar,
  nombrePorDefecto,
  numero,
  tamanoLegible,
} from "@/lib/copiasDeSeguridad";

/** Sólo el token: el Content-Type del FormData lo pone el navegador, con su boundary. */
const cabeceras = (): HeadersInit => {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function motivoDelError(res: Response): Promise<{ mensaje: string; campo?: string }> {
  const texto = await res.text().catch(() => "");
  let campo: string | undefined;
  try {
    campo = JSON.parse(texto)?.errors?.[0]?.campo;
  } catch {
    // no era JSON
  }
  const mensaje = parseApiError(texto);
  if (mensaje) return { mensaje, campo };
  if (res.status === 413) {
    return { mensaje: "El archivo es demasiado grande para subirlo desde la app." };
  }
  if (res.status === 403) return { mensaje: "Sólo el administrador puede hacer esto." };
  return { mensaje: `El servidor contestó ${res.status}. Probá de nuevo en un rato.` };
}

/** El sha256 del archivo bajado, o null si el navegador no sabe calcularlo. */
async function huellaDe(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    return hexDeBytes(await subtle.digest("SHA-256", await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

function guardarEnLaCompu(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

type Carga = "cargando" | "listo" | "sin_servidor" | "error";

export default function CopiasDeSeguridad() {
  const { refrescarPermisos } = usePermisos();

  const [carga, setCarga] = useState<Carga>("cargando");
  const [estado, setEstado] = useState<EstadoCopias | null>(null);
  const [automaticas, setAutomaticas] = useState<CopiaAutomatica[] | null>(null);

  // Descargas: cuánto va bajado, para que una copia grande no parezca colgada.
  const [bajando, setBajando] = useState<{ que: string; bytes: number } | null>(null);
  const [ultimaDescarga, setUltimaDescarga] = useState<
    { nombre: string; hora: string; huella: string | null } | null
  >(null);

  // Restaurar.
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [incluirUsuarios, setIncluirUsuarios] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [errorRevision, setErrorRevision] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [yaDescargo, setYaDescargo] = useState(false);
  const [pideDescarga, setPideDescarga] = useState(false);
  const [aceptaSinFirma, setAceptaSinFirma] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [errorRestauracion, setErrorRestauracion] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoRestauracion | null>(null);

  const cargarAutomaticas = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/backups/automaticas`, { headers: cabeceras() });
      if (!res.ok) {
        setAutomaticas(null);
        return;
      }
      const json = await res.json();
      setAutomaticas(Array.isArray(json?.data?.copias) ? json.data.copias : []);
    } catch {
      setAutomaticas(null);
    }
  }, []);

  const cargar = useCallback(async () => {
    setCarga("cargando");
    try {
      const res = await fetch(`${API_URL}/backups/estado`, { headers: cabeceras() });
      // Backend de antes de RF-19: la ruta no existe.
      if (res.status === 404 || res.status === 405) {
        setCarga("sin_servidor");
        return;
      }
      if (!res.ok) {
        setCarga("error");
        return;
      }
      const json = await res.json();
      if (!json?.data) {
        setCarga("error");
        return;
      }
      setEstado(json.data as EstadoCopias);
      setCarga("listo");
      if (json.data.copia_automatica?.disponible) void cargarAutomaticas();
    } catch {
      setCarga("error");
    }
  }, [cargarAutomaticas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ─────────────── descargar ───────────────

  const descargar = async (ruta: string, que: string, nombreSugerido?: string) => {
    if (bajando) return;
    setBajando({ que, bytes: 0 });
    try {
      const res = await fetch(`${API_URL}${ruta}`, { headers: cabeceras() });
      if (!res.ok) throw new Error((await motivoDelError(res)).mensaje);
      const nombre =
        nombreDeLaCabecera(res.headers.get("content-disposition")) ??
        nombreSugerido ??
        nombrePorDefecto(new Date());

      // Se junta de a pedazos para ir mostrando cuánto va. Si la conexión se corta a
      // la mitad, read() revienta y no se guarda un .zip trunco.
      const partes: Uint8Array[] = [];
      let bytes = 0;
      let mostrado = 0;
      const lector = res.body?.getReader();
      if (lector) {
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          if (value) {
            partes.push(value);
            bytes += value.length;
            if (bytes - mostrado > 256 * 1024) {
              mostrado = bytes;
              setBajando({ que, bytes });
            }
          }
        }
      } else {
        partes.push(new Uint8Array(await res.arrayBuffer()));
      }
      const archivoBajado = new Blob(partes as BlobPart[], { type: "application/zip" });
      guardarEnLaCompu(archivoBajado, nombre);
      if (ruta === "/backups/descargar") {
        const ahora = new Date();
        setUltimaDescarga({
          nombre,
          hora: `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`,
          // Lo que se manda al restaurar para probar que es ESTE archivo, entero.
          huella: await huellaDe(archivoBajado),
        });
        // Si la restauración estaba esperando esta descarga, queda marcada: el servidor
        // igual comprueba que sea este archivo, entero, y que nadie guardó nada después.
        if (pideDescarga || (vista && !vista.copia_automatica.disponible)) setYaDescargo(true);
      }
      toast.success(`Listo: se descargó ${nombre}`);
    } catch (e) {
      const mensaje = e instanceof Error && e.message ? e.message : "revisá la conexión";
      toast.error(`No se pudo descargar la copia: ${mensaje}`);
    } finally {
      setBajando(null);
    }
  };

  // ─────────────── restaurar ───────────────

  const olvidarVista = () => {
    setVista(null);
    setConfirmacion("");
    setErrorRestauracion(null);
    setPideDescarga(false);
    setAceptaSinFirma(false);
    setVerTodas(false);
  };

  const elegirArchivo = (f: File | null) => {
    setArchivo(f);
    setErrorRevision(null);
    setResultado(null);
    olvidarVista();
  };

  const revisar = async () => {
    if (!archivo || !estado) return;
    const limite = estado.limite_subida_mb * 1024 * 1024;
    if (archivo.size > limite) {
      setErrorRevision(
        `El archivo pesa ${tamanoLegible(archivo.size)} y el máximo para restaurar desde la app es ` +
          `${estado.limite_subida_mb} MB.`,
      );
      return;
    }
    setRevisando(true);
    setErrorRevision(null);
    setResultado(null);
    olvidarVista();
    try {
      const datos = new FormData();
      datos.append("archivo", archivo);
      datos.append("incluir_usuarios", incluirUsuarios ? "true" : "false");
      const res = await fetch(`${API_URL}/backups/revisar`, {
        method: "POST",
        headers: cabeceras(),
        body: datos,
      });
      if (!res.ok) {
        setErrorRevision((await motivoDelError(res)).mensaje);
        return;
      }
      const json = await res.json();
      setVista(json.data as VistaPrevia);
      setYaDescargo(false);
    } catch {
      setErrorRevision("No se pudo mandar el archivo al servidor. Revisá la conexión y probá de nuevo.");
    } finally {
      setRevisando(false);
    }
  };

  const restaurar = async () => {
    if (!archivo || !vista) return;
    setRestaurando(true);
    setErrorRestauracion(null);
    try {
      const datos = new FormData();
      datos.append("archivo", archivo);
      datos.append("huella", vista.archivo.huella);
      datos.append("confirmacion", confirmacion.trim());
      datos.append("incluir_usuarios", vista.incluir_usuarios ? "true" : "false");
      datos.append("ya_descargue_la_copia_actual", yaDescargo ? "true" : "false");
      datos.append("huella_copia_actual", yaDescargo ? (ultimaDescarga?.huella ?? "") : "");
      datos.append("aceptar_copia_sin_firma", aceptaSinFirma ? "true" : "false");
      const res = await fetch(`${API_URL}/backups/restauracion`, {
        method: "POST",
        headers: cabeceras(),
        body: datos,
      });
      if (!res.ok) {
        const { mensaje, campo } = await motivoDelError(res);
        if (campo === "huella") {
          // Cambió el archivo entre la revisión y la confirmación: hay que revisarlo otra vez.
          olvidarVista();
          setErrorRevision(mensaje);
          return;
        }
        if (campo === "copia_previa") {
          setPideDescarga(true);
          // La que había bajado ya no sirve (o no la había bajado): hay que bajarla de
          // nuevo, y al bajarla la casilla se vuelve a marcar sola.
          setYaDescargo(false);
        }
        setErrorRestauracion(mensaje);
        return;
      }
      const json = await res.json();
      setResultado(json.data as ResultadoRestauracion);
      toast.success("Listo: se restauró la copia.");
      if (vista.incluir_usuarios) refrescarPermisos();
      setArchivo(null);
      if (entradaArchivo.current) entradaArchivo.current.value = "";
      olvidarVista();
      if (estado?.copia_automatica.disponible) void cargarAutomaticas();
    } catch {
      setErrorRestauracion(
        "Se cortó la conexión con el servidor mientras restauraba. Si terminó, lo vas a ver en la " +
          "Auditoría; si no, la base quedó como estaba. Esperá un minuto antes de volver a probar.",
      );
    } finally {
      setRestaurando(false);
    }
  };

  // ─────────────── pantalla ───────────────

  if (carga === "cargando") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  if (carga === "sin_servidor") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Las copias de seguridad todavía no están disponibles: falta actualizar el servidor.
      </div>
    );
  }

  if (carga === "error" || !estado) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>No se pudo abrir esta parte. Revisá la conexión y probá de nuevo.</span>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <RefreshCw className="h-4 w-4" /> Reintentar
        </Button>
      </div>
    );
  }

  const hayAutomatica = vista?.copia_automatica.disponible ?? estado.copia_automatica.disponible;
  const firmada = estaFirmada(vista);
  const motivo = vista
    ? motivoParaNoRestaurar({
        confirmacion,
        hayCopiaAutomatica: hayAutomatica && !pideDescarga,
        yaDescargo,
        huellaDeLaDescarga: ultimaDescarga?.huella ?? null,
        firmaValida: firmada,
        aceptaSinFirma,
      })
    : null;
  const cambiosDeCuentas = vista?.incluir_usuarios ? (vista.cambios_de_usuarios ?? []) : [];
  const tablasQueCambian = ordenarParaMostrar(vista?.tablas.filter(cambia) ?? []);
  const tablasQueNo = ordenarParaMostrar(vista?.tablas.filter((t) => !cambia(t)) ?? []);
  const minutos = estado.minutos_descarga_manual;
  const botonDescargar = (
    <Button
      onClick={() => void descargar("/backups/descargar", "copia")}
      disabled={!!bajando}
      className="bg-[#DC143C] hover:bg-[#B01030] text-white"
    >
      {bajando?.que === "copia" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {bajando?.que === "copia"
        ? bajando.bytes
          ? `Bajando… ${tamanoLegible(bajando.bytes)}`
          : "Armando la copia…"
        : "Descargar copia completa"}
    </Button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-[#DC143C]" /> Copias de seguridad
        </h3>
        <p className="text-sm text-gray-500">
          Una copia de seguridad es un archivo con todos los datos del sistema, tal como están en el
          momento de bajarla. Sirve para guardarla aparte y, si algo sale mal, volver a como estaba todo
          ese día. Esta parte la ve sólo el administrador.
        </p>
      </div>

      {/* ── 1. Descargar ── */}
      <section className="rounded-lg border border-gray-200 p-4 sm:p-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <Download className="h-4 w-4 text-gray-600" /> Descargar una copia
            </h4>
            <p className="text-sm text-gray-600 mt-1">
              Baja un archivo <span className="font-mono text-xs">spmm_backup_….zip</span> con todo: órdenes,
              pasos y plan, clientes, artículos, materia prima, personas, máquinas, categorías, no
              conformidades, notificaciones, usuarios y la auditoría.
            </p>
          </div>
          <div className="shrink-0">{botonDescargar}</div>
        </div>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 flex gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Los archivos de los planos (PDF, dibujos) no vienen en la copia.</strong> Quedan guardados
            aparte, en el almacenamiento de Supabase. La copia trae la lista de planos y dónde está cada
            archivo, pero no los archivos.
          </span>
        </div>
        <p className="text-xs text-gray-500 flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Guardala en un lugar seguro: no trae contraseñas, pero sí todos los datos del taller y de las
          personas. Cada descarga queda anotada en la Auditoría, también si se corta a la mitad.
        </p>
        {ultimaDescarga && (
          <p className="text-xs text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Descargaste {ultimaDescarga.nombre} a las {ultimaDescarga.hora}.
          </p>
        )}
      </section>

      {/* ── 2. Restaurar ── */}
      <section className="rounded-lg border border-gray-200 p-4 sm:p-5 space-y-4">
        <div>
          <h4 className="font-semibold text-gray-900 flex items-center gap-2">
            <ArchiveRestore className="h-4 w-4 text-gray-600" /> Restaurar una copia
          </h4>
          <p className="text-sm text-gray-600 mt-1">
            Vuelve todo a como estaba en la copia. Primero se revisa el archivo y se muestra qué va a pasar;
            no se toca nada hasta que confirmes.
          </p>
        </div>

        {/* Paso 1: elegir el archivo */}
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={entradaArchivo}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              onClick={() => entradaArchivo.current?.click()}
              disabled={revisando || restaurando}
            >
              <Upload className="h-4 w-4" /> {archivo ? "Elegir otro archivo" : "Elegir el archivo de la copia"}
            </Button>
            {archivo && (
              <span className="text-sm text-gray-700 flex items-center gap-1.5 min-w-0">
                <FileArchive className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="truncate">{archivo.name}</span>
                <span className="text-gray-400 shrink-0">({tamanoLegible(archivo.size)})</span>
              </span>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <Checkbox
              checked={incluirUsuarios}
              onCheckedChange={(v) => {
                setIncluirUsuarios(v === true);
                // La revisión es para una opción: si cambia, hay que revisar de nuevo.
                olvidarVista();
              }}
              disabled={revisando || restaurando}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Incluir también los usuarios, roles y permisos</span>{" "}
              <span className="text-gray-500">(avanzado)</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Sin marcar, los usuarios y sus permisos quedan como están hoy. Marcado, vuelven los de la copia,
                pero nadie vuelve a una contraseña vieja ni se reactiva ninguna cuenta; tu cuenta y la de los
                administradores permanentes quedan como están. Antes de confirmar vas a ver qué pasa con cada
                cuenta. Sólo con una copia hecha por este sistema. La auditoría no se restaura nunca.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void revisar()} disabled={!archivo || revisando || restaurando}>
              {revisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
              {revisando ? "Revisando el archivo…" : "Revisar la copia"}
            </Button>
            <span className="text-xs text-gray-500">Hasta {estado.limite_subida_mb} MB.</span>
          </div>

          {errorRevision && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {errorRevision}
                {/* Casi todos los motivos del servidor ya lo dicen; si no, se agrega. */}
                {!/no se tocó nada/i.test(errorRevision) && (
                  <span className="block text-xs mt-1">No se tocó nada.</span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Paso 2: lo que va a pasar */}
        {vista && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-gray-900">
                Copia del <strong>{fechaLegible(vista.copia.generada_en)}</strong>
                {vista.copia.generada_por ? <>, hecha por {vista.copia.generada_por}</> : null}.
              </p>
              <p className="text-xs text-gray-500 break-all">
                {vista.archivo.nombre} · {tamanoLegible(vista.archivo.tamano)} · el archivo está sano y
                completo.
              </p>
            </div>

            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">
                  Todo lo que se cargó o cambió después del {fechaLegible(vista.copia.generada_en)} se pierde.
                </p>
                <p>
                  {tablasQueCambian.length} {tablasQueCambian.length === 1 ? "tabla vuelve" : "tablas vuelven"} a
                  como estaban: hoy tienen {numero(vista.resumen.filas_actuales)} filas y la copia trae{" "}
                  {numero(vista.resumen.filas_copia)}.{" "}
                  {vista.incluir_usuarios
                    ? "Los usuarios, roles y permisos también vuelven a los de la copia (mirá abajo qué pasa con cada cuenta). La auditoría no se toca."
                    : "Los usuarios, roles y permisos no se tocan, y la auditoría tampoco."}
                </p>
                <p className="text-xs">
                  Si después de la copia se borró algún plano, puede que su archivo ya no esté: la copia no trae
                  archivos.
                </p>
              </div>
            </div>

            {/* Tabla por tabla. En el teléfono cada una es un renglón que baja. */}
            <div className="rounded-md border border-gray-200 overflow-hidden">
              <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_7rem_9rem] gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                <span>Qué</span>
                <span className="text-right">Ahora</span>
                <span className="text-right">En la copia</span>
                <span>Qué pasa</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {(verTodas ? [...tablasQueCambian, ...tablasQueNo] : tablasQueCambian).map((t) => (
                  <FilaDeTabla key={t.tabla} t={t} />
                ))}
              </ul>
              {tablasQueNo.length > 0 && (
                <button
                  type="button"
                  onClick={() => setVerTodas((v) => !v)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 border-t border-gray-100"
                >
                  {verTodas
                    ? "Ocultar las que no se tocan"
                    : `Ver también las ${tablasQueNo.length} que no se tocan`}
                </button>
              )}
            </div>

            {!firmada && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
                <p className="font-medium flex gap-2">
                  <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  Esta copia no se puede comprobar.
                </p>
                <p>{vista.firma?.motivo}</p>
                <p className="text-xs">
                  Si la bajaste vos de este sistema y nadie la abrió, puede ser que haya cambiado la clave del
                  servidor. Con una copia así, los usuarios y sus permisos nunca se restauran.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={aceptaSinFirma}
                    onCheckedChange={(v) => setAceptaSinFirma(v === true)}
                    disabled={restaurando}
                    className="mt-0.5"
                  />
                  <span>Entiendo el riesgo: restaurar igual los datos de esta copia.</span>
                </label>
              </div>
            )}

            {cambiosDeCuentas.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <p className="font-medium mb-1">Qué pasa con las cuentas</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {cambiosDeCuentas.map((c, i) => (
                    <li key={i} className="break-words">{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {vista.avisos.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <p className="font-medium mb-1">Para tener en cuenta</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {vista.avisos.map((a, i) => (
                    <li key={i} className="break-words">{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* La copia de cómo está todo ahora */}
            {hayAutomatica && !pideDescarga ? (
              <p className="text-sm text-emerald-800 flex gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Antes de tocar nada se guarda sola una copia de cómo está todo ahora, en{" "}
                  {vista.copia_automatica.donde}. Si algo sale mal, con esa se vuelve atrás (abajo, en «Copias
                  guardadas antes de restaurar»).
                </span>
              </p>
            ) : (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
                <p>
                  {pideDescarga
                    ? "No se pudo guardar sola la copia de cómo está todo ahora."
                    : "No hay dónde guardar sola una copia de cómo está todo ahora."}{" "}
                  Antes de restaurar, descargala vos desde acá (en los últimos {minutos} minutos) y marcá la casilla.
                  Si alguien guarda algo después de que la bajes, el sistema te va a pedir que la bajes de nuevo:
                  así no se pierde nada.
                </p>
                <div>{botonDescargar}</div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={yaDescargo}
                    onCheckedChange={(v) => setYaDescargo(v === true)}
                    className="mt-0.5"
                  />
                  <span>Ya descargué la copia completa de cómo está todo ahora.</span>
                </label>
              </div>
            )}

            {/* Confirmar */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-700" htmlFor="confirmar-restaurar">
                Para confirmar, escribí <strong className="font-mono">{CONFIRMACION}</strong>:
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="confirmar-restaurar"
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={restaurando}
                  className="sm:max-w-[14rem] font-mono"
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => void restaurar()}
                    disabled={!!motivo || restaurando}
                  >
                    {restaurando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                    {restaurando ? "Restaurando…" : "Restaurar esta copia"}
                  </Button>
                  <Button variant="ghost" onClick={olvidarVista} disabled={restaurando}>
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                </div>
              </div>
              {restaurando ? (
                <p className="text-xs text-gray-500">
                  Puede tardar un minuto. No cierres esta pantalla. Mientras tanto, el resto del sistema espera.
                </p>
              ) : motivo ? (
                <p className="text-xs text-gray-500">{motivo}</p>
              ) : null}
            </div>

            {errorRestauracion && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-words">{errorRestauracion}</span>
              </div>
            )}
          </div>
        )}

        {/* Paso 3: cómo quedó */}
        {resultado && <Resultado resultado={resultado} />}
      </section>

      {/* ── 3. Las automáticas ── */}
      {estado.copia_automatica.disponible && (
        <section className="rounded-lg border border-gray-200 p-4 sm:p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                <History className="h-4 w-4 text-gray-600" /> Copias guardadas antes de restaurar
              </h4>
              <p className="text-sm text-gray-600 mt-1">
                Cada vez que se restaura, antes se guarda sola una copia de cómo estaba todo. Para deshacer una
                restauración: descargá la de ese momento y restaurala acá arriba.
                {estado.copia_automatica.quedan
                  ? ` Quedan las últimas ${estado.copia_automatica.quedan}: al guardar una nueva, la más vieja se borra sola.`
                  : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void cargarAutomaticas()} className="shrink-0 self-start">
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
          </div>
          {automaticas === null ? (
            <p className="text-sm text-gray-500">No se pudo leer la lista. Probá con «Actualizar».</p>
          ) : automaticas.length === 0 ? (
            <p className="text-sm text-gray-500">Todavía no hay ninguna: se guarda la primera cuando se restaure una copia.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {automaticas.map((c) => (
                <li key={c.nombre} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">Antes de restaurar, el {fechaLegible(c.fecha)}</p>
                    <p className="text-xs text-gray-500 break-all">
                      {c.nombre}
                      {c.tamano != null ? ` · ${tamanoLegible(c.tamano)}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start sm:self-auto"
                    disabled={!!bajando}
                    onClick={() =>
                      void descargar(
                        `/backups/automaticas/${encodeURIComponent(c.nombre)}/descargar`,
                        c.nombre,
                        c.nombre,
                      )
                    }
                  >
                    {bajando?.que === c.nombre ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {bajando?.que === c.nombre && bajando.bytes ? tamanoLegible(bajando.bytes) : "Descargar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function FilaDeTabla({ t }: { t: TablaDeLaVista }) {
  const accion = ACCIONES[t.accion];
  const color = !accion?.cambia
    ? "bg-gray-100 text-gray-600"
    : t.accion === "vacia"
      ? "bg-amber-100 text-amber-800"
      : "bg-rose-100 text-rose-800";
  // Donde la cantidad cambia, se nota: es lo primero que uno busca («¿cuántas órdenes pierdo?»).
  const distinta = !!accion?.cambia && (t.filas_copia ?? 0) !== t.filas_actuales;
  const numeros = distinta ? "text-gray-900 font-semibold" : "text-gray-600";
  return (
    <li className="px-3 py-2 text-sm grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem] sm:items-center">
      <span className="col-span-2 sm:col-span-1 text-gray-900 break-words">{t.nombre}</span>
      <span className={cn(numeros, "sm:text-right")}>
        <span className="sm:hidden text-xs text-gray-400 font-normal">Ahora: </span>
        {numero(t.filas_actuales)}
      </span>
      <span className={cn(numeros, "sm:text-right")}>
        <span className="sm:hidden text-xs text-gray-400 font-normal">En la copia: </span>
        {t.filas_copia == null ? "—" : numero(t.filas_copia)}
      </span>
      <span className="col-span-2 sm:col-span-1">
        <span title={accion?.ayuda} className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", color)}>
          {accion?.texto ?? t.accion}
        </span>
      </span>
    </li>
  );
}

function Resultado({ resultado }: { resultado: ResultadoRestauracion }) {
  const previa = resultado.copia_previa;
  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 space-y-2">
      <p className="font-medium flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Listo: todo volvió a como estaba el {fechaLegible(resultado.restaurada.generada_en)}.
      </p>
      <p>
        Se cargaron {numero(resultado.total_filas)} filas en {resultado.tablas.length} tablas.
        {resultado.conservadas.length > 0 && <> No se tocaron: {resultado.conservadas.join(", ")}.</>}
      </p>
      {previa && (
        <p>
          La copia de cómo estaba todo antes quedó{" "}
          {previa.nombre ? (
            <>
              guardada como <span className="font-mono text-xs break-all">{previa.nombre}</span> (abajo, en «Copias
              guardadas antes de restaurar»).
            </>
          ) : (
            <>en {previa.donde}.</>
          )}
        </p>
      )}
      {(resultado.planos_sin_archivo ?? 0) > 0 && (
        <p className="text-xs">
          {resultado.planos_sin_archivo === 1
            ? "Un plano de la copia no tenía el archivo en ningún lado y no se restauró."
            : `${numero(resultado.planos_sin_archivo)} planos de la copia no tenían el archivo en ningún lado y no se restauraron.`}
        </p>
      )}
      {resultado.archivos_conservados > 0 && (
        <p className="text-xs">
          {resultado.archivos_conservados === 1
            ? "Un plano de los viejos (guardado adentro de la base) conserva su archivo."
            : `${numero(resultado.archivos_conservados)} planos de los viejos (guardados adentro de la base) conservan su archivo.`}
        </p>
      )}
      <p className="text-xs">Las otras pantallas muestran los datos restaurados apenas las abrís.</p>
    </div>
  );
}
