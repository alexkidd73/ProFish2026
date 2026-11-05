FROM nginx:1.27-alpine

# Application statique : on ne copie que les fichiers utiles
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css weather.css conditions.js app.js maps.js insights.js forecast.js backup.js offline.js spots.js sw.js manifest.webmanifest /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
