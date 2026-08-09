services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    labels:
      octopus.nginx.config-sha256: "${nginx_config_sha256}"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./proxy_params:/etc/nginx/proxy_params:ro
    depends_on:
      - web
    restart: unless-stopped

  web:
    image: ${app_image}
    env_file:
      - path: $${OCTOPUS_RUNTIME_ENV_PATH:-/run/octopus/runtime.env}
        format: raw
    depends_on:
      qdrant:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 45s
      retries: 3
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 5120m

  qdrant:
    image: qdrant/qdrant:v1.17.0
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:6333/readyz"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  qdrant_data:
