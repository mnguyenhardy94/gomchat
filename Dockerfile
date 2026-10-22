FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=8080 DATA_FILE=/data/db.json
EXPOSE 8080
CMD ["node", "src/server.js"]
