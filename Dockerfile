FROM apify/actor-node:18

COPY package*.json ./
RUN npm install --omit=dev --quiet

COPY . ./

CMD npm start
