FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "src/index.js"]
