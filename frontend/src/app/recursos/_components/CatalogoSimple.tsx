"use client";

/**
 * ABM genérico para catálogos con un solo campo `nombre`.
 * Reusable para Rangos, Sectores u otros catálogos de la misma forma.
 *
 * Endpoints esperados (REST estándar del backend):
 *   GET    {cleanUrl}/{resource}        -> ResponseDTO con data: Item[]
 *   POST   {cleanUrl}/{resource}        -> ResponseDTO con data: Item
 *   PUT    {cleanUrl}/{resource}/{id}   -> ResponseDTO con data: Item
 *   DELETE {cleanUrl}/{resource}/{id}   -> ResponseDTO con data: { deleted: id }
 */

import { Fragment, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Pencil, Trash2, Plus, RefreshCw, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { API_URL } from "@/config";

interface Item {
  id: number;
  nombre: string;
}

interface CatalogoSimpleProps {
  /** Endpoint REST plural, sin slash inicial (ej: "rangos", "sectores"). */
  resource: string;
  /** Nombre singular para mostrar en UI (ej: "Rango", "Sector"). */
  singular: string;
  /** Icono opcional a la izquierda del título. */
  icon?: React.ReactNode;
  /** Título de la sección (ej: "Rangos"). */
  titulo: string;
  /** Descripción debajo del título. */
  descripcion?: string;
  /**
   * Si viene, cada fila se puede desplegar y muestra esto adentro.
   *
   * Lo usa Rangos para editar los procesos y maquinarias que habilita, que es la parte
   * del recurso que no entra en un campo de texto. Sectores no lo pasa y queda como
   * estaba: un ABM de nombre y nada más.
   *
   * Se despliega de a uno. Cada panel sale a buscar su propio detalle al abrirse, así
   * que permitir varios abiertos serían N requests por una lista que casi siempre se
   * mira de a un rango por vez.
   */
  renderExpanded?: (item: Item) => React.ReactNode;
}

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === "undefined") return { "Content-Type": "application/json" };
  const token = localStorage.getItem("access_token");
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
};

export default function CatalogoSimple({
  resource,
  singular,
  icon,
  titulo,
  descripcion,
  renderExpanded,
}: CatalogoSimpleProps) {
  const cleanUrl = API_URL.replace(/\/$/, "");
  const { showToast } = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [expandido, setExpandido] = useState<number | null>(null);
  const esExpandible = !!renderExpanded;

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${cleanUrl}/${resource}`, { headers: getAuthHeaders() });
      const json = await res.json();
      // El backend devuelve ResponseDTO { status, data }
      const data: Item[] = json?.data ?? json ?? [];
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(`No se pudo cargar la lista de ${titulo.toLowerCase()}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  const abrirCrear = () => {
    setEditing(null);
    setNombre("");
    setOpenForm(true);
  };

  const abrirEditar = (item: Item) => {
    setEditing(item);
    setNombre(item.nombre);
    setOpenForm(true);
  };

  const guardar = async () => {
    const valor = nombre.trim();
    if (!valor) {
      showToast(`El nombre del ${singular.toLowerCase()} es obligatorio.`, "error");
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `${cleanUrl}/${resource}/${editing.id}`
        : `${cleanUrl}/${resource}`;
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({ nombre: valor }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg =
          errJson?.errorDescription || errJson?.detail || `Error al guardar el ${singular.toLowerCase()}.`;
        showToast(msg, "error");
        return;
      }
      showToast(
        `${singular} ${editing ? "actualizado" : "creado"} correctamente.`,
        "success"
      );
      setOpenForm(false);
      setEditing(null);
      setNombre("");
      await fetchItems();
    } catch {
      showToast(`Error de conexión al guardar el ${singular.toLowerCase()}.`, "error");
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${cleanUrl}/${resource}/${confirmDelete.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg =
          errJson?.errorDescription ||
          errJson?.detail ||
          `No se puede eliminar (puede estar en uso).`;
        showToast(msg, "error");
        return;
      }
      showToast(`${singular} eliminado correctamente.`, "success");
      setConfirmDelete(null);
      await fetchItems();
    } catch {
      showToast(`Error de conexión al eliminar el ${singular.toLowerCase()}.`, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 md:p-6 border-b flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-lg font-semibold">{titulo}</h2>
          </div>
          {descripcion && (
            <p className="text-sm text-muted-foreground mt-1">{descripcion}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={abrirCrear}
            size="sm"
            className="bg-[#DC143C] hover:bg-[#B01030] text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuevo {singular}
          </Button>
          <Button onClick={fetchItems} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-destructive bg-destructive/10">{error}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
          <span className="ml-3 text-muted-foreground">
            Cargando {titulo.toLowerCase()}...
          </span>
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="py-12 text-center text-muted-foreground">
          <p className="text-lg">No hay {titulo.toLowerCase()} registrados.</p>
          <p className="text-sm mt-1">Hacé clic en &quot;Nuevo {singular}&quot; para crear el primero.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground w-16">#</th>
                <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">
                  Nombre
                </th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, idx) => {
                const abierto = expandido === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={
                        esExpandible
                          ? () => setExpandido(abierto ? null : item.id)
                          : undefined
                      }
                      aria-expanded={esExpandible ? abierto : undefined}
                      className={`transition-colors ${
                        esExpandible ? "cursor-pointer" : ""
                      } ${abierto ? "bg-muted/60" : "hover:bg-muted/50"}`}
                    >
                      <td className="px-4 py-2 text-sm text-muted-foreground font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          {esExpandible && (
                            <ChevronRight
                              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                                abierto ? "rotate-90" : ""
                              }`}
                            />
                          )}
                          {item.nombre}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {/* stopPropagation: sin esto, editar o borrar también
                            desplegaría la fila, porque el click sube hasta el <tr>. */}
                        <div
                          className="flex justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => abrirEditar(item)}
                            className="h-8 w-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDelete(item)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {/* El panel se monta recién al abrir: cada uno pide su detalle solo
                        cuando alguien lo mira. La altura se anima con framer en vez de
                        con una transición CSS porque "auto" no es animable a mano. */}
                    <AnimatePresence initial={false}>
                      {esExpandible && abierto && (
                        <motion.tr
                          key={`exp-${item.id}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <td colSpan={3} className="p-0">
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: "auto" }}
                              exit={{ height: 0 }}
                              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                              className="overflow-hidden"
                            >
                              {renderExpanded!(item)}
                            </motion.div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog Crear/Editar */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Editar ${singular}` : `Nuevo ${singular}`}
            </DialogTitle>
            <DialogDescription>
              Ingresá el nombre del {singular.toLowerCase()}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium block mb-1.5">Nombre</label>
            <Input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) guardar();
              }}
              placeholder={`Nombre del ${singular.toLowerCase()}`}
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={guardar}
              disabled={saving || !nombre.trim()}
              className="bg-[#DC143C] hover:bg-[#B01030] text-white"
            >
              {saving ? <Spinner className="h-4 w-4 mr-2" /> : null}
              {editing ? "Guardar cambios" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Confirmar Eliminación */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar eliminación</DialogTitle>
            <DialogDescription>
              ¿Eliminar el {singular.toLowerCase()} <strong>{confirmDelete?.nombre}</strong>?
              {" "}Si está siendo usado por otra parte del sistema, la eliminación puede fallar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={eliminar} disabled={deleting}>
              {deleting ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
