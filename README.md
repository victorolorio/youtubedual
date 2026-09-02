# Remix of DJ Dual Display

Crea una aplicación web en React con Tailwind CSS tipo DJ/Karaoke Video Controller con arquitectura de doble pantalla (Dual Screen).

1. Estructura de Rutas:

- Ruta principal (/): Panel de Control (DJ Dashboard).

- Ruta secundaria (/player): Pantalla de salida limpia para TV.

2. Comunicación entre pantallas:

- Usa la API nativa del navegador "BroadcastChannel" llamada "youtube_tv_channel" para sincronizar ambas vistas en tiempo real sin backend.

3. Vista Panel de Control (/):

- Tema oscuro profesional (estilo consola de DJ).

- Botón destacado: "Abrir Pantalla TV" que ejecute window.open('/player', 'TVPlayer', 'width=1280,height=720').

- Input para pegar URL de YouTube o ID de video y botón "Agregar a la cola".

- Lista visual de la cola de reproducción (reordenable y botón de eliminar).

- Controles de reproducción: Play, Pausa, Siguiente canción, Reiniciar y control de volumen.

- Sección de "Sonando Ahora" con el título y duración estimada.

- Input opcional: "Mensaje en pantalla" (ej: "Turno de Juan") con botón para enviarlo a la TV.

4. Vista TV (/player):

- Pantalla completamente negra y limpia, sin barras de scroll.

- Reproductor de YouTube embebido que ocupe el 100% de la pantalla (usando iframe o react-youtube).

- Escucha los eventos del BroadcastChannel para: reproducir video por ID, pausar, reproducir, cambiar volumen y recibir la siguiente canción.

- Overlay inferior discreto y elegante con fondo semitransparente que muestre: "Sonando ahora: [Título]" y el mensaje personalizado si existe.

Asegura un diseño responsivo, moderno y sin errores de typescript.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://youtubedual.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f2b6905e-3c31-446a-9b0e-896d1c26ce8f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
