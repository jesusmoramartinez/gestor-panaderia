import { CrearInsumoSchema } from '@panaderia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';

import { crearInsumo, listarCategorias, listarUnidades } from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { Modal } from './Dialogo';
import {
  alEnviar,
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from './formulario';
import { SelectorIcono } from './iconosInsumo';

/**
 * "Nuevo insumo" en un modal: se carga sin salir de la lista.
 *
 * Compacto a propósito: ícono, nombre y código en una fila; categoría y
 * unidad en otra. Al crearlo se va a su ficha, porque ahí se cargan las
 * presentaciones (la bolsa de 25 kg) sin las que no se puede comprar.
 */
export function ModalNuevoInsumo({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  return (
    <Modal abierto={abierto} titulo="Nuevo insumo" onCerrar={onCerrar}>
      <Formulario onCerrar={onCerrar} />
    </Modal>
  );
}

function Formulario({ onCerrar }: { onCerrar: () => void }) {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: listarUnidades });

  // zodResolver conecta el esquema compartido con el formulario: los mensajes
  // de error son los MISMOS que devolvería la API, escritos una sola vez.
  const form = useForm({
    resolver: zodResolver(CrearInsumoSchema),
    defaultValues: { nombre: '', codigo: '', icono: '', categoriaId: '', unidadBaseId: '' },
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

  // Los <select> van CONTROLADOS (value={watch}): sus opciones llegan de la
  // API, y uno no controlado puede mostrar una opción y guardar otra (nota 18).
  const categoriaId = form.watch('categoriaId') ?? '';
  const icono = form.watch('icono') ?? '';
  const categoria = categorias.data?.find((c) => c.id === categoriaId);

  return (
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
      <div className="grid grid-cols-[auto_1fr] gap-3 sm:grid-cols-[auto_1fr_10rem]">
        <SelectorIcono
          valor={icono === '' ? null : icono}
          sugerido={categoria?.icono ?? null}
          onCambiar={(elegido) => {
            form.setValue('icono', elegido ?? '', { shouldDirty: true });
          }}
        />
        <Campo etiqueta="Nombre" error={form.formState.errors.nombre?.message}>
          <input type="text" autoFocus className={CLASE_CONTROL} {...form.register('nombre')} />
        </Campo>
        <div className="col-span-2 sm:col-span-1">
          <Campo etiqueta="Código (opcional)" error={form.formState.errors.codigo?.message}>
            <input type="text" className={CLASE_CONTROL} {...form.register('codigo')} />
          </Campo>
        </div>
      </div>
      {form.formState.errors.icono?.message !== undefined && (
        <MensajeError>{form.formState.errors.icono.message}</MensajeError>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Categoría" error={form.formState.errors.categoriaId?.message}>
          <select className={CLASE_CONTROL} {...form.register('categoriaId')} value={categoriaId}>
            <option value="">Sin categoría</option>
            {(categorias.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.icono === null ? '' : `${c.icono} `}
                {c.nombre}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          etiqueta="Se lleva en"
          ayuda="No se puede cambiar después."
          error={form.formState.errors.unidadBaseId?.message}
        >
          <select
            className={CLASE_CONTROL}
            {...form.register('unidadBaseId')}
            value={form.watch('unidadBaseId')}
          >
            <option value="">Elegí una unidad</option>
            {(unidades.data ?? []).map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {unidad.nombre} ({unidad.codigo})
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

      <p className="text-xs text-slate-600 dark:text-slate-400">
        Las presentaciones (bolsa, caja...) se cargan en el paso siguiente.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCerrar} className={CLASE_BOTON_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={crear.isPending} className={CLASE_BOTON_PRIMARIO}>
          {crear.isPending ? 'Guardando...' : 'Crear insumo'}
        </button>
      </div>
    </form>
  );
}
