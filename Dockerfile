FROM denoland/deno:2.2.4

WORKDIR /app

COPY deno.json server.js ./
COPY public ./public
COPY data ./data

EXPOSE 3000

CMD ["deno", "run", "-A", "server.js"]
