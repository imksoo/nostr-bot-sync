FROM node:20

WORKDIR /app
COPY *.ts package.json package-lock.json tsconfig.json /app/

RUN npm install --omit=dev
RUN npx tsc

CMD ["node", "index.js"]