#!/bin/sh

# Update system
sudo apt-get update
sudo apt-get install -y docker.io docker-compose

# Start services
docker-compose -f docker-compose.prod.yml up -d --build

# Run migrations (assuming typeorm is installed globally or accessible via npm script)
docker-compose -f docker-compose.prod.yml exec backend npm run typeorm migration:run
