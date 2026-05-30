#### build ####
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

#### final ####
FROM node:22-alpine
RUN npm install -g node-static
WORKDIR /app
COPY --from=builder /app/dist /app

CMD ["static", "-a", "0.0.0.0", "-p", "8080", "."]
