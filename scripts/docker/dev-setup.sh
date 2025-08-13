#!/bin/bash
# Setup development environment with Docker services

set -e

echo "🔧 Setting up Event API development environment..."

# Ensure we're in the repo root
cd "$(dirname "$0")/../.."

# Check if docker compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ docker compose not found. Please ensure Docker with Compose plugin is installed or use 'flox activate'"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file for development..."
    cat > .env << EOF
# Development environment variables
POSTGRES_DB=event_api_dev
POSTGRES_USER=event_api
POSTGRES_PASSWORD=development_password
DB_PORT=5432

# OpenAI API key (add your key here)
# OPENAI_API_KEY=sk-your-key-here
EOF
    echo "✅ Created .env file. Please add your OPENAI_API_KEY if needed."
fi

# Start development database
echo "🐳 Starting development database..."
docker compose up -d database

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
    if docker compose exec -T database pg_isready -U event_api -d event_api_dev &> /dev/null; then
        echo "✅ Database is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Database failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

echo ""
echo "🚀 Development environment ready!"
echo "   → Database running on localhost:5432"
echo "   → Database name: event_api_dev"
echo "   → Username: event_api"
echo "   → Password: development_password"
echo ""
echo "📋 Next steps:"
echo "   → Develop services in services/ directories"
echo "   → Run services locally and they'll connect to the database"
echo "   → Use 'docker compose down' to stop services"