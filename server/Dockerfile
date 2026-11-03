# Sync-Server als Container, z. B. beim vACC:  docker build -t eddm-aman-sync . && docker run -p 8080:8080 -v aman:/data eddm-aman-sync
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY core.mjs node.mjs ./
ENV PORT=8080 DATA=/data/plan.json
VOLUME /data
EXPOSE 8080
CMD ["node", "node.mjs"]
