# Mellifera — aplicación para GitHub Pages

Esta carpeta es únicamente el **frontend** de Mellifera. No contiene PHP, contraseñas de MySQL ni credenciales de madres.

## Dirección preparada

- Aplicación: `https://app.mellifera-technology.com`
- API: `https://api.mellifera-technology.com`

## Publicación

1. Crear un repositorio en GitHub.
2. Subir el contenido de esta carpeta a la raíz del repositorio.
3. En **Settings → Pages**, publicar desde la rama principal y la carpeta raíz.
4. En **Custom domain**, indicar `app.mellifera-technology.com`.
5. Conservar el archivo `CNAME` incluido.

La aplicación usa `config.js` para conectarse exclusivamente con la API.

## Seguridad

- MySQL continúa en Laragon y no se publica.
- GitHub Pages no recibe credenciales de la base.
- La sesión se guarda en una cookie segura del dominio de la API.
- El navegador envía la cookie con `credentials: include`.
- El backend solo acepta solicitudes desde `https://app.mellifera-technology.com`.

## Prueba final

Abrir primero:

`https://api.mellifera-technology.com/api/status.php`

Debe responder JSON con `"ok": true` y `"database": "connected"`.

Después abrir:

`https://app.mellifera-technology.com`
