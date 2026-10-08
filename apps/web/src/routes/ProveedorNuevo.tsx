import { CrearProveedorSchema } from '@panaderia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import {
  alEnviar,
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { crearProveedor } from '../lib/proveedores';

export function ProveedorNuevo() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(CrearProveedorSchema),
    defaultValues: {
      nombre: '',
      razonSocial: '',
      cuit: '',
      email: '',
      telefono: '',
      direccion: '',
      contactoNombre: '',
      diasEntrega: '',
      notas: '',
    },
  });

  const crear = useMutation({
    mutationFn: crearProveedor,
    onSuccess: async (proveedor) => {
      queryClient.setQueryData(['proveedor', proveedor.id], proveedor);
      await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      await navegar(`/proveedores/${proveedor.id}`, { replace: true });
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          to="/proveedores"
          className="text-sm text-corteza dark:text-corteza-claro hover:underline"
        >
          ← Volver a proveedores
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Nuevo proveedor
        </h1>
      </div>

      <form
        onSubmit={alEnviar(
          form.handleSubmit((valores) => {
            setErrorGeneral(null);
            crear.mutate(valores);
          }),
        )}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo="Quién es">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Nombre"
              ayuda="Como le dicen en la panadería."
              error={form.formState.errors.nombre?.message}
            >
              <input type="text" autoFocus className={CLASE_CONTROL} {...form.register('nombre')} />
            </Campo>

            <Campo
              etiqueta="Razón social (opcional)"
              ayuda="El nombre legal, el que dice la factura."
              error={form.formState.errors.razonSocial?.message}
            >
              <input type="text" className={CLASE_CONTROL} {...form.register('razonSocial')} />
            </Campo>

            <Campo
              etiqueta="CUIT (opcional)"
              ayuda="Se puede escribir con guiones."
              error={form.formState.errors.cuit?.message}
            >
              <input
                type="text"
                inputMode="numeric"
                placeholder="30-12345678-9"
                className={CLASE_CONTROL}
                {...form.register('cuit')}
              />
            </Campo>

            <Campo
              etiqueta="Días de entrega (opcional)"
              ayuda="Cuánto tarda desde que se le pide. 0 = en el día."
              error={form.formState.errors.diasEntrega?.message}
            >
              <input
                type="text"
                inputMode="numeric"
                className={CLASE_CONTROL}
                {...form.register('diasEntrega')}
              />
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Cómo contactarlo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Contacto (opcional)"
              error={form.formState.errors.contactoNombre?.message}
            >
              <input
                type="text"
                placeholder="Jorge (ventas)"
                className={CLASE_CONTROL}
                {...form.register('contactoNombre')}
              />
            </Campo>

            <Campo etiqueta="Teléfono (opcional)" error={form.formState.errors.telefono?.message}>
              <input
                type="tel"
                inputMode="tel"
                className={CLASE_CONTROL}
                {...form.register('telefono')}
              />
            </Campo>

            <Campo etiqueta="Email (opcional)" error={form.formState.errors.email?.message}>
              <input
                type="email"
                inputMode="email"
                className={CLASE_CONTROL}
                {...form.register('email')}
              />
            </Campo>

            <Campo etiqueta="Dirección (opcional)" error={form.formState.errors.direccion?.message}>
              <input type="text" className={CLASE_CONTROL} {...form.register('direccion')} />
            </Campo>

            <div className="sm:col-span-2">
              <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
                <textarea
                  rows={3}
                  placeholder="Pedido mínimo, días que reparte, con quién hablar..."
                  className={`${CLASE_CONTROL} py-2`}
                  {...form.register('notas')}
                />
              </Campo>
            </div>
          </div>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/proveedores" className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cancelar
          </Link>
          <button type="submit" disabled={crear.isPending} className={CLASE_BOTON_PRIMARIO}>
            {crear.isPending ? 'Guardando...' : 'Crear proveedor'}
          </button>
        </div>

        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Los insumos que le compras se cargan después de crearlo.
        </p>
      </form>
    </div>
  );
}
