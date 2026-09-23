'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  erroresPorCampo,
  faltaServidor,
  mensajeDeError,
  resumenDeRol,
  type Matriz,
} from '@/lib/permisosAdmin';
import { datos, pedir, type RolElegible, type UsuarioFila } from './api';

/**
 * El alta de un usuario (NuevoUsuarioDialog de Don Joaquín).
 *
 * Como allá, no se cierra al crear: primero muestra los datos para pasárselos a la persona
 * (usuario y contraseña, con botón de copiar), porque la contraseña no se vuelve a ver. La
 * primera vez que entre, el sistema la obliga a poner una suya (debe_cambiar_password,
 * lo prende el backend en toda alta).
 *
 * El rol sale de la tabla de roles (la matriz). Con un backend viejo, que no la tiene,
 * el único rol es Administrador, como hasta ahora.
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = no se sabe qué roles hay (backend viejo): sólo Administrador. */
  roles: RolElegible[] | null;
  matriz: Matriz | null;
  onCreado: (u: UsuarioFila) => void;
}

interface Creado {
  username: string;
  password: string;
  rol: string;
  nombre: string;
}

const RE_USERNAME = /^[a-zA-Z0-9_.]+$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * El rol que viene elegido. Ante la duda, el que menos puede: dar de más por un click
 * que nadie miró es peor que tener que subirlo después. Con backend viejo, admin (el
 * único que hay).
 */
function rolPorDefecto(roles: RolElegible[] | null): string {
  if (!roles || roles.length === 0) return 'admin';
  return (
    roles.find((r) => r.codigo === 'operario')?.codigo ??
    roles.find((r) => r.codigo !== 'admin')?.codigo ??
    roles[0].codigo
  );
}

export default function NuevoUsuarioDialog({ open, onOpenChange, roles, matriz, onCreado }: Props) {
  const opciones: RolElegible[] = roles && roles.length ? roles : [{ codigo: 'admin', nombre: 'Administrador' }];
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState(rolPorDefecto(roles));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // Al abrir, de cero.
  useEffect(() => {
    if (!open) return;
    setNombre('');
    setApellido('');
    setUsername('');
    setEmail('');
    setPassword('');
    setRol(rolPorDefecto(roles));
    setErrores({});
    setGuardando(false);
    setCreado(null);
    setCopiado(null);
    // Sólo al abrir: si los roles llegan con el diálogo abierto, no se pisa lo elegido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validar = (): boolean => {
    const e: Record<string, string> = {};
    if (!nombre.trim()) e.nombre = 'Falta el nombre';
    if (!apellido.trim()) e.apellido = 'Falta el apellido';
    const u = username.trim();
    if (!u) e.username = 'Falta el usuario';
    else if (u.length < 3) e.username = 'Mínimo 3 letras';
    else if (!RE_USERNAME.test(u)) e.username = 'Sólo letras, números, _ y .';
    if (!email.trim()) e.email = 'Falta el email';
    else if (!RE_EMAIL.test(email.trim())) e.email = 'Ese email no es válido';
    if (password.length < 6) e.password = 'Mínimo 6 caracteres';
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const crear = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (guardando || !validar()) return;
    setGuardando(true);
    const cuerpo = {
      username: username.trim(),
      email: email.trim(),
      password,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      rol,
      activo: true,
    };
    const r = await pedir('/auth/usuarios', { method: 'POST', body: cuerpo });
    setGuardando(false);
    if (!r.ok) {
      if (r.red) {
        setErrores({ global: 'No se pudo crear: revisá la conexión.' });
        return;
      }
      if (faltaServidor(r.status, r.cuerpo)) {
        setErrores({ global: 'No se pudo crear: falta actualizar el servidor.' });
        return;
      }
      const porCampo = erroresPorCampo(r.cuerpo);
      setErrores(Object.keys(porCampo).length ? porCampo : { global: mensajeDeError(r.cuerpo, 'No se pudo crear el usuario.') });
      return;
    }
    const d = (datos(r) ?? {}) as Partial<UsuarioFila>;
    onCreado({
      id_usuario: typeof d.id_usuario === 'number' ? d.id_usuario : -Date.now(),
      username: d.username ?? cuerpo.username.toLowerCase(),
      email: d.email ?? cuerpo.email,
      nombre: d.nombre ?? cuerpo.nombre,
      apellido: d.apellido ?? cuerpo.apellido,
      rol: d.rol ?? rol,
      activo: d.activo ?? true,
      ultimo_login: null,
      bloqueado: false,
      bloqueado_hasta: null,
      intentos_fallidos: 0,
      admin_permanente: false,
    });
    setCreado({
      username: d.username ?? cuerpo.username.toLowerCase(),
      password,
      rol: opciones.find((o) => o.codigo === (d.rol ?? rol))?.nombre ?? rol,
      nombre: cuerpo.nombre,
    });
  };

  const copiar = async (texto: string, clave: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(clave);
      setTimeout(() => setCopiado((c) => (c === clave ? null : c)), 1500);
    } catch {
      setCopiado('no');
    }
  };

  const textoParaPasar = (c: Creado) => {
    const url = typeof window !== 'undefined' ? window.location.origin : '';
    return [
      `Acceso a SPMM${url ? ` — ${url}` : ''}`,
      `Usuario: ${c.username}`,
      `Contraseña: ${c.password}`,
      'La primera vez que entres te va a pedir que pongas una contraseña tuya.',
    ].join('\n');
  };

  const rolElegido = matriz?.roles.find((r) => r.codigo === rol) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[500px]">
        {creado ? (
          <>
            <DialogHeader>
              <DialogTitle>Usuario creado</DialogTitle>
              <DialogDescription>
                Pasale estos datos a {creado.nombre} por el canal que uses. La contraseña no se
                vuelve a mostrar: la primera vez que entre, el sistema le pide que ponga una suya.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {[
                { clave: 'username', label: 'Usuario', valor: creado.username },
                { clave: 'password', label: 'Contraseña', valor: creado.password },
                { clave: 'rol', label: 'Rol', valor: creado.rol },
              ].map((f) => (
                <div
                  key={f.clave}
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">{f.label}</p>
                    <p className="truncate text-sm font-medium text-gray-900">{f.valor}</p>
                  </div>
                  {f.clave !== 'rol' && (
                    <button
                      type="button"
                      onClick={() => copiar(f.valor, f.clave)}
                      title={`Copiar ${f.label.toLowerCase()}`}
                      aria-label={`Copiar ${f.label.toLowerCase()}`}
                      className="shrink-0 rounded p-1.5 max-md:p-2.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900"
                    >
                      {copiado === f.clave ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              ))}
              {copiado === 'no' && (
                <p className="text-xs text-amber-700">
                  Este navegador no dejó copiar: seleccioná el texto y copialo a mano.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Listo
              </Button>
              <Button
                onClick={() => copiar(textoParaPasar(creado), 'todo')}
                className="bg-[#DC143C] hover:bg-[#B01030] text-white"
              >
                {copiado === 'todo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado === 'todo' ? 'Copiado' : 'Copiar todo'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={crear} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Nuevo usuario</DialogTitle>
              <DialogDescription>
                Le das una contraseña para entrar la primera vez; ahí el sistema le pide que
                ponga una suya.
              </DialogDescription>
            </DialogHeader>

            {errores.global && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {errores.global}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo id="nu-nombre" label="Nombre *" error={errores.nombre}>
                <Input id="nu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
              </Campo>
              <Campo id="nu-apellido" label="Apellido *" error={errores.apellido}>
                <Input id="nu-apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} />
              </Campo>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo id="nu-username" label="Usuario *" error={errores.username} ayuda="Con esto entra al sistema.">
                <Input
                  id="nu-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="juan.perez"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </Campo>
              <Campo id="nu-password" label="Contraseña inicial *" error={errores.password}>
                <Input
                  id="nu-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                />
              </Campo>
            </div>
            <Campo id="nu-email" label="Email *" error={errores.email}>
              <Input
                id="nu-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="juan@metalurgicalongchamps.com"
              />
            </Campo>
            <Campo id="nu-rol" label="Rol *" error={errores.rol}>
              <select
                id="nu-rol"
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                className="h-9 max-md:h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30"
              >
                {opciones.map((r) => (
                  <option key={r.codigo} value={r.codigo}>
                    {r.nombre}
                  </option>
                ))}
              </select>
              {rolElegido && (
                <p className="text-xs text-gray-500">{resumenDeRol(rolElegido)}</p>
              )}
            </Campo>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando} className="bg-[#DC143C] hover:bg-[#B01030] text-white">
                {guardando ? 'Creando…' : 'Crear usuario'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Campo({
  id,
  label,
  error,
  ayuda,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : ayuda ? (
        <p className="text-xs text-gray-500">{ayuda}</p>
      ) : null}
    </div>
  );
}
