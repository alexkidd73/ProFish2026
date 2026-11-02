FROM nginx:1.27-alpine

# Application statique : on ne copie que les fichiers utiles
COPY index.html style.css weather.css app.js maps.js /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
