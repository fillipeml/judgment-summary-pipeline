# Container image for the pipeline. Each stage is a separate command because a production run
# waits hours between the two batch rounds, and the state directory is a volume so a container
# that is stopped between rounds resumes where it left off.
#
#   docker build -t judgment-summary .
#   docker run --rm --env-file .env -v "$PWD/out:/app/out" -v "$PWD/cases:/app/cases:ro" \
#     judgment-summary inspect
#   docker run --rm --env-file .env -v "$PWD/out:/app/out" -v "$PWD/cases:/app/cases:ro" \
#     judgment-summary stage extract
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures

# The default is the offline demo: an image run with no configuration must not spend money.
ENV OUT_DIR=/app/out
VOLUME ["/app/out"]

ENTRYPOINT ["node", "--experimental-strip-types", "src/cli.ts"]
CMD ["run"]
