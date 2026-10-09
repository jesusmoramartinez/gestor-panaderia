/**
 * Pone el tema ANTES de que React monte.
 *
 * Es un archivo aparte (y no un <script> escrito adentro del HTML) por la
 * política de seguridad de contenido (CSP) de producción: prohíbe los
 * scripts en línea, que es justo la forma más común de un ataque XSS. Un
 * archivo del mismo sitio ('self') sí está permitido. Se carga SIN
 * type="module" y sin defer: así corre antes de que se pinte nada.
 *
 * Sin esto hay un "parpadeo": el navegador dibuja la página en claro
 * (el valor por defecto), React arranca unos milisegundos después, pone
 * data-tema="oscuro" y toda la pantalla cambia de golpe. Molesta
 * bastante, y en una tablet se ve peor.
 *
 * Es el único JavaScript suelto del proyecto: tiene que correr antes de que
 * se pinte el primer pixel.
 */
(function () {
  try {
    var guardado = localStorage.getItem('panaderia.tema');
    var oscuroDelSistema = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resuelto =
      guardado === 'claro' || guardado === 'oscuro'
        ? guardado
        : oscuroDelSistema
          ? 'oscuro'
          : 'claro';
    document.documentElement.dataset.tema = resuelto;
  } catch {
    document.documentElement.dataset.tema = 'claro';
  }
})();
