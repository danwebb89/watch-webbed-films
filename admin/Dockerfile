FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 3500

CMD ["node", "server.js"]
