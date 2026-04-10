FROM denoland/deno:2.2.4

WORKDIR /app

COPY deno.json server.js ./
COPY public ./public
# data монтируется снаружи через volume

EXPOSE 3000

CMD ["deno", "run", \
     "--allow-net", \
     "--allow-read=/app", \
     "--allow-write=/app/data", \
     "--allow-env=HOST,PORT,FETCH_TIMEOUT_MS,ADMIN_USER,ADMIN_PASS,SUB_TOKEN,SESSION_SECRET", \
     "server.js"]
