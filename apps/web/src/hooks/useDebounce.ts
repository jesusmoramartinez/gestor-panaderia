import { useEffect, useState } from 'react';

/**
 * Devuelve el valor "con retraso": cambia recién cuando pasaron `esperaMs`
 * sin que lo vuelvan a cambiar.
 *
 * Se usa en el buscador: sin esto, escribir "harina" dispararía seis pedidos
 * al servidor (uno por tecla). Con 300 ms de espera, dispara uno.
 *
 * El `return` del useEffect cancela el temporizador anterior: es la forma de
 * limpiar un efecto en React, y acá es justo lo que hace que funcione.
 */
export function useDebounce<T>(valor: T, esperaMs = 300): T {
  const [retrasado, setRetrasado] = useState(valor);

  useEffect(() => {
    const temporizador = setTimeout(() => {
      setRetrasado(valor);
    }, esperaMs);
    return () => {
      clearTimeout(temporizador);
    };
  }, [valor, esperaMs]);

  return retrasado;
}
