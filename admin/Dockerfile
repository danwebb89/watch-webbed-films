FROM node:20-bookworm-slim

# Enable non-free for Intel media driver, install ffmpeg + QSV deps
RUN echo "deb http://deb.debian.org/debian bookworm non-free non-free-firmware" >> /etc/apt/sources.list.d/non-free.list \
  && apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    intel-media-va-driver-non-free \
    vainfo \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

EXPOSE 3500

CMD ["node", "server.js"]
