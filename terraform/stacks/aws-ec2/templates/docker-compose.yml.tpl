services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./proxy_params:/etc/nginx/proxy_params:ro
    depends_on:
      - web
    restart: unless-stopped

  web:
    image: ${app_image}
    env_file: .env
    depends_on:
      qdrant:
        condition: service_healthy
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
