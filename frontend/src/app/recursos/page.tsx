"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Eye,
  Pencil,
  Trash2,
  User,
  Phone,
  Activity,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ============================================
// TIPOS DE DATOS
// ============================================
interface Empleado {
  id: number;
  nombre: string;
  apellido: string;
  sector: string;
  categoria: string;
  disponible?: boolean;
  telefono?: string;
  celular?: string;
  dni?: string;
  fecha_nacimiento?: string;
  fecha_ingreso?: string;
}

interface EmpleadoDetalle extends Empleado {
  // No se usa este tipo de dato en el código actual, pero se mantiene por si acaso
  // fecha_nacimiento?: string
  // fecha_ingreso?: string
  // disponible?: boolean
  // cant_hs_trabajadas?: number
  // dias_trabajo?: string[]
}

interface Maquina {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  estado: "Operativa" | "Mantenimiento" | "Fuera de Servicio";
  proximoMantenimiento: string;
}

export default function RecursosPage() {
  // ============================================
  // ESTADO DEL COMPONENTE
  // ============================================
  const [tabActiva, setTabActiva] = useState<"empleados" | "maquinas">(
    "empleados"
  );
  const [empleadoSeleccionado, setEmpleadoSeleccionado] =
    useState<Empleado | null>(null);
  const [maquinaSeleccionada, setMaquinaSeleccionada] =
    useState<Maquina | null>(null);
  const [mostrarDialogoEliminar, setMostrarDialogoEliminar] = useState(false);
  const [itemAEliminar, setItemAEliminar] = useState<{
    tipo: "empleado" | "maquina";
    id: number | string;
    nombre: string;
  } | null>(null);

  const [mostrarDialogoCambiarEstado, setMostrarDialogoCambiarEstado] =
    useState(false);
  const [empleadoCambiarEstado, setEmpleadoCambiarEstado] =
    useState<Empleado | null>(null);
  const [nuevoEstado, setNuevoEstado] = useState<string>("");
  const [motivoCambio, setMotivoCambio] = useState<string>("");

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const maquinas: Maquina[] = [
    {
      id: "1",
      nombre: "Torno CNC #1",
      codigo: "MAQ-001",
      tipo: "Torneado",
      estado: "Operativa",
      proximoMantenimiento: "15/10/2025",
    },
    {
      id: "2",
      nombre: "Fresadora CNC #1",
      codigo: "MAQ-002",
      tipo: "Fresado",
      estado: "Operativa",
      proximoMantenimiento: "20/10/2025",
    },
    {
      id: "3",
      nombre: "Soldadora MIG #1",
      codigo: "MAQ-003",
      tipo: "Soldadura",
      estado: "Mantenimiento",
      proximoMantenimiento: "05/10/2025",
    },
  ];

  // ============================================
  // LLAMADO AL BACKEND - LISTAR OPERARIOS
  // Endpoint: GET /operarios
  // ============================================
  const fetchEmpleados = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      const response = await fetch(`${cleanUrl}/operarios`);

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      // Extraer el array del objeto ResponseDTO
      if (responseData.status && responseData.data) {
        setEmpleados(Array.isArray(responseData.data) ? responseData.data : []);
      } else {
        setError(responseData.errorDescription || "Error al cargar empleados");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar empleados"
      );
      console.error("Error fetching empleados:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmpleados();
  }, []);

  // ============================================
  // FUNCIONES DE MANEJO DE EVENTOS
  // ============================================

  // Endpoint: GET /operarios/{id}
  const handleVerEmpleado = async (empleado: Empleado) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      const response = await fetch(`${cleanUrl}/operarios/${empleado.id}`);

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      if (responseData.status && responseData.data) {
        setEmpleadoSeleccionado(responseData.data);
      } else {
        // Si falla, mostrar con datos básicos
        setEmpleadoSeleccionado(empleado); // Cast removed as Empleado and EmpleadoDetalle share fields
      }
    } catch (err) {
      console.error("Error fetching empleado details:", err);
      // Si falla, mostrar con datos básicos
      setEmpleadoSeleccionado(empleado); // Cast removed as Empleado and EmpleadoDetalle share fields
    }
  };

  // Función para ver detalles de la máquina
  const handleVerMaquina = (maquina: Maquina) => {
    setMaquinaSeleccionada(maquina);
  };

  const handleAbrirCrear = () => {
    setFormData({
      nombre: "",
      apellido: "",
      sector: "",
      categoria: "",
      fecha_nacimiento: "",
      fecha_ingreso: "",
      telefono: "",
      celular: "",
      dni: "",
    });
    setMostrarDialogoCrear(true);
  };

  const handleEditar = async (
    tipo: "empleado" | "maquina",
    id: number | string
  ) => {
    if (tipo === "empleado") {
      try {
        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const cleanUrl = apiUrl.replace(/\/$/, "");

        const response = await fetch(`${cleanUrl}/operarios/${id}`);

        if (!response.ok) {
          throw new Error(`Error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();

        if (responseData.status && responseData.data) {
          const empleado = responseData.data;
          setEmpleadoEditar(empleado);
          setFormData({
            nombre: empleado.nombre || "",
            apellido: empleado.apellido || "",
            sector: empleado.sector || "",
            categoria: empleado.categoria || "",
            fecha_nacimiento: empleado.fecha_nacimiento || "",
            fecha_ingreso: empleado.fecha_ingreso || "",
            telefono: empleado.telefono || "",
            celular: empleado.celular || "",
            dni: empleado.dni || "",
          });
          setMostrarDialogoEditar(true);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al cargar operario"
        );
        console.error("Error cargando operario:", err);
      }
    }
  };

  // Función para confirmar eliminación
  const handleConfirmarEliminar = (
    tipo: "empleado" | "maquina",
    id: number | string,
    nombre: string
  ) => {
    setItemAEliminar({ tipo, id, nombre });
    setMostrarDialogoEliminar(true);
  };

  // Endpoint: DELETE /operarios/{id}
  const handleEliminar = async () => {
    if (!itemAEliminar) return;

    try {
      if (itemAEliminar.tipo === "empleado") {
        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const cleanUrl = apiUrl.replace(/\/$/, "");

        const response = await fetch(
          `${cleanUrl}/operarios/${itemAEliminar.id}`,
          {
            method: "DELETE",
          }
        );

        if (!response.ok) {
          throw new Error(`Error: ${response.status} ${response.statusText}`);
        }

        const responseData = await response.json();

        if (responseData.status) {
          // Actualizar la lista después de eliminar
          await fetchEmpleados();
          setError(null);
        } else {
          setError(
            responseData.errorDescription || "Error al eliminar empleado"
          );
        }
      }
      // TODO: Implementar eliminación de máquinas cuando esté el backend
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
      console.error("Error eliminando:", err);
    } finally {
      setMostrarDialogoEliminar(false);
      setItemAEliminar(null);
    }
  };

  // Función para abrir el diálogo de cambiar estado
  const handleAbrirCambiarEstado = (empleado: Empleado) => {
    setEmpleadoCambiarEstado(empleado);
    setNuevoEstado(empleado.disponible ? "Activo" : "Ausente");
    setMotivoCambio("");
    setMostrarDialogoCambiarEstado(true);
  };

  const handleConfirmarCambioEstado = async () => {
    if (!empleadoCambiarEstado) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      const response = await fetch(
        `${cleanUrl}/operarios/${empleadoCambiarEstado.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nombre: empleadoCambiarEstado.nombre,
            apellido: empleadoCambiarEstado.apellido,
            sector: empleadoCambiarEstado.sector,
            categoria: empleadoCambiarEstado.categoria,
            fecha_nacimiento: empleadoCambiarEstado.fecha_nacimiento,
            fecha_ingreso: empleadoCambiarEstado.fecha_ingreso,
            disponible: nuevoEstado === "Activo",
            telefono: empleadoCambiarEstado.telefono || null,
            celular: empleadoCambiarEstado.celular || null,
            dni: empleadoCambiarEstado.dni || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      if (responseData.status) {
        // Actualizar la lista después del cambio
        await fetchEmpleados();
        setError(null);
      } else {
        setError(responseData.errorDescription || "Error al cambiar estado");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar estado");
      console.error("Error cambiando estado:", err);
    } finally {
      setMostrarDialogoCambiarEstado(false);
      setEmpleadoCambiarEstado(null);
      setNuevoEstado("");
      setMotivoCambio("");
    }
  };

  const handleCrearOperario = async () => {
    // Validar que las fechas estén presentes
    if (!formData.fecha_nacimiento || !formData.fecha_ingreso) {
      setError("Las fechas de nacimiento e ingreso son obligatorias");
      return;
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      // Solo enviar campos que existen en la base de datos
      const payload = {
        nombre: formData.nombre,
        apellido: formData.apellido,
        sector: formData.sector,
        categoria: formData.categoria,
        fecha_nacimiento: formData.fecha_nacimiento,
        fecha_ingreso: formData.fecha_ingreso,
        disponible: true,
        telefono: formData.telefono || null,
        celular: formData.celular || null,
        dni: formData.dni || null,
      };

      console.log("[v0] Payload para crear operario:", payload);

      const response = await fetch(`${cleanUrl}/operarios`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log("[v0] Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log("[v0] Error response:", errorText);
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();
      console.log("[v0] Response data:", responseData);

      if (responseData.status) {
        await fetchEmpleados();
        setMostrarDialogoCrear(false);
        setError(null);
      } else {
        setError(responseData.errorDescription || "Error al crear operario");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear operario");
      console.error("Error creando operario:", err);
    }
  };

  const handleActualizarOperario = async () => {
    if (!empleadoEditar) return;

    // Validar que las fechas estén presentes
    if (!formData.fecha_nacimiento || !formData.fecha_ingreso) {
      setError("Las fechas de nacimiento e ingreso son obligatorias");
      return;
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      // Solo enviar campos que existen en la base de datos
      const payload = {
        nombre: formData.nombre,
        apellido: formData.apellido,
        sector: formData.sector,
        categoria: formData.categoria,
        fecha_nacimiento: formData.fecha_nacimiento,
        fecha_ingreso: formData.fecha_ingreso,
        disponible: true,
        telefono: formData.telefono || null,
        celular: formData.celular || null,
        dni: formData.dni || null,
      };

      const response = await fetch(
        `${cleanUrl}/operarios/${empleadoEditar.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      if (responseData.status) {
        await fetchEmpleados();
        setMostrarDialogoEditar(false);
        setEmpleadoEditar(null);
        setError(null);
      } else {
        setError(
          responseData.errorDescription || "Error al actualizar operario"
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al actualizar operario"
      );
      console.error("Error actualizando operario:", err);
    }
  };

  // Función para obtener el color del badge según el estado
  const getEstadoColor = (disponible?: boolean) => {
    // Cambiado para usar 'disponible' en lugar de 'estado' para operarios
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  // Se agregó una función para formatear fechas para los detalles del empleado
  const formatearFecha = (fecha?: string) => {
    if (!fecha) return "No especificada";
    try {
      return new Date(fecha).toLocaleDateString("es-AR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return fecha;
    }
  };

  // Estado para el formulario de creación y edición
  const [mostrarDialogoCrear, setMostrarDialogoCrear] = useState(false);
  const [mostrarDialogoEditar, setMostrarDialogoEditar] = useState(false);
  const [empleadoEditar, setEmpleadoEditar] = useState<Empleado | null>(null);
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    sector: "",
    categoria: "",
    fecha_nacimiento: "",
    fecha_ingreso: "",
    telefono: "",
    celular: "",
    dni: "",
  });

  return (
    <div className="min-h-screen bg-background p-6">
      {/* ============================================ */}
      {/* ENCABEZADO DE LA PÁGINA */}
      {/* ============================================ */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Administración de Recursos
          </h1>
        </div>
        <div className="flex gap-2">
          {tabActiva === "empleados" && (
            <Button onClick={handleAbrirCrear} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Operario
            </Button>
          )}
          <Button
            onClick={fetchEmpleados}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Actualizar
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ============================================ */}
      {/* TABS PARA EMPLEADOS Y MÁQUINAS */}
      {/* ============================================ */}
      <div className="mb-6 flex gap-2">
        <Button
          variant={tabActiva === "empleados" ? "default" : "outline"}
          onClick={() => setTabActiva("empleados")}
          className="flex-1"
        >
          Empleados
        </Button>
        <Button
          variant={tabActiva === "maquinas" ? "default" : "outline"}
          onClick={() => setTabActiva("maquinas")}
          className="flex-1"
        >
          Máquinas
        </Button>
      </div>

      {/* ============================================ */}
      {/* TABLA DE EMPLEADOS */}
      {/* ============================================ */}
      {tabActiva === "empleados" && (
        <div className="rounded-lg border bg-card">
          <div className="p-6 border-b">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Operarios</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Gestión de personal operativo
            </p>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">
                Cargando empleados...
              </span>
            </div>
          )}

          {!loading && empleados.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg">No hay empleados disponibles</p>
              <p className="text-sm mt-2">
                Los empleados aparecerán aquí cuando estén disponibles en la API
              </p>
            </div>
          )}

          {!loading && empleados.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                      Nombre
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                      Especialidades
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                      DNI
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {empleados.map((empleado) => (
                    <tr
                      key={empleado.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm font-medium">
                        {empleado.nombre} {empleado.apellido}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className="text-xs">
                            {empleado.sector}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {empleado.categoria}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {empleado.dni || "-"}
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={getEstadoColor(empleado.disponible)}>
                          {empleado.disponible ? "Activo" : "Ausente"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleVerEmpleado(empleado)}
                            className="h-8 w-8"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              handleEditar("empleado", empleado.id)
                            }
                            className="h-8 w-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              handleConfirmarEliminar(
                                "empleado",
                                empleado.id,
                                `${empleado.nombre} ${empleado.apellido}`
                              )
                            }
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* TABLA DE MÁQUINAS */}
      {/* ============================================ */}
      {tabActiva === "maquinas" && (
        <div className="rounded-lg border bg-card">
          <div className="p-6 border-b">
            <div className="flex items-center gap-2">
              <svg
                className="h-5 w-5 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <h2 className="text-lg font-semibold">Máquinas y Equipos</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Gestión de maquinaria industrial
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                    Nombre
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                    Tipo
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                    Próximo Mantenimiento
                  </th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {maquinas.map((maquina) => (
                  <tr
                    key={maquina.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-medium">
                      {maquina.nombre}
                    </td>
                    <td className="px-6 py-4 text-sm">{maquina.tipo}</td>
                    <td className="px-6 py-4">
                      {/* <Badge className={getEstadoColor(maquina.estado)}>{maquina.estado}</Badge> */}
                      <Badge
                        className={getEstadoColor(
                          maquina.estado === "Operativa"
                        )}
                      >
                        {maquina.estado}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {maquina.proximoMantenimiento}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleVerMaquina(maquina)}
                          className="h-8 w-8"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditar("maquina", maquina.id)}
                          className="h-8 w-8"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            handleConfirmarEliminar(
                              "maquina",
                              maquina.id,
                              maquina.nombre
                            )
                          }
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* DIÁLOGO DE CONFIRMACIÓN DE ELIMINACIÓN */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN ELIMINAR */}
      {/* ============================================ */}
      <Dialog
        open={mostrarDialogoEliminar}
        onOpenChange={setMostrarDialogoEliminar}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar{" "}
              <strong>{itemAEliminar?.nombre}</strong>? Esta acción no se puede
              deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMostrarDialogoEliminar(false)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleEliminar}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* DIÁLOGO DE DETALLES DEL EMPLEADO */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN EL ICONO DE OJO */}
      {/* ============================================ */}
      <Dialog
        open={!!empleadoSeleccionado}
        onOpenChange={() => setEmpleadoSeleccionado(null)}
      >
        {/* <DialogContent className="max-w-2xl"> */}
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            {/* <DialogTitle>Detalles del Empleado</DialogTitle> */}
            <DialogTitle>Perfil del Operario</DialogTitle>
          </DialogHeader>
          {empleadoSeleccionado && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <User className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold">
                    {empleadoSeleccionado.nombre}{" "}
                    {empleadoSeleccionado.apellido}
                  </h3>
                  <p className="text-muted-foreground">
                    ID: {empleadoSeleccionado.id}
                  </p>
                </div>
                {/* <Badge className={getEstadoColor(empleadoSeleccionado.estado || "Activo")}>
                  {empleadoSeleccionado.estado || "Activo"}
                </Badge> */}
                <Badge
                  className={getEstadoColor(empleadoSeleccionado.disponible)}
                >
                  {empleadoSeleccionado.disponible ? "Activo" : "Ausente"}
                </Badge>
              </div>

              <div className="grid gap-4">
                <div>
                  <p className="font-medium mb-2">Nivel:</p>
                  <Badge
                    variant="outline"
                    className="bg-slate-700 text-white border-slate-700"
                  >
                    {empleadoSeleccionado.nivel || "Senior"}
                  </Badge>
                </div>

                <div>
                  <p className="font-medium mb-2">Sector:</p>
                  <Badge variant="secondary">
                    {empleadoSeleccionado.sector}
                  </Badge>
                </div>

                <div>
                  <p className="font-medium mb-2">Categoría:</p>
                  <Badge variant="secondary">
                    {empleadoSeleccionado.categoria}
                  </Badge>
                </div>

                {empleadoSeleccionado.contacto && (
                  <div>
                    <p className="font-medium mb-1">Contacto:</p>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{empleadoSeleccionado.contacto}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (empleadoSeleccionado) {
                  const temp = empleadoSeleccionado;
                  setEmpleadoSeleccionado(null);
                  handleAbrirCambiarEstado(temp);
                }
              }}
              className="gap-2"
            >
              <Activity className="h-4 w-4" />
              Cambiar Estado
            </Button>
            <Button onClick={() => setEmpleadoSeleccionado(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* DIÁLOGO DE CAMBIAR ESTADO */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN "CAMBIAR ESTADO" */}
      {/* AQUÍ SE HACE EL LLAMADO AL BACKEND PARA ACTUALIZAR EL ESTADO */}
      {/* Endpoint: PUT /operarios/{id} */}
      {/* ============================================ */}
      <Dialog
        open={mostrarDialogoCambiarEstado}
        onOpenChange={setMostrarDialogoCambiarEstado}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Cambiar Estado - {empleadoCambiarEstado?.nombre}{" "}
              {empleadoCambiarEstado?.apellido}
            </DialogTitle>
            <DialogDescription>
              Actualizar el estado laboral del empleado
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nuevo-estado">Nuevo Estado</Label>
              <Select value={nuevoEstado} onValueChange={setNuevoEstado}>
                <SelectTrigger id="nuevo-estado">
                  <SelectValue placeholder="Seleccionar estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activo">Activo</SelectItem>
                  {/* <SelectItem value="Enfermo">Enfermo</SelectItem> */}
                  <SelectItem value="Ausente">Ausente</SelectItem>
                  {/* <SelectItem value="Vacaciones">Vacaciones</SelectItem> */}
                  {/* <SelectItem value="Licencia">Licencia</SelectItem> */}
                  {/* <SelectItem value="Suspendido">Suspendido</SelectItem> */}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="motivo">Motivo/Notas</Label>
              <Textarea
                id="motivo"
                placeholder="Describe el motivo del cambio de estado..."
                value={motivoCambio}
                onChange={(e) => setMotivoCambio(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMostrarDialogoCambiarEstado(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirmarCambioEstado}>
              Confirmar Cambio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* DIÁLOGO DE DETALLES DE LA MÁQUINA */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN EL ICONO DE OJO */}
      {/* (Por ahora sin detalles adicionales según lo solicitado) */}
      {/* ============================================ */}
      <Dialog
        open={!!maquinaSeleccionada}
        onOpenChange={() => setMaquinaSeleccionada(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalles de la Máquina</DialogTitle>
          </DialogHeader>
          {maquinaSeleccionada && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">
                    {maquinaSeleccionada.nombre}
                  </h3>
                  <p className="text-muted-foreground">
                    {maquinaSeleccionada.codigo}
                  </p>
                </div>
                {/* <Badge className={getEstadoColor(maquinaSeleccionada.estado)}>{maquinaSeleccionada.estado}</Badge> */}
                <Badge
                  className={getEstadoColor(
                    maquinaSeleccionada.estado === "Operativa"
                  )}
                >
                  {maquinaSeleccionada.estado}
                </Badge>
              </div>

              <div className="space-y-2">
                <div>
                  <p className="font-medium">Tipo:</p>
                  <p className="text-muted-foreground">
                    {maquinaSeleccionada.tipo}
                  </p>
                </div>

                <div>
                  <p className="font-medium">Próximo Mantenimiento:</p>
                  <p className="text-muted-foreground">
                    {maquinaSeleccionada.proximoMantenimiento}
                  </p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setMaquinaSeleccionada(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* DIÁLOGO DE CREAR OPERARIO */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN "NUEVO OPERARIO" */}
      {/* Endpoint: POST /operarios */}
      {/* ============================================ */}
      <Dialog open={mostrarDialogoCrear} onOpenChange={setMostrarDialogoCrear}>
        {/* <DialogContent className="max-w-md"> */}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Operario</DialogTitle>
            <DialogDescription>
              Completa los datos del nuevo operario
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre *</Label>
                <Input
                  id="nombre"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  placeholder="Juan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apellido">Apellido *</Label>
                <Input
                  id="apellido"
                  value={formData.apellido}
                  onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                  placeholder="Pérez"
                />
              </div>
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información Personal</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nombre">Nombre *</Label>
                  <Input
                    id="nombre"
                    value={formData.nombre}
                    onChange={(e) =>
                      setFormData({ ...formData, nombre: e.target.value })
                    }
                    placeholder="Juan"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apellido">Apellido *</Label>
                  <Input
                    id="apellido"
                    value={formData.apellido}
                    onChange={(e) =>
                      setFormData({ ...formData, apellido: e.target.value })
                    }
                    placeholder="Pérez"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dni">DNI</Label>
                  <Input
                    id="dni"
                    value={formData.dni}
                    onChange={(e) =>
                      setFormData({ ...formData, dni: e.target.value })
                    }
                    placeholder="12345678"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fecha_nacimiento">
                    Fecha de Nacimiento *
                  </Label>
                  <Input
                    id="fecha_nacimiento"
                    type="date"
                    value={formData.fecha_nacimiento}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        fecha_nacimiento: e.target.value,
                      })
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* <div className="space-y-2">
              <Label htmlFor="sector">Sector *</Label>
              <Input
                id="sector"
                value={formData.sector}
                onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                placeholder="Producción"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="categoria">Categoría *</Label>
              <Input
                id="categoria"
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                placeholder="Operario"
              />
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información Laboral</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sector">Sector *</Label>
                  <Input
                    id="sector"
                    value={formData.sector}
                    onChange={(e) =>
                      setFormData({ ...formData, sector: e.target.value })
                    }
                    placeholder="MECANIZADO"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoria">Categoría *</Label>
                  <Input
                    id="categoria"
                    value={formData.categoria}
                    onChange={(e) =>
                      setFormData({ ...formData, categoria: e.target.value })
                    }
                    placeholder="OPERARIO CALIFICADO"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fecha_ingreso">Fecha de Ingreso *</Label>
                <Input
                  id="fecha_ingreso"
                  type="date"
                  value={formData.fecha_ingreso}
                  onChange={(e) =>
                    setFormData({ ...formData, fecha_ingreso: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            {/* <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fecha_nacimiento">Fecha de Nacimiento *</Label>
                <Input
                  id="fecha_nacimiento"
                  type="date"
                  value={formData.fecha_nacimiento}
                  onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fecha_ingreso">Fecha de Ingreso *</Label>
                <Input
                  id="fecha_ingreso"
                  type="date"
                  value={formData.fecha_ingreso}
                  onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })}
                  required
                />
              </div>
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información de Contacto</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telefono">Teléfono</Label>
                  <Input
                    id="telefono"
                    value={formData.telefono}
                    onChange={(e) =>
                      setFormData({ ...formData, telefono: e.target.value })
                    }
                    placeholder="4233-2492"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="celular">Celular</Label>
                  <Input
                    id="celular"
                    value={formData.celular}
                    onChange={(e) =>
                      setFormData({ ...formData, celular: e.target.value })
                    }
                    placeholder="11-2748-6366"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMostrarDialogoCrear(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCrearOperario}
              disabled={
                !formData.nombre ||
                !formData.apellido ||
                !formData.sector ||
                !formData.categoria ||
                !formData.fecha_nacimiento ||
                !formData.fecha_ingreso
              }
            >
              Crear Operario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* DIÁLOGO DE EDITAR OPERARIO */}
      {/* ESTE DIÁLOGO SE MUESTRA CUANDO SE HACE CLIC EN EL ICONO DE LÁPIZ */}
      {/* Endpoint: PUT /operarios/{id} */}
      {/* ============================================ */}
      <Dialog
        open={mostrarDialogoEditar}
        onOpenChange={setMostrarDialogoEditar}
      >
        {/* <DialogContent className="max-w-md"> */}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Operario</DialogTitle>
            <DialogDescription>
              Modifica los datos del operario
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-nombre">Nombre *</Label>
                <Input
                  id="edit-nombre"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  placeholder="Juan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-apellido">Apellido *</Label>
                <Input
                  id="edit-apellido"
                  value={formData.apellido}
                  onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                  placeholder="Pérez"
                />
              </div>
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información Personal</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-nombre">Nombre *</Label>
                  <Input
                    id="edit-nombre"
                    value={formData.nombre}
                    onChange={(e) =>
                      setFormData({ ...formData, nombre: e.target.value })
                    }
                    placeholder="Juan"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-apellido">Apellido *</Label>
                  <Input
                    id="edit-apellido"
                    value={formData.apellido}
                    onChange={(e) =>
                      setFormData({ ...formData, apellido: e.target.value })
                    }
                    placeholder="Pérez"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-dni">DNI</Label>
                  <Input
                    id="edit-dni"
                    value={formData.dni}
                    onChange={(e) =>
                      setFormData({ ...formData, dni: e.target.value })
                    }
                    placeholder="12345678"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-fecha_nacimiento">
                    Fecha de Nacimiento *
                  </Label>
                  <Input
                    id="edit-fecha_nacimiento"
                    type="date"
                    value={formData.fecha_nacimiento}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        fecha_nacimiento: e.target.value,
                      })
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* <div className="space-y-2">
              <Label htmlFor="edit-sector">Sector *</Label>
              <Input
                id="edit-sector"
                value={formData.sector}
                onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                placeholder="Producción"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-categoria">Categoría *</Label>
              <Input
                id="edit-categoria"
                value={formData.categoria}
                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                placeholder="Operario"
              />
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información Laboral</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-sector">Sector *</Label>
                  <Input
                    id="edit-sector"
                    value={formData.sector}
                    onChange={(e) =>
                      setFormData({ ...formData, sector: e.target.value })
                    }
                    placeholder="MECANIZADO"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-categoria">Categoría *</Label>
                  <Input
                    id="edit-categoria"
                    value={formData.categoria}
                    onChange={(e) =>
                      setFormData({ ...formData, categoria: e.target.value })
                    }
                    placeholder="OPERARIO CALIFICADO"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-fecha_ingreso">Fecha de Ingreso *</Label>
                <Input
                  id="edit-fecha_ingreso"
                  type="date"
                  value={formData.fecha_ingreso}
                  onChange={(e) =>
                    setFormData({ ...formData, fecha_ingreso: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            {/* <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-fecha_nacimiento">Fecha de Nacimiento *</Label>
                <Input
                  id="edit-fecha_nacimiento"
                  type="date"
                  value={formData.fecha_nacimiento}
                  onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-fecha_ingreso">Fecha de Ingreso *</Label>
                <Input
                  id="edit-fecha_ingreso"
                  type="date"
                  value={formData.fecha_ingreso}
                  onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })}
                  required
                />
              </div>
            </div> */}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Información de Contacto</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-telefono">Teléfono</Label>
                  <Input
                    id="edit-telefono"
                    value={formData.telefono}
                    onChange={(e) =>
                      setFormData({ ...formData, telefono: e.target.value })
                    }
                    placeholder="4233-2492"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-celular">Celular</Label>
                  <Input
                    id="edit-celular"
                    value={formData.celular}
                    onChange={(e) =>
                      setFormData({ ...formData, celular: e.target.value })
                    }
                    placeholder="11-2748-6366"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMostrarDialogoEditar(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleActualizarOperario}
              disabled={
                !formData.nombre ||
                !formData.apellido ||
                !formData.sector ||
                !formData.categoria ||
                !formData.fecha_nacimiento ||
                !formData.fecha_ingreso
              }
            >
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
