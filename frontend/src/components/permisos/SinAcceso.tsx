"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, ArrowLeft, Eye } from "lucide-react";
import { usePermisos } from "@/hooks/usePermisos";
import { puedeAbrirRuta } from "@/lib/permisos";

/**
 * El cartel de «no tenés acceso» (RF-24).
 *
 * Sale cuando alguien entra por la dirección —un favorito, un enlace de un aviso, el
 * historial— a una pantalla que su rol no puede ver. Antes de esto la pantalla se
 * dibujaba igual y cada pedido al backend volvía con 403: tablas vacías y errores por
 * todos lados, que se leen como «el sistema está roto». Ahora dice qué pasa y ofrece
 * volver a la primera pantalla que sí puede ver (no al Dashboard a ciegas: puede que
 * ése tampoco).
 */
export function SinAcceso({ titulo = "No tenés acceso a esta sección" }: { titulo?: string }) {
  const { rutaDeInicio } = usePermisos();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-1 py-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
          <Lock className="h-6 w-6 text-[#DC143C]" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 sm:text-xl">{titulo}</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Tu usuario no tiene permiso para ver esta pantalla. Si la necesitás para tu
          trabajo, pedíselo a un administrador.
        </p>
        <Link
          href={rutaDeInicio}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#DC143C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B8112E] sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

/**
 * Deja pasar a la pantalla sólo si la persona la puede ver; si no, el cartel.
 *
 * Qué pide cada ruta está en lib/permisos.ts (requisitoDeRuta): las del menú, lo mismo
 * que su ítem; las páginas sueltas, lo de la solapa que las reemplazó. Sin permisos
 * (backend viejo) deja pasar todo, como siempre.
 */
export function GuardiaDeRuta({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permisos } = usePermisos();
  if (!puedeAbrirRuta(permisos, pathname || "/")) return <SinAcceso />;
  return <>{children}</>;
}

/**
 * La marquita de «solo lectura» para la cabecera de una pantalla: explica por qué no
 * están los botones de crear, editar y borrar (se esconden cuando el nivel no alcanza).
 * En el teléfono el `title` no se ve, así que el texto va escrito.
 */
export function MarcaSoloLectura({ que }: { que?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 ring-1 ring-gray-200"
      title={`Podés ver${que ? ` ${que}` : ""}, no modificar. Si lo necesitás, pedíselo a un administrador.`}
    >
      <Eye className="h-3 w-3" />
      Solo lectura
    </span>
  );
}
