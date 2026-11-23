# EN: the build context is the REPO ROOT (see docker-compose.yml), because the service needs ../../common.
#     Inside the image the folders keep the same layout: /app/services/common and /app/services/employee-training.
# Franco: el build context hwa root el repo (shoof docker-compose.yml) 3ashan el service me7tag ../../common.
#     Gowwa el image el folders benafs el tarteeb: /app/services/common w /app/services/employee-training.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/services/employee-training

# EN: install dependencies first, so Docker can cache this layer when only the code changes.
# Franco: bnezawwed el dependencies el awel 3ashan Docker yekhaznha lama el code bas yetghayyar.
COPY services/employee-training/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# EN: the shared code (auth, db, logging, errors) and then this service's own code.
# Franco: el code el moshtarak (auth, db, logging, errors) w ba3den code el service nafsaha.
COPY services/common /app/services/common
COPY services/employee-training/src ./src

# EN: run as the non-root user "node" (least privilege). / Franco: beteshta8al b user "node" mesh root.
USER node
EXPOSE 5001
CMD ["node", "src/server.js"]
