import { CrearInsumoSchema } from '@panaderia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { crearInsumo, listarCategorias, listarUnidades } from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';

export function InsumoNuevo() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: listarUnidades });

  // zodResolver conecta el esquema compartido con el formulario: los mensajes
  // de error son los MISMOS que devolvería la API, escritos una sola vez.
  const form = useForm({
    resolver: zodResolver(CrearInsumoSchema),
    defaultValues: { nombre: '', codigo: '', categoriaId: '', unidadBaseId: '' },
  });

  const crear = useMutation({
    mutationFn: crearInsumo,
    onSuccess: async (insumo) => {
      queryClient.setQueryData(['insumo', insumo.id], insumo);
      // El listado quedó viejo: lo marcamos para que se vuelva a pedir.
      await queryClient.invalidateQueries({ queryKey: ['insumos'] });
      await navegar(`/insumos/${insumo.id}`, { replace: true });
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to="/insumos" className="text-sm text-corteza hover:underline">
          ← Volver a insumos
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">Nuevo insumo</h1>
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
        <Tarjeta titulo="Datos del insumo">
          <div className="space-y-4">
            <Campo etiqueta="Nombre" error={form.formState.errors.nombre?.message}>
              <input type="text" autoFocus className={CLASE_CONTROL} {...form.register('nombre')} />
            </Campo>

            <Campo
              etiqueta="Código (opcional)"
              ayuda="Código interno, si usás alguno."
              error={form.formState.errors.codigo?.message}
            >
              <input type="text" className={CLASE_CONTROL} {...form.register('codigo')} />
            </Campo>

            <Campo etiqueta="Categoría" error={form.formState.errors.categoriaId?.message}>
              <select className={CLASE_CONTROL} {...form.register('categoriaId')}>
                <option value="">Sin categoría</option>
                {(categorias.data ?? []).map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Unidad en la que se lleva el stock"
              ayuda="No se puede cambiar después: todos los movimientos se guardan en esta unidad."
              error={form.formState.errors.unidadBaseId?.message}
            >
              <select className={CLASE_CONTROL} {...form.register('unidadBaseId')}>
                <option value="">Elegí una unidad</option>
                {(unidades.data ?? []).map((unidad) => (
                  <option key={unidad.id} value={unidad.id}>
                    {unidad.nombre} ({unidad.codigo})
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/insumos" className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cancelar
          </Link>
          <button type="submit" disabled={crear.isPending} className={CLASE_BOTON_PRIMARIO}>
            {crear.isPending ? 'Guardando...' : 'Crear insumo'}
          </button>
        </div>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          Las presentaciones de compra y los mínimos por sucursal se configuran después de crearlo.
        </p>
      </form>
    </div>
  );
}
