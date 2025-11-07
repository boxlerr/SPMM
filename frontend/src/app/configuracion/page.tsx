'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useNotifications } from '@/contexts/NotificationContext';
import { Bell, CheckCircle2, UserPlus, Pencil, UserMinus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import UsuariosTable from '@/components/usuarios/UsuariosTable';

export default function ConfiguracionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('empresa');
  const { notifications, markAsRead, markAllAsRead, clearNotifications, unreadCount } = useNotifications();

  // Leer el parámetro 'tab' de la URL al cargar
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && ['empresa', 'usuarios', 'notificaciones', 'sistema'].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  const tabs = [
    {
      id: 'empresa',
      label: 'Empresa',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    },
    {
      id: 'usuarios',
      label: 'Usuario',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )
    },
    {
      id: 'notificaciones',
      label: 'Notificación',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5M4 3h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
        </svg>
      )
    },
    {
      id: 'sistema',
      label: 'Sistema',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'empresa':
        return (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Configuración de Empresa</h3>
            <p className="text-gray-500">Aquí podrás configurar los datos de la empresa</p>
          </div>
        );
      case 'usuarios':
        return (
          <div className="p-6">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-1">Gestión de Usuarios</h3>
              <p className="text-sm text-gray-500">
                Administra los usuarios del sistema, crea nuevos usuarios y gestiona permisos
              </p>
            </div>
            <UsuariosTable />
          </div>
        );
      case 'notificaciones':
        const getNotificationIcon = (type: string) => {
          switch (type) {
            case 'operario_created':
              return <UserPlus className="h-5 w-5 text-green-600" />;
            case 'operario_updated':
              return <Pencil className="h-5 w-5 text-blue-600" />;
            case 'operario_deleted':
              return <UserMinus className="h-5 w-5 text-red-600" />;
            default:
              return <Bell className="h-5 w-5 text-gray-600" />;
          }
        };

        const getNotificationBadge = (type: string) => {
          switch (type) {
            case 'operario_created':
              return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Creado</span>;
            case 'operario_updated':
              return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Modificado</span>;
            case 'operario_deleted':
              return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Eliminado</span>;
            default:
              return null;
          }
        };

        const formatDate = (date: Date) => {
          const now = new Date();
          const diff = now.getTime() - date.getTime();
          const minutes = Math.floor(diff / 60000);
          const hours = Math.floor(diff / 3600000);
          const days = Math.floor(diff / 86400000);

          if (minutes < 1) return 'Hace un momento';
          if (minutes < 60) return `Hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
          if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
          if (days < 7) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
          
          return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        };

        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Historial de Notificaciones</h3>
                <p className="text-sm text-gray-500">
                  {notifications.length === 0 
                    ? 'No hay notificaciones' 
                    : `${unreadCount} ${unreadCount === 1 ? 'notificación no leída' : 'notificaciones no leídas'}`
                  }
                </p>
              </div>
              {notifications.length > 0 && (
                <div className="flex gap-2">
                  {unreadCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={markAllAsRead}
                      className="text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Marcar todas como leídas
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearNotifications}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Limpiar todo
                  </Button>
                </div>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center py-12">
                <Bell className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 text-lg">No hay notificaciones aún</p>
                <p className="text-gray-400 text-sm mt-2">Las notificaciones aparecerán aquí cuando se realicen acciones en el sistema</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 rounded-lg border transition-all ${
                      notification.read
                        ? 'bg-gray-50 border-gray-200'
                        : 'bg-white border-blue-200 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`mt-0.5 ${notification.read ? 'opacity-60' : ''}`}>
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getNotificationBadge(notification.type)}
                            {!notification.read && (
                              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                            )}
                          </div>
                          <p className={`text-sm ${notification.read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
                            {notification.message}
                          </p>
                          {notification.motivo && (
                            <div className="mt-2 p-2 bg-gray-100 rounded-md border-l-2 border-blue-500">
                              <p className="text-xs font-medium text-gray-700 mb-1">Motivo:</p>
                              <p className="text-xs text-gray-600 whitespace-pre-wrap">{notification.motivo}</p>
                            </div>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDate(notification.timestamp)}
                          </p>
                        </div>
                      </div>
                      {!notification.read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsRead(notification.id)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'sistema':
        return (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Configuración del Sistema</h3>
            <p className="text-gray-500">Ajustes avanzados del sistema</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-600 mt-2">Administre los parámetros y ajustes del SPMM</p>
      </div>

      {/* Tabs Navigation */}
      <div className="bg-gray-100 rounded-lg p-1">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                // Actualizar la URL sin recargar la página
                router.replace(`/configuracion?tab=${tab.id}`, { scroll: false });
              }}
              className={`flex items-center justify-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-3 rounded-md transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="text-sm sm:text-lg">{tab.icon}</span>
              <span className="font-medium text-xs sm:text-sm truncate">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[400px]">
        {renderTabContent()}
      </div>
    </div>
  );
}
