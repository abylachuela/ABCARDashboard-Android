FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnupg \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 0755 /usr/local/bin/backup.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
CMD ["/usr/local/bin/backup.sh", "--bucle"]
