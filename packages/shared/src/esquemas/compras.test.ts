import { describe, expect, it } from 'vitest';

import {
  aRecepcionDeOrden,
  conPrecioObligatorio,
  CrearOrdenSchema,
  FormularioCompraSchema,
  RecepcionDirectaSchema,
  RecibirOrdenFormSchema,
} from './compras.js';

const UUID = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const OTRO = '7f9619ff-8b86-4011-b42d-00c04fc964ff';

describe('orden de compra', () => {
  it('nace pedida si no se dice lo contrario', () => {
    const orden = CrearOrdenSchema.parse({
      sucursalId: UUID,
      proveedorId: UUID,
      lineas: [{ insumoId: UUID, cantidad: '10' }],
    });
    expect(orden.pedir).toBe(true);
    // Sin precio es válido (C-9): se puede pedir sin saberlo.
    expect(orden.lineas[0]?.precioUnitario).toBeNull();
    expect(orden.lineas[0]?.presentacionId).toBeNull();
  });

  it('acepta el precio escrito a la argentina', () => {
    const orden = CrearOrdenSchema.parse({
      sucursalId: UUID,
      proveedorId: UUID,
      lineas: [{ insumoId: UUID, cantidad: '10', precioUnitario: '18.500,50' }],
    });
    expect(orden.lineas[0]?.precioUnitario).toBe('18500.50');
  });

  it('la fecha estimada es un día AAAA-MM-DD, no un instante', () => {
    const base = {
      sucursalId: UUID,
      proveedorId: UUID,
      lineas: [{ insumoId: UUID, cantidad: '1' }],
    };
    expect(
      CrearOrdenSchema.parse({ ...base, fechaEntregaEstimada: '2026-10-10' }).fechaEntregaEstimada,
    ).toBe('2026-10-10');
    expect(
      CrearOrdenSchema.parse({ ...base, fechaEntregaEstimada: '' }).fechaEntregaEstimada,
    ).toBeNull();
    expect(
      CrearOrdenSchema.safeParse({ ...base, fechaEntregaEstimada: '10/10/2026' }).success,
    ).toBe(false);
  });

  it('rechaza un insumo repetido', () => {
    const r = CrearOrdenSchema.safeParse({
      sucursalId: UUID,
      proveedorId: UUID,
      lineas: [
        { insumoId: UUID, cantidad: '1' },
        { insumoId: UUID, cantidad: '2' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('recepción', () => {
  it('sin orden, el precio es obligatorio (C-7)', () => {
    const r = RecepcionDirectaSchema.safeParse({
      sucursalId: UUID,
      proveedorId: UUID,
      lineas: [{ insumoId: UUID, cantidad: '1' }],
    });
    expect(r.success).toBe(false);
  });

  it('el formulario con precio obligatorio marca la línea exacta', () => {
    const r = conPrecioObligatorio(FormularioCompraSchema).safeParse({
      nombre: '',
      proveedorId: UUID,
      sucursalId: UUID,
      lineas: [
        { insumoId: UUID, cantidad: '1', precioUnitario: '100' },
        { insumoId: OTRO, cantidad: '1', precioUnitario: '' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['lineas', 1, 'precioUnitario']);
  });
});

describe('recibir una orden desde el formulario', () => {
  const base = { fecha: '', numeroRemito: '', numeroFactura: '', notas: '' };

  it('lo que no llegó (vacío o cero) no se manda', () => {
    const valores = RecibirOrdenFormSchema.parse({
      ...base,
      lineas: [
        { lineaOrdenId: UUID, cantidad: '4', precioUnitario: '25000' },
        { lineaOrdenId: OTRO, cantidad: '', precioUnitario: '' },
      ],
    });
    const entrada = aRecepcionDeOrden(valores);
    expect(entrada.lineas).toEqual([
      { lineaOrdenId: UUID, cantidad: '4', precioUnitario: '25000' },
    ]);
  });

  it('si no llegó nada, no hay recepción', () => {
    const r = RecibirOrdenFormSchema.safeParse({
      ...base,
      lineas: [{ lineaOrdenId: UUID, cantidad: '0', precioUnitario: '1' }],
    });
    expect(r.success).toBe(false);
  });

  it('solo lo que llegó necesita precio', () => {
    const r = RecibirOrdenFormSchema.safeParse({
      ...base,
      lineas: [
        { lineaOrdenId: UUID, cantidad: '4', precioUnitario: '' },
        { lineaOrdenId: OTRO, cantidad: '0', precioUnitario: '' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((issue) => issue.path)).toEqual([['lineas', 0, 'precioUnitario']]);
  });
});
