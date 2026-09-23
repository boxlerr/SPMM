'use client';

import { useState } from 'react';
import { HelpCircle, Lightbulb, Lock, ShieldCheck, UserCog, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Nivel } from '@/lib/permisos';
import { LO_DE_TODOS, NIVEL_INFO } from './area-meta';

/**
 * La ayuda de «Usuarios y permisos» (HelpUsuariosDialog de Don Joaquín): cuatro solapas
 * —Usuarios, Roles, Confidencial y Puntuales— con los pasos dichos en criollo. Sin el
 * bloqueo por horario, que acá no existe.
 */

interface Paso {
  titulo: string;
  texto: React.ReactNode;
  consejo?: React.ReactNode;
}

interface Solapa {
  id: string;
  nombre: string;
  icono: React.ReactNode;
  pasos: Paso[];
}

function PastillaNivel({ n }: { n: Nivel }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${NIVEL_INFO[n].clase}`}>
      {NIVEL_INFO[n].label}
    </span>
  );
}

const SOLAPAS: Solapa[] = [
  {
    id: 'usuarios',
    nombre: 'Usuarios',
    icono: <UserPlus className="h-3.5 w-3.5" />,
    pasos: [
      {
        titulo: 'Dar de alta a alguien',
        texto: (
          <>
            Botón <b>Nuevo usuario</b>: nombre, apellido, el <b>usuario</b> con el que va a entrar, el email, una
            contraseña para la primera vez y el <b>rol</b>, que es lo que define qué puede hacer.
          </>
        ),
        consejo: 'El rol viene en Operario, que es el que menos puede. Si le das más, que sea a propósito.',
      },
      {
        titulo: 'Qué pasa al crearlo',
        texto: (
          <>
            Te muestra el usuario y la contraseña para que se los pases (con botón de copiar). La primera vez que
            entra, el sistema le pide que ponga una contraseña suya: vos nunca sabés la definitiva.
          </>
        ),
      },
      {
        titulo: 'Cambiarle el rol',
        texto: (
          <>
            Desde la misma fila de la lista. Se ve al toque y vale desde lo próximo que haga esa persona, sin que
            tenga que volver a entrar. Tu propio rol te lo cambia otro administrador.
          </>
        ),
        consejo: (
          <>
            Los que tienen <Lock className="inline h-3 w-3 -mt-0.5" /> <b>Permanente</b> son administradores fijos:
            no se les cambia el rol, ni se los desactiva ni se los elimina. Y el sistema nunca se queda sin un
            Administrador.
          </>
        ),
      },
      {
        titulo: 'Bloqueado por contraseñas',
        texto: (
          <>
            Después de 5 contraseñas mal seguidas la cuenta queda bloqueada 15 minutos (dice «Bloqueado hasta
            HH:MM»). Se desbloquea sola; si no querés que espere, apretá <b>Desbloquear</b>.
          </>
        ),
      },
      {
        titulo: 'Editar y eliminar',
        texto: (
          <>
            En los tres puntitos de cada fila: <b>Editar datos</b> (nombre, usuario y email) y <b>Eliminar</b>, que
            le saca el acceso: no puede entrar más. Lo que cargó queda en el sistema con su nombre.
          </>
        ),
        consejo: (
          <>
            ¿Lo eliminaste por error? Abajo de la lista, <b>Ver los que no tienen acceso</b>, y en su fila{' '}
            <b>Devolver el acceso</b>: vuelve a entrar con el mismo usuario y el mismo rol.
          </>
        ),
      },
    ],
  },
  {
    id: 'roles',
    nombre: 'Roles',
    icono: <ShieldCheck className="h-3.5 w-3.5" />,
    pasos: [
      {
        titulo: 'La matriz es tu menú',
        texto: (
          <>
            Cada fila es un rol (Administrador, Supervisor, Operario) y cada columna una pantalla del menú. En
            cada cruce elegís qué puede hacer ese rol ahí.
          </>
        ),
      },
      {
        titulo: 'Tres niveles, nada más',
        texto: (
          <span className="grid gap-1.5">
            {(['none', 'read', 'write'] as Nivel[]).map((n) => (
              <span key={n} className="flex items-center gap-2">
                <span className="w-20 shrink-0"><PastillaNivel n={n} /></span>
                <span>{NIVEL_INFO[n].desc}</span>
              </span>
            ))}
            <span className="flex items-center gap-2">
              <span className="w-20 shrink-0"><PastillaNivel n="admin" /></span>
              <span>El Administrador puede todo, siempre.</span>
            </span>
          </span>
        ),
        consejo: 'Con «Ver», los botones de crear, editar y borrar directamente no aparecen, y la pantalla dice «Solo lectura».',
      },
      {
        titulo: 'Las solapas',
        texto: (
          <>
            Debajo de la matriz, por rol: una solapa hace lo mismo que su pantalla, salvo que le pongas{' '}
            <b>menos</b>. Por ejemplo, que el Operario vea Operaciones pero no el Planificador.
          </>
        ),
      },
      {
        titulo: 'Por dónde entra cada uno',
        texto: (
          <>
            Debajo de la matriz, en <b>Por dónde entra cada rol</b>, elegís la pantalla que ve cada rol apenas
            entra (por ejemplo, que el Operario vaya directo a Operaciones). A una persona le podés poner otra en
            la lista de usuarios, en <b>Entra por</b>: vale la suya.
          </>
        ),
        consejo: (
          <>
            No da permisos: si no puede ver esa pantalla, entra al Dashboard. Y el Dashboard le muestra a cada uno
            sólo lo de las pantallas que puede ver.
          </>
        ),
      },
      {
        titulo: 'Lo que es de todos',
        texto: (
          <>
            {LO_DE_TODOS.join(', ')} son de todo el que entra, no dependen de ningún permiso. Y las listas que
            usan varias pantallas (procesos, personas, máquinas, rangos…) se pueden ver desde cualquier
            pantalla que las necesite; cambiarlas pide la pantalla donde se editan.
          </>
        ),
        consejo: 'Todo cambio de permisos queda en Auditoría: quién, cuándo y cómo estaba antes.',
      },
    ],
  },
  {
    id: 'confidencial',
    nombre: 'Confidencial',
    icono: <Lock className="h-3.5 w-3.5" />,
    pasos: [
      {
        titulo: 'Qué es una sección confidencial',
        texto: (
          <>
            Queda <b>cerrada para todos</b> salvo el Administrador, aunque el rol tenga la pantalla en Editar. El
            candado gana.
          </>
        ),
      },
      {
        titulo: 'Las que vienen marcadas',
        texto: (
          <>
            <b>Rendimiento por persona</b> del Dashboard (compara a la gente con nombre y apellido) y{' '}
            <b>Usuarios y permisos</b>. Podés marcar cualquier otra con su interruptor.
          </>
        ),
      },
      {
        titulo: 'Abrírsela a alguien',
        texto: (
          <>
            A un rol entero, en «Solapas y partes sensibles, por rol»; o a una persona sola, en los permisos
            puntuales. «Usuarios y permisos», a lo sumo para ver: cambiar usuarios y permisos es sólo del
            Administrador.
          </>
        ),
      },
      {
        titulo: 'Sacarle la marca',
        texto: (
          <>
            Si al sacársela alguien la pasaría a ver, el sistema te avisa quiénes y te deja hacerlo igual con{' '}
            <b>Sacarle la marca igual</b>.
          </>
        ),
      },
    ],
  },
  {
    id: 'puntuales',
    nombre: 'Puntuales',
    icono: <UserCog className="h-3.5 w-3.5" />,
    pasos: [
      {
        titulo: 'Un permiso de más para UNA persona',
        texto: (
          <>
            Encima de su rol, sin cambiárselo a todo el grupo. <b>Siempre suma, nunca resta.</b>
          </>
        ),
        consejo: 'A un Administrador no hace falta: ya puede todo.',
      },
      {
        titulo: 'Cómo se da',
        texto: (
          <>
            Elegís la persona, qué (una pantalla entera o una solapa), si es para ver o para editar, el vencimiento
            si querés y un motivo. Apretás <b>Dar permiso</b>.
          </>
        ),
      },
      {
        titulo: 'El vencimiento',
        texto: (
          <>
            Vacío es permanente. Con fecha, se saca solo a esa hora sin que te tengas que acordar. El botón{' '}
            <b>Hoy</b> lo deja hasta las 23:59.
          </>
        ),
        consejo: 'Para reemplazos: «Clientes para editar hasta el viernes, cubre a Sofía».',
      },
      {
        titulo: 'Ver y sacar',
        texto: (
          <>
            Debajo, por persona: qué tiene, hasta cuándo, el motivo y quién se lo dio. Los vencidos quedan
            tachados. El tacho lo saca al toque.
          </>
        ),
      },
    ],
  },
];

export default function HelpUsuariosDialog() {
  const [abierto, setAbierto] = useState(false);
  const [solapa, setSolapa] = useState(SOLAPAS[0].id);
  const actual = SOLAPAS.find((s) => s.id === solapa) ?? SOLAPAS[0];

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)} className="max-md:h-10">
        <HelpCircle className="h-4 w-4 text-[#DC143C]" />
        Cómo funciona
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(v) => {
          setAbierto(v);
          if (!v) setSolapa(SOLAPAS[0].id);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Usuarios y permisos: cómo funciona</DialogTitle>
            <DialogDescription>Quién entra al sistema y qué puede hacer cada uno.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 sm:flex" role="tablist">
            {SOLAPAS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === actual.id}
                onClick={() => setSolapa(s.id)}
                className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors max-md:py-2 ${
                  s.id === actual.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {s.icono}
                {s.nombre}
              </button>
            ))}
          </div>
          <ol className="space-y-4">
            {actual.pasos.map((p, i) => (
              <li key={p.titulo} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#DC143C] text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-semibold text-gray-900">{p.titulo}</p>
                  <div className="text-sm leading-relaxed text-gray-600">{p.texto}</div>
                  {p.consejo && (
                    <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
                      <span>{p.consejo}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
