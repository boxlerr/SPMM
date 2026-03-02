'use client';

import { useState, useEffect } from 'react';
import { API_URL } from '@/config';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { capitalizeName } from '@/lib/utils';
import {
  Search,
  UserPlus,
  Edit,
  Trash2,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Usuario {
  id_usuario: number;
  username: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
  fecha_creacion: string;
  ultimo_login: string | null;
}

interface FormData {
  username: string;
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
}

export default function UsuariosTable() {
  const { showToast } = useToast();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [filteredUsuarios, setFilteredUsuarios] = useState<Usuario[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedUsuario, setSelectedUsuario] = useState<Usuario | null>(null);
  const [formData, setFormData] = useState<FormData>({
    username: '',
    email: '',
    password: '',
    nombre: '',
    apellido: '',
    rol: 'admin',
    activo: true
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Cargar usuarios al montar el componente
  useEffect(() => {
    fetchUsuarios();
  }, []);

  // Filtrar usuarios cuando cambia el término de búsqueda
  useEffect(() => {
    if (searchTerm === '') {
      setFilteredUsuarios(usuarios);
    } else {
      const filtered = usuarios.filter(usuario =>
        usuario.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        usuario.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        usuario.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        usuario.apellido.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredUsuarios(filtered);
    }
  }, [searchTerm, usuarios]);

  const fetchUsuarios = async () => {
    try {
      setLoading(true);
      // TODO: Obtener el token del localStorage o context
      const token = localStorage.getItem('access_token');

      const response = await fetch(`${API_URL}/auth/usuarios`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (data.status) {
        setUsuarios(data.data);
        setFilteredUsuarios(data.data);
      }
    } catch (error) {
      console.error('Error al cargar usuarios:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      nombre: '',
      apellido: '',
      rol: 'admin',
      activo: true
    });
    setFormErrors({});
    setIsCreateModalOpen(true);
  };

  const handleEditUser = (usuario: Usuario) => {
    setSelectedUsuario(usuario);
    setFormData({
      username: usuario.username,
      email: usuario.email,
      password: '', // No mostrar la contraseña actual
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
      activo: usuario.activo
    });
    setFormErrors({});
    setIsEditModalOpen(true);
  };

  const handleDeleteUser = (usuario: Usuario) => {
    setSelectedUsuario(usuario);
    setIsDeleteModalOpen(true);
  };

  const validateForm = (isEdit: boolean = false): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.username.trim()) {
      errors.username = 'El username es requerido';
    }

    if (!formData.email.trim()) {
      errors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'El email no es válido';
    }

    if (!isEdit && !formData.password.trim()) {
      errors.password = 'La contraseña es requerida';
    } else if (formData.password && formData.password.length < 6) {
      errors.password = 'La contraseña debe tener al menos 6 caracteres';
    }

    if (!formData.nombre.trim()) {
      errors.nombre = 'El nombre es requerido';
    }

    if (!formData.apellido.trim()) {
      errors.apellido = 'El apellido es requerido';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitCreateUser = async () => {
    if (!validateForm()) return;

    try {
      const token = localStorage.getItem('access_token');

      const response = await fetch(`${API_URL}/auth/usuarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.status) {
        await fetchUsuarios();
        setIsCreateModalOpen(false);
        showToast(`Usuario '${formData.username}' creado correctamente`, 'success');
        // La notificación se crea automáticamente en el backend
        // Recargar notificaciones inmediatamente después de un pequeño delay
        setTimeout(() => {
          if ((window as any).reloadNotifications) {
            (window as any).reloadNotifications();
          }
        }, 500); // Esperar 500ms para que el backend procese la notificación
      } else {
        // Mostrar errores del servidor
        if (data.errors && data.errors.length > 0) {
          const serverErrors: Record<string, string> = {};
          data.errors.forEach((error: any) => {
            serverErrors[error.campo] = error.message;
          });
          setFormErrors(serverErrors);
        }
      }
    } catch (error) {
      console.error('Error al crear usuario:', error);
    }
  };

  const submitEditUser = async () => {
    if (!selectedUsuario || !validateForm(true)) return;

    try {
      const token = localStorage.getItem('access_token');

      // No enviar password si está vacío
      const updateData: any = {
        username: formData.username,
        email: formData.email,
        nombre: formData.nombre,
        apellido: formData.apellido,
        rol: formData.rol,
        activo: formData.activo
      };

      if (formData.password) {
        updateData.password = formData.password;
      }

      const response = await fetch(`${API_URL}/auth/usuarios/${selectedUsuario.id_usuario}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });

      const data = await response.json();

      if (data.status) {
        await fetchUsuarios();
        setIsEditModalOpen(false);
        showToast(`Usuario '${formData.username}' modificado correctamente`, 'success');
        // La notificación se crea automáticamente en el backend
        // Recargar notificaciones inmediatamente después de un pequeño delay
        setTimeout(() => {
          if ((window as any).reloadNotifications) {
            (window as any).reloadNotifications();
          }
        }, 500); // Esperar 500ms para que el backend procese la notificación
      } else {
        // Mostrar errores del servidor
        if (data.errors && data.errors.length > 0) {
          const serverErrors: Record<string, string> = {};
          data.errors.forEach((error: any) => {
            serverErrors[error.campo] = error.message;
          });
          setFormErrors(serverErrors);
        }
      }
    } catch (error) {
      console.error('Error al actualizar usuario:', error);
    }
  };

  const submitDeleteUser = async () => {
    if (!selectedUsuario) return;

    try {
      setIsDeleting(true);
      const token = localStorage.getItem('access_token');

      const response = await fetch(`${API_URL}/auth/usuarios/${selectedUsuario.id_usuario}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (data.status) {
        // La notificación se crea automáticamente en el backend
        showToast(`Usuario '${selectedUsuario.username}' eliminado correctamente`, 'success');
        await fetchUsuarios();
        setIsDeleteModalOpen(false);
        // Recargar notificaciones inmediatamente después de un pequeño delay
        setTimeout(() => {
          if ((window as any).reloadNotifications) {
            (window as any).reloadNotifications();
          }
        }, 500); // Esperar 500ms para que el backend procese la notificación
      } else {
        showToast(data.message || 'Error al eliminar usuario', 'error');
      }
    } catch (error) {
      console.error('Error al eliminar usuario:', error);
      showToast('Error de conexión al eliminar usuario', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Nunca';

    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#DC143C] mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando usuarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con búsqueda y botón crear */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
          <Input
            placeholder="Buscar usuarios..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          onClick={handleCreateUser}
          className="bg-[#DC143C] hover:bg-[#B01030] text-white"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Nuevo Usuario
        </Button>
      </div>

      {/* Tabla de usuarios */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Usuario
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nombre Completo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Último Acceso
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsuarios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">
                      {searchTerm ? 'No se encontraron usuarios' : 'No hay usuarios registrados'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredUsuarios.map((usuario) => (
                  <tr key={usuario.id_usuario} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="font-medium text-gray-900">{usuario.username}</div>
                        <div className="text-sm text-gray-500">{usuario.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-gray-900">{capitalizeName(usuario.nombre)} {capitalizeName(usuario.apellido)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                        {usuario.rol}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {usuario.activo ? (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                          <XCircle className="h-3 w-3 mr-1" />
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(usuario.ultimo_login)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditUser(usuario)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDeleteUser(usuario)}
                            className="text-red-600"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Crear Usuario */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Usuario</DialogTitle>
            <DialogDescription>
              Complete los datos del nuevo usuario del sistema
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="usuario123"
                className={formErrors.username ? 'border-red-500' : ''}
              />
              {formErrors.username && (
                <p className="text-xs text-red-500">{formErrors.username}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="usuario@empresa.com"
                className={formErrors.email ? 'border-red-500' : ''}
              />
              {formErrors.email && (
                <p className="text-xs text-red-500">{formErrors.email}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Contraseña *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                className={formErrors.password ? 'border-red-500' : ''}
              />
              {formErrors.password && (
                <p className="text-xs text-red-500">{formErrors.password}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="nombre">Nombre *</Label>
                <Input
                  id="nombre"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  placeholder="Juan"
                  className={formErrors.nombre ? 'border-red-500' : ''}
                />
                {formErrors.nombre && (
                  <p className="text-xs text-red-500">{formErrors.nombre}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apellido">Apellido *</Label>
                <Input
                  id="apellido"
                  value={formData.apellido}
                  onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                  placeholder="Pérez"
                  className={formErrors.apellido ? 'border-red-500' : ''}
                />
                {formErrors.apellido && (
                  <p className="text-xs text-red-500">{formErrors.apellido}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="rol">Rol</Label>
                <Select value={formData.rol} onValueChange={(value) => setFormData({ ...formData, rol: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="activo">Estado</Label>
                <Select
                  value={formData.activo ? 'true' : 'false'}
                  onValueChange={(value) => setFormData({ ...formData, activo: value === 'true' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Activo</SelectItem>
                    <SelectItem value="false">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitCreateUser} className="bg-[#DC143C] hover:bg-[#B01030]">
              Crear Usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Editar Usuario */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
            <DialogDescription>
              Modifique los datos del usuario
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-username">Username *</Label>
              <Input
                id="edit-username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className={formErrors.username ? 'border-red-500' : ''}
              />
              {formErrors.username && (
                <p className="text-xs text-red-500">{formErrors.username}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email *</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={formErrors.email ? 'border-red-500' : ''}
              />
              {formErrors.email && (
                <p className="text-xs text-red-500">{formErrors.email}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-password">Nueva Contraseña</Label>
              <Input
                id="edit-password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Dejar vacío para mantener la actual"
                className={formErrors.password ? 'border-red-500' : ''}
              />
              {formErrors.password && (
                <p className="text-xs text-red-500">{formErrors.password}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-nombre">Nombre *</Label>
                <Input
                  id="edit-nombre"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  className={formErrors.nombre ? 'border-red-500' : ''}
                />
                {formErrors.nombre && (
                  <p className="text-xs text-red-500">{formErrors.nombre}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-apellido">Apellido *</Label>
                <Input
                  id="edit-apellido"
                  value={formData.apellido}
                  onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                  className={formErrors.apellido ? 'border-red-500' : ''}
                />
                {formErrors.apellido && (
                  <p className="text-xs text-red-500">{formErrors.apellido}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-rol">Rol</Label>
                <Select value={formData.rol} onValueChange={(value) => setFormData({ ...formData, rol: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-activo">Estado</Label>
                <Select
                  value={formData.activo ? 'true' : 'false'}
                  onValueChange={(value) => setFormData({ ...formData, activo: value === 'true' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Activo</SelectItem>
                    <SelectItem value="false">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitEditUser} className="bg-[#DC143C] hover:bg-[#B01030]">
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Eliminar Usuario */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Usuario</DialogTitle>
            <DialogDescription>
              ¿Está seguro que desea eliminar este usuario?
            </DialogDescription>
          </DialogHeader>
          {selectedUsuario && (
            <div className="py-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-gray-900 mb-2">
                  <strong>Username:</strong> {selectedUsuario.username}
                </p>
                <p className="text-sm text-gray-900 mb-2">
                  <strong>Nombre:</strong> {capitalizeName(selectedUsuario.nombre)} {capitalizeName(selectedUsuario.apellido)}
                </p>
                <p className="text-sm text-gray-900">
                  <strong>Email:</strong> {selectedUsuario.email}
                </p>
              </div>
              <p className="text-sm text-red-600 mt-4">
                Esta acción no se puede deshacer.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)} disabled={isDeleting}>
              Cancelar
            </Button>
            <Button
              onClick={submitDeleteUser}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Eliminando...
                </>
              ) : (
                'Eliminar Usuario'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
