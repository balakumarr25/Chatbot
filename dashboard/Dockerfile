FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
# Pass the API URL as a build arg so Vite can embed it
ARG VITE_INGESTION_API_URL=http://localhost:8000
ENV VITE_INGESTION_API_URL=$VITE_INGESTION_API_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["serve", "-s", "dist", "-l", "3001"]
